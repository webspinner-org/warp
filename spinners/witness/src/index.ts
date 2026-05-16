/**
 * Witness — the verification Spinner of the Warp build loop.
 *
 * Capability: `verifyScenario({ scenarioSlug, ... }) → WitnessReport`
 *
 * Drives a live Weaver's Tension scenario end-to-end via Playwright
 * (headless Chromium), watches the ribbon + escalation panel, and
 * returns a structured report.
 *
 * Runtime: in-process inside the Loom (the Spinner's entrypoint is
 * dynamically imported by weaver-cell-dispatch). Future RUNNERS.md
 * moves this into an isolated runner; the capability contract stays
 * stable.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface VerifyScenarioInput {
  readonly scenarioSlug: string;
  readonly loomBase?: string;
  readonly authMode?: 'superuser' | 'webspinner';
  readonly cleanupSpinnerSlug?: string;
  readonly runTimeoutMs?: number;
}

export interface RibbonEntry {
  readonly key: string;
  readonly title: string;
  readonly status: string;
}

export interface WitnessReport {
  readonly ok: boolean;
  readonly scenarioSlug: string;
  readonly runId: string;
  readonly totalSteps: number;
  readonly completedSteps: number;
  readonly remediatedSteps: number;
  readonly failedSteps: number;
  readonly escalation?: {
    readonly stepKey: string;
    readonly reason: string;
    readonly evidenceText: string;
  };
  readonly durationMs: number;
  readonly ribbon: readonly RibbonEntry[];
  readonly errorKind?:
    | 'auth-failed'
    | 'scenario-not-found'
    | 'iframe-load-failed'
    | 'witness-timeout'
    | 'harness-threw';
  readonly errorDetail?: string;
}

const DEFAULT_LOOM_BASE = process.env['WARP_LOOM_BASE'] ?? 'http://johns-mac-studio.local:3000';
const DEFAULT_PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
const TEST_USER_EMAIL = 'wt-witness@example.test';
const TEST_USER_PASSWORD = 'wt-witness-test-password-1234567890';
const TEST_USER_NAME = 'Witness Test User';

function readBootstrap(name: string): string | null {
  try {
    return readFileSync(join(homedir(), '.warp/bootstrap', name), 'utf8').trim();
  } catch {
    return null;
  }
}

export async function verifyScenario(input: VerifyScenarioInput): Promise<WitnessReport> {
  const slug = input.scenarioSlug;
  const loomBase = input.loomBase ?? DEFAULT_LOOM_BASE;
  const authMode = input.authMode ?? 'superuser';
  const runTimeoutMs = input.runTimeoutMs ?? 5 * 60 * 1000;
  const start = Date.now();

  // Lazy-load playwright so the Spinner's manifest validation
  // doesn't pay the Chromium-discovery cost at module load.
  const { chromium } = await import('playwright');

  const pbEmail = process.env['WARP_PB_EMAIL'] ?? readBootstrap('pb-email');
  const pbPassword = process.env['WARP_PB_PASSWORD'] ?? readBootstrap('pb-password');
  if (!pbEmail || !pbPassword) {
    return errorReport(slug, start, 'auth-failed', 'WARP_PB_EMAIL / WARP_PB_PASSWORD missing');
  }

  // 1. Auth (always need a superuser token at minimum).
  const superRes = await fetch(`${DEFAULT_PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: pbEmail, password: pbPassword }),
  });
  if (!superRes.ok) {
    return errorReport(
      slug,
      start,
      'auth-failed',
      `PB superuser auth failed: ${superRes.status} ${await superRes.text()}`,
    );
  }
  const superToken = ((await superRes.json()) as { token: string }).token;

  // 2. Optional: cleanup prior installed Spinner.
  if (input.cleanupSpinnerSlug) {
    await cleanupSpinner(input.cleanupSpinnerSlug, superToken);
  }

  // 3. Pick cookie token by authMode.
  let cookieToken = superToken;
  let cookieCollection: 'users' | '_superusers' = '_superusers';
  if (authMode === 'webspinner') {
    await ensureTestUser(superToken);
    const userRes = await fetch(`${DEFAULT_PB_URL}/api/collections/users/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }),
    });
    if (!userRes.ok) {
      return errorReport(
        slug,
        start,
        'auth-failed',
        `PB user auth failed: ${userRes.status} ${await userRes.text()}`,
      );
    }
    cookieToken = ((await userRes.json()) as { token: string }).token;
    cookieCollection = 'users';
  }

  // 4. Drive the browser.
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const url = new URL(loomBase);
    await ctx.addCookies([
      {
        name: 'wp_session',
        value: `${cookieCollection}::${cookieToken}`,
        domain: url.hostname,
        path: '/',
        httpOnly: true,
        secure: url.protocol === 'https:',
        sameSite: 'Strict',
      },
    ]);
    const page = await ctx.newPage();

    // Go to the index, confirm the scenario exists.
    await page.goto(`${loomBase}/admin/weavers-tension`);
    try {
      await page.waitForSelector(`form[action="/admin/weavers-tension/${slug}?/start"]`, {
        timeout: 10_000,
      });
    } catch {
      return errorReport(
        slug,
        start,
        'scenario-not-found',
        `No scenario card at /admin/weavers-tension for slug "${slug}"`,
      );
    }

    // Click Start a run, wait for the player URL.
    const startForm = page.locator(`form[action="/admin/weavers-tension/${slug}?/start"]`);
    const runUrlPattern = new RegExp(`/admin/weavers-tension/${slug}/[0-9a-f-]{8,}$`);
    await Promise.all([
      page.waitForURL(runUrlPattern, { timeout: 15_000 }),
      startForm.locator('button[type="submit"]').click(),
    ]);
    const runId = page.url().split('/').pop() ?? '';

    // Press ▶ Start on the player.
    const startBtn = page.locator('button.primary.big', { hasText: 'Start' });
    await startBtn.waitFor({ timeout: 10_000 });
    await startBtn.click();

    // Watch.
    const deadline = Date.now() + runTimeoutMs;
    let escalation: WitnessReport['escalation'] = undefined;
    let terminalStatus: string | null = null;
    while (Date.now() < deadline) {
      const status =
        (await page.locator('.run-status').first().textContent())?.trim().toLowerCase() ??
        'unknown';
      const esc = await readEscalation(page);
      if (esc) {
        escalation = esc;
      }
      if (status.startsWith('completed')) {
        terminalStatus = 'completed';
        break;
      }
      if (status.startsWith('aborted') || status.startsWith('failed')) {
        terminalStatus = status;
        break;
      }
      await sleep(750);
    }
    if (terminalStatus === null) {
      return {
        ...errorReport(
          slug,
          start,
          'witness-timeout',
          `Run did not terminate within ${runTimeoutMs}ms`,
        ),
        runId,
      };
    }

    const ribbon = await readRibbon(page);
    const completedSteps = ribbon.filter((s) => s.status === 'completed').length;
    const remediatedSteps = ribbon.filter((s) => s.status === 'remediated').length;
    const failedSteps = ribbon.filter(
      (s) => s.status === 'failed' || s.status === 'escalated',
    ).length;
    const ok = terminalStatus === 'completed' && failedSteps === 0;
    return {
      ok,
      scenarioSlug: slug,
      runId,
      totalSteps: ribbon.length,
      completedSteps,
      remediatedSteps,
      failedSteps,
      ...(escalation !== undefined ? { escalation } : {}),
      durationMs: Date.now() - start,
      ribbon,
    };
  } catch (err) {
    return errorReport(
      slug,
      start,
      'harness-threw',
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    await browser.close();
  }
}

// ── helpers ──────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readRibbon(page: import('playwright').Page): Promise<RibbonEntry[]> {
  return page.$$eval('.ribbon .ribbon-step', (els: Element[]) =>
    els.map((el) => {
      const title = el.querySelector('.r-title')?.textContent?.trim() ?? '';
      const status =
        Array.from(el.classList)
          .find((c: string) => c.startsWith('status-'))
          ?.replace('status-', '') ?? 'unknown';
      // We don't have a stable per-step key in the DOM (the ribbon
      // uses titles), so we derive a key from the title slug.
      const key = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      return { key, title, status };
    }),
  );
}

async function readEscalation(
  page: import('playwright').Page,
): Promise<{ stepKey: string; reason: string; evidenceText: string } | null> {
  const esc = page.locator('.escalation');
  if ((await esc.count()) === 0) return null;
  // The active-step h2 above the escalation panel is the step that
  // failed; derive the key from its text.
  const stepTitle = ((await page.locator('.active-step h2').first().textContent()) ?? '').trim();
  const stepKey = stepTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const reason = ((await esc.locator('.escalation-reason').textContent()) ?? '').trim();
  const evidenceText = ((await esc.locator('details pre').textContent()) ?? '').trim();
  return { stepKey, reason, evidenceText };
}

async function ensureTestUser(superuserToken: string): Promise<void> {
  const headers = { Authorization: superuserToken, 'Content-Type': 'application/json' };
  const params = new URLSearchParams();
  params.set('filter', `email = ${JSON.stringify(TEST_USER_EMAIL)}`);
  const lookup = await fetch(
    `${DEFAULT_PB_URL}/api/collections/users/records?${params.toString()}`,
    { headers },
  );
  if (!lookup.ok) throw new Error(`users lookup failed: ${lookup.status}`);
  const lookupBody = (await lookup.json()) as { items: { id: string; verified: boolean }[] };
  if (lookupBody.items.length > 0) {
    const existing = lookupBody.items[0]!;
    if (!existing.verified) {
      await fetch(`${DEFAULT_PB_URL}/api/collections/users/records/${existing.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ verified: true }),
      });
    }
    return;
  }
  const create = await fetch(`${DEFAULT_PB_URL}/api/collections/users/records`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
      passwordConfirm: TEST_USER_PASSWORD,
      name: TEST_USER_NAME,
      verified: true,
    }),
  });
  if (!create.ok) {
    throw new Error(`test user create failed: ${create.status} ${await create.text()}`);
  }
}

async function cleanupSpinner(slug: string, superuserToken: string): Promise<void> {
  const headers = { Authorization: superuserToken, 'Content-Type': 'application/json' };
  const params = new URLSearchParams();
  params.set('filter', `slug = ${JSON.stringify(slug)}`);
  const lookup = await fetch(
    `${DEFAULT_PB_URL}/api/collections/wp_skein/records?${params.toString()}`,
    { headers },
  );
  if (lookup.ok) {
    const body = (await lookup.json()) as { items: { id: string }[] };
    for (const row of body.items) {
      await fetch(`${DEFAULT_PB_URL}/api/collections/wp_skein/records/${row.id}`, {
        method: 'DELETE',
        headers,
      });
    }
  }
  try {
    const { rm } = await import('node:fs/promises');
    await rm(join(homedir(), 'Cells', 'spinners', slug), { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function errorReport(
  slug: string,
  start: number,
  kind: NonNullable<WitnessReport['errorKind']>,
  detail: string,
): WitnessReport {
  return {
    ok: false,
    scenarioSlug: slug,
    runId: '',
    totalSteps: 0,
    completedSteps: 0,
    remediatedSteps: 0,
    failedSteps: 0,
    durationMs: Date.now() - start,
    ribbon: [],
    errorKind: kind,
    errorDetail: detail,
  };
}

// Default export — weaver-cell-dispatch picks up capability handlers
// from either named exports or default-object exports.
export default { verifyScenario };
