/**
 * Weaver's Tension — end-to-end smoke test.
 *
 * Drives the live Loom via headless Chromium: logs in, starts a
 * run, clicks ▶ Start on the player, and watches the step ribbon
 * advance until all steps complete or an escalation appears.
 *
 * Run on Kepler (where the Loom is live):
 *   PB_EMAIL=$(cat ~/.warp/bootstrap/pb-email) \
 *   PB_PASSWORD=$(cat ~/.warp/bootstrap/pb-password) \
 *   pnpm --filter loom exec tsx tests/weavers-tension-e2e.ts
 *
 * Exits 0 on success, 1 on any step failure. Streams progress.
 *
 * Not a unit test — explicitly NOT picked up by vitest (lives
 * under tests/, not src/**.test.ts).
 */

import { chromium, type BrowserContext, type Page, type Response } from 'playwright';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env['WT_BASE'] ?? 'http://localhost:3000';
const SCENARIO_SLUG = process.env['WT_SCENARIO'] ?? 'webspinner-author';
const HEADLESS = process.env['WT_HEADLESS'] !== '0';
const FULL_RUN_TIMEOUT_MS = 5 * 60 * 1000;

function readBootstrap(name: string): string {
  return readFileSync(join(homedir(), '.warp/bootstrap', name), 'utf8').trim();
}

const PB_EMAIL = process.env['PB_EMAIL'] ?? readBootstrap('pb-email');
const PB_PASSWORD = process.env['PB_PASSWORD'] ?? readBootstrap('pb-password');

// Which session collection to authenticate as. The harness MUST
// exercise both paths because privilege-boundary bugs (a form action
// using session.token for the bearer; user tokens get 403 on
// admin-only collection reads) are invisible to the superuser path.
//   _superusers  → wizard kind; bypasses PB collection rules
//   users        → webspinner kind; does NOT bypass; needs a real
//                  PB users record to exist
type SessionCollection = '_superusers' | 'users';
const SESSION_COLLECTION = (process.env['WT_AUTH'] ?? '_superusers') as SessionCollection;

// User-path test inputs. Either provide via env, or the harness
// will create the user via the registration flow (idempotent — if
// the user already exists we just auth as them).
const TEST_USER_EMAIL = process.env['WT_TEST_USER_EMAIL'] ?? 'wt-e2e@example.test';
const TEST_USER_PASSWORD =
  process.env['WT_TEST_USER_PASSWORD'] ?? 'wt-e2e-test-password-1234567890';
const TEST_USER_NAME = process.env['WT_TEST_USER_NAME'] ?? 'WT E2E Test User';

function log(level: 'info' | 'ok' | 'fail' | 'step', msg: string): void {
  const marker = level === 'ok' ? '✓' : level === 'fail' ? '✗' : level === 'step' ? '▸' : '·';
  process.stdout.write(`${marker} ${msg}\n`);
}

async function cleanupPriorSpinner(pbToken: string): Promise<void> {
  // The webspinner-author scenario installs `tension-demo`. If a prior
  // run left it behind in wp_skein + on disk, the slug-uniqueness check
  // on /admin/spinners/new rejects the new install. Wipe both.
  const pbUrl = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
  const headers = { Authorization: pbToken, 'Content-Type': 'application/json' };

  // Find any wp_skein row for tension-demo.
  const params = new URLSearchParams();
  params.set('filter', 'slug = "tension-demo"');
  const listRes = await fetch(`${pbUrl}/api/collections/wp_skein/records?${params.toString()}`, {
    headers,
  });
  if (listRes.ok) {
    const body = (await listRes.json()) as { items: { id: string }[] };
    for (const row of body.items) {
      await fetch(`${pbUrl}/api/collections/wp_skein/records/${row.id}`, {
        method: 'DELETE',
        headers,
      });
      log('info', `cleanup: deleted wp_skein row ${row.id}`);
    }
  }
  // Delete bundle dir if present.
  const bundlePath = join(homedir(), 'Cells', 'spinners', 'tension-demo');
  try {
    const { rm } = await import('node:fs/promises');
    await rm(bundlePath, { recursive: true, force: true });
    log('info', `cleanup: removed ${bundlePath}`);
  } catch {
    // best-effort
  }
}

