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

function log(level: 'info' | 'ok' | 'fail' | 'step', msg: string): void {
  const marker = level === 'ok' ? '✓' : level === 'fail' ? '✗' : level === 'step' ? '▸' : '·';
  process.stdout.write(`${marker} ${msg}\n`);
}

async function loginViaCookie(ctx: BrowserContext): Promise<void> {
  // Bypass the login UI entirely. Authenticate directly with
  // PocketBase, get the superuser token, and install it as the
  // session cookie that the Loom's getSession() reads.
  log('step', `auth (superuser) as ${PB_EMAIL} against PB`);
  const pbUrl = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';
  const res = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`PB auth failed: HTTP ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { token: string };
  const url = new URL(BASE);
  await ctx.addCookies([
    {
      name: 'wp_session',
      value: `_superusers::${body.token}`,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'Strict',
    },
  ]);
  log('ok', `session cookie installed`);
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
    await loginViaCookie(ctx);
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