async function ensureTestUser(superuserToken: string): Promise<void> {
  // Idempotent: create the test user via PB API if missing; verify
  // the account so /admin doesn't redirect to /verify-pending. Uses
  // the superuser token (only superusers can write to `users`
  // directly, bypassing the registration captcha).
  const pbUrl = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
  const headers = { Authorization: superuserToken, 'Content-Type': 'application/json' };

  // Check if user exists.
  const params = new URLSearchParams();
  params.set('filter', `email = ${JSON.stringify(TEST_USER_EMAIL)}`);
  const lookup = await fetch(`${pbUrl}/api/collections/users/records?${params.toString()}`, {
    headers,
  });
  if (!lookup.ok) {
    throw new Error(`users lookup failed: ${lookup.status} ${await lookup.text()}`);
  }
  const lookupBody = (await lookup.json()) as { items: { id: string; verified: boolean }[] };
  if (lookupBody.items.length > 0) {
    const existing = lookupBody.items[0]!;
    if (!existing.verified) {
      await fetch(`${pbUrl}/api/collections/users/records/${existing.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ verified: true }),
      });
    }
    log('info', `test user ${TEST_USER_EMAIL} exists; verified=true`);
    return;
  }
  // Create.
  const create = await fetch(`${pbUrl}/api/collections/users/records`, {
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
  log('info', `test user ${TEST_USER_EMAIL} created and verified`);
}

async function loginViaCookie(ctx: BrowserContext): Promise<{ pbToken: string }> {
  // Bypass the login UI entirely. Authenticate directly with
  // PocketBase against the chosen collection, get a token, install
  // it as the session cookie the Loom's getSession() reads.
  //
  // For `_superusers`: token bypasses PB collection rules → wizard kind.
  // For `users`: token does NOT bypass → webspinner kind. This is
  // the path that catches form actions wrongly using session.token
  // as the bearer for Loom-privileged operations.
  const pbUrl = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';

  // Always need a superuser token to ensure the test user exists.
  log('step', `auth (superuser bootstrap) as ${PB_EMAIL} against PB`);
  const superRes = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD }),
  });
  if (!superRes.ok) {
    throw new Error(`PB superuser auth failed: HTTP ${superRes.status} ${await superRes.text()}`);
  }
  const superBody = (await superRes.json()) as { token: string };
  const superuserToken = superBody.token;

  let cookieToken: string;
  let cookieCollection: SessionCollection;

  if (SESSION_COLLECTION === 'users') {
    await ensureTestUser(superuserToken);
    log('step', `auth (users) as ${TEST_USER_EMAIL} against PB`);
    const userRes = await fetch(`${pbUrl}/api/collections/users/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }),
    });
    if (!userRes.ok) {
      throw new Error(`PB user auth failed: HTTP ${userRes.status} ${await userRes.text()}`);
    }
    const userBody = (await userRes.json()) as { token: string };
    cookieToken = userBody.token;
    cookieCollection = 'users';
  } else {
    cookieToken = superuserToken;
    cookieCollection = '_superusers';
  }

  const url = new URL(BASE);
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
  log('ok', `session cookie installed (${cookieCollection})`);
  // Return the SUPERUSER token for the cleanup function — it needs
  // admin to wipe wp_skein rows regardless of which session the
  // browser is using.
  return { pbToken: superuserToken };
}

async function openWeaversTensionIndex(page: Page): Promise<void> {
  log('step', 'open /admin/weavers-tension');
  await page.goto(`${BASE}/admin/weavers-tension`);
  await page.waitForSelector('.scenario-card', { timeout: 10_000 });
  log('ok', 'index loaded');
}

async function startRun(page: Page): Promise<string> {
  log('step', `start a run of "${SCENARIO_SLUG}"`);
  // Capture every response to the ?/start endpoint for diagnostics.
  page.on('response', (resp: Response) => {
    if (
      resp.request().method() === 'POST' &&
      resp.url().includes(`/admin/weavers-tension/${SCENARIO_SLUG}`)
    ) {
      log(
        'info',
        `[startRun POST response] ${resp.status()} ${resp.url()} origin=${resp.request().headers()['origin'] ?? '<none>'}`,
      );
    }
  });
  const form = page.locator(`form[action="/admin/weavers-tension/${SCENARIO_SLUG}?/start"]`);
  await form.waitFor({ timeout: 5_000 });
  await Promise.all([
    page.waitForURL(new RegExp(`/admin/weavers-tension/${SCENARIO_SLUG}/[0-9a-f-]{8,}$`), {
      timeout: 15_000,
    }),
    form.locator('button[type="submit"]').click(),
  ]);
  const runId = page.url().split('/').pop()!;
  log('ok', `run created: ${runId}`);
  return runId;
}

async function pressStart(page: Page): Promise<void> {
  log('step', 'press ▶ Start on the player');
  // The Start button is the only `.primary.big` in the panel.
  const startBtn = page.locator('button.primary.big', { hasText: 'Start' });
  await startBtn.waitFor({ timeout: 10_000 });
  await startBtn.click();
  log('ok', 'Start clicked');
}

interface RibbonStatus {
  readonly key: string;
  readonly status: string;
}

async function readRibbon(page: Page): Promise<readonly RibbonStatus[]> {
  return page.$$eval('.ribbon .ribbon-step', (els: Element[]) =>
    els.map((el) => {
      const title = el.querySelector('.r-title')?.textContent?.trim() ?? '';
      const status = Array.from(el.classList)
        .find((c: string) => c.startsWith('status-'))
        ?.replace('status-', '');
      return { key: title, status: status ?? 'unknown' };
    }),
  );
}

async function readEscalation(page: Page): Promise<{ reason: string; evidence: string } | null> {
  const esc = page.locator('.escalation');
  if ((await esc.count()) === 0) return null;
  const reason = (await esc.locator('.escalation-reason').textContent()) ?? '';
  const evidence = (await esc.locator('details pre').textContent()) ?? '';
  return { reason, evidence };
}

async function readRunStatus(page: Page): Promise<string> {
  return (
    (await page.locator('.run-status').first().textContent())?.trim().toLowerCase() ?? 'unknown'
  );
}

async function readLiveAction(page: Page): Promise<string> {
  return ((await page.locator('.live-action').first().textContent()) ?? '').trim();
}

async function watchRun(page: Page, runId: string): Promise<boolean> {
  const start = Date.now();
  let lastSummary = '';
  while (Date.now() - start < FULL_RUN_TIMEOUT_MS) {
    const status = await readRunStatus(page);
    const ribbon = await readRibbon(page);
    const live = await readLiveAction(page);
    const counts = ribbon.reduce(
      (acc, s) => {
        acc[s.status] = (acc[s.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const summary = `${status} | ${Object.entries(counts)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ')} | live: ${live.slice(0, 60)}`;
    if (summary !== lastSummary) {
      log('info', summary);
      lastSummary = summary;
    }

    const esc = await readEscalation(page);
    if (esc) {
      log('fail', `escalation: ${esc.reason}`);
      log('info', `evidence: ${esc.evidence.slice(0, 800)}`);
      return false;
    }
    if (status.startsWith('completed')) {
      log('ok', `run ${runId} completed; all ribbon steps: ${JSON.stringify(counts)}`);
      return true;
    }
    if (status.startsWith('aborted') || status.startsWith('failed')) {
      log('fail', `run terminal status: ${status}`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  log('fail', `timeout after ${FULL_RUN_TIMEOUT_MS}ms`);
  return false;
}

async function main(): Promise<void> {
  log('info', `BASE=${BASE} scenario=${SCENARIO_SLUG} headless=${HEADLESS}`);
  const browser = await chromium.launch({ headless: HEADLESS });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  page.on('console', (m: import('playwright').ConsoleMessage) => {
    if (m.type() === 'error') log('info', `[console.${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e: Error) => log('info', `[pageerror] ${e.message}`));

  try {
    const { pbToken } = await loginViaCookie(ctx);
    await cleanupPriorSpinner(pbToken);
    await openWeaversTensionIndex(page);
    const runId = await startRun(page);
    await pressStart(page);
    const ok = await watchRun(page, runId);
    if (!ok) {
      process.exitCode = 1;
    }
  } catch (err) {
    log('fail', `harness threw: ${(err as Error).stack ?? String(err)}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  log('fail', `unhandled: ${String(e)}`);
  process.exit(1);
});
