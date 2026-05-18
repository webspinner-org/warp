#!/usr/bin/env node
/**
 * webbase-flow.mjs — focused e2e for the Webbase rename + republish-on-update
 * + author-dashboard work. Reuses an existing demo session that already has
 * a built application (so we don't pay the build cost every run); generates
 * a fresh test email per run; publishes twice; confirms the same short_code
 * comes back the second time (upsert worked); then logs into /me on
 * app.webspinner.ai and confirms the Webbase shows up in the dashboard.
 *
 * Usage:
 *   node webbase-flow.mjs               # uses try.webspinner.ai + the
 *                                       # newest demo session it can find
 *   node webbase-flow.mjs <sessionId>   # pin to a specific demo session
 */

import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TRY_BASE = 'https://try.webspinner.ai';
const APP_BASE = 'https://app.webspinner.ai';
const SHOT_DIR = join(
  homedir(),
  'Desktop',
  'playwright-try',
  'webbase-flow-' + new Date().toISOString().replace(/[:.]/g, '-'),
);
mkdirSync(SHOT_DIR, { recursive: true });
console.log('[drive] artifacts →', SHOT_DIR);

const PB_BASE = 'http://127.0.0.1:8091';

function findBuiltSession() {
  // Do PB auth + lookup in a single shell command on Kepler so we
  // never need to ferry a password-with-special-chars across an SSH
  // command line. Returns the newest demo-* sessionId with a
  // non-null builtAt.
  const script = `
    set -eu
    plist=$(launchctl print gui/$(id -u)/foundation.webspinner.loom-demo 2>/dev/null)
    email=$(echo "$plist" | sed -n 's/.*WARP_PB_EMAIL *=> *\\(.*\\) *$/\\1/p' | tr -d ' ')
    password=$(echo "$plist" | sed -n 's/.*WARP_PB_PASSWORD *=> *\\(.*\\) *$/\\1/p' | tr -d ' ')
    [ -n "$email" ] || { echo "no email" >&2; exit 1; }
    auth=$(curl -sS -X POST "${PB_BASE}/api/collections/_superusers/auth-with-password" \\
      -H "Content-Type: application/json" \\
      --data-binary @<(printf '{"identity":"%s","password":"%s"}' "$email" "$password"))
    token=$(echo "$auth" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
    filter=$(python3 -c 'import urllib.parse;print(urllib.parse.quote("built_at != null"))')
    list=$(curl -sS -H "Authorization: $token" \\
      "${PB_BASE}/api/collections/wp_database_applications/records?perPage=10&sort=-created&filter=$filter")
    echo "$list" | python3 -c 'import sys,json;d=json.load(sys.stdin);items=d.get("items",[]);demo=next((i for i in items if i.get("session_id","").startswith("demo-")),items[0] if items else None);print(demo["session_id"] if demo else "")'
  `;
  const out = execSync(`ssh johns-mac-studio.local 'bash -s' <<'EOF'\n${script}\nEOF\n`, {
    encoding: 'utf8',
    shell: '/bin/bash',
  }).trim();
  if (!out) throw new Error('no built session returned');
  return out;
}

async function pullCodeFromOutbox(email) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const tail = execSync(`ssh johns-mac-studio.local "tail -50 ~/.warp/email-outbox.jsonl"`, {
        encoding: 'utf8',
        timeout: 10_000,
      });
      // Walk from latest to earliest to pick up the most recent matching code.
      const lines = tail.trim().split('\n').reverse();
      for (const line of lines) {
        if (!line.includes(email)) continue;
        const m = line.match(/verification code: (\d{6})/);
        if (m) return m[1];
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return null;
}

let exitCode = 0;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

try {
  const sessionId = process.argv[2] ?? findBuiltSession();
  console.log('[drive] using session:', sessionId);

  const testEmail = `e2e-${Date.now()}@webspinner.foundation`;
  console.log('[drive] test email:', testEmail);

  // 1. Start email verification.
  const start = await fetch(`${TRY_BASE}/api/email-verify/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, sessionId }),
  });
  if (!start.ok) {
    const txt = await start.text();
    throw new Error(`email-verify start failed: ${start.status} ${txt.slice(0, 200)}`);
  }
  console.log('[drive] email-verify start: ok');

  // 2. Pull the code from the outbox.
  const code = await pullCodeFromOutbox(testEmail);
  if (!code) throw new Error('could not pull verification code from outbox');
  console.log('[drive] code:', code);

  // 3. Finish verification → get ticket.
  const finish = await fetch(`${TRY_BASE}/api/email-verify/finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, sessionId, code }),
  });
  const finishBody = await finish.json();
  if (!finish.ok || !finishBody.ok) {
    throw new Error('email-verify finish failed: ' + JSON.stringify(finishBody));
  }
  console.log('[drive] email-verify finish: ok; ticket len:', finishBody.ticket.length);
  const ticket = finishBody.ticket;

  // 4. Publish #1.
  const pub1 = await fetch(`${TRY_BASE}/api/app/${sessionId}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket }),
  });
  const pub1Body = await pub1.json();
  if (!pub1.ok || !pub1Body.ok) {
    throw new Error('publish#1 failed: ' + JSON.stringify(pub1Body));
  }
  console.log('[drive] publish#1:', {
    action: pub1Body.action,
    shortCode: pub1Body.shortCode,
    version: pub1Body.version,
    openUrl: pub1Body.openUrl,
  });
  if (!pub1Body.openUrl.startsWith(APP_BASE + '/app/')) {
    throw new Error('publish#1: openUrl does not point at app.webspinner.ai: ' + pub1Body.openUrl);
  }

  // 5. Need a fresh ticket for publish #2 (ticket is one-use through verify
  // consumption; the email-verify row is marked consumed after finish).
  // But the publish endpoint does NOT consume the ticket — it just verifies
  // HMAC + sessionId binding. So we can re-use the same ticket.
  const pub2 = await fetch(`${TRY_BASE}/api/app/${sessionId}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket, passphrase: 'open-sesame' }),
  });
  const pub2Body = await pub2.json();
  if (!pub2.ok || !pub2Body.ok) {
    throw new Error('publish#2 failed: ' + JSON.stringify(pub2Body));
  }
  console.log('[drive] publish#2:', {
    action: pub2Body.action,
    shortCode: pub2Body.shortCode,
    version: pub2Body.version,
  });
  if (pub2Body.action !== 'updated') {
    throw new Error('publish#2 should have action=updated, got: ' + pub2Body.action);
  }
  if (pub2Body.shortCode !== pub1Body.shortCode) {
    throw new Error(
      `publish#2 shortCode (${pub2Body.shortCode}) differs from publish#1 (${pub1Body.shortCode}) — upsert broken`,
    );
  }
  console.log('[drive] ✓ same shortCode across re-publish:', pub2Body.shortCode);

  // 6. /app/[code] preview page.
  const page1 = await ctx.newPage();
  await page1.goto(pub1Body.openUrl);
  await page1.waitForTimeout(1_200);
  await page1.screenshot({ path: join(SHOT_DIR, '01-app-page-locked.png'), fullPage: true });
  const lockedHeading = await page1.locator('.unlock-card h2').count();
  if (lockedHeading > 0) {
    console.log('[drive] ✓ unlock dialog shown (passphrase set on republish)');
    // Test unlock with wrong passphrase first.
    await page1.locator('input[type=password]').fill('wrong');
    await page1.locator('.install-btn').click();
    await page1.waitForTimeout(800);
    await page1.screenshot({ path: join(SHOT_DIR, '02-app-page-wrong-pw.png'), fullPage: true });
    // Now correct.
    await page1.locator('input[type=password]').fill('open-sesame');
    await page1.locator('.install-btn').click();
    await page1.waitForTimeout(1_200);
    await page1.screenshot({ path: join(SHOT_DIR, '03-app-page-unlocked.png'), fullPage: true });
    const cards = await page1.locator('.app-card').count();
    if (cards < 3) throw new Error(`expected ≥3 app-card sections after unlock, got ${cards}`);
    console.log('[drive] ✓ unlocked; cards visible:', cards);
  }

  // 7. /me dashboard — sign in via the UI (the UI's Send-code call
  //    is the ONLY one we want, so we don't bracket-fetch it).
  const page2 = await ctx.newPage();
  await page2.goto(APP_BASE + '/me');
  await page2.waitForTimeout(800);
  await page2.screenshot({ path: join(SHOT_DIR, '10-me-login.png'), fullPage: true });
  await page2.locator('input#email').fill(testEmail);
  await page2.locator('button[type=submit]').click();
  await page2.waitForTimeout(1_500);
  const dashCode = await pullCodeFromOutbox(testEmail);
  if (!dashCode) throw new Error('could not pull author login code');
  console.log('[drive] author login code:', dashCode);
  await page2.locator('input#code').fill(dashCode);
  await page2.locator('button[type=submit]').click();
  await page2.waitForTimeout(2_500);
  await page2.screenshot({ path: join(SHOT_DIR, '11-me-dashboard.png'), fullPage: true });
  const cards = await page2.locator('.webbase-card').count();
  if (cards < 1) throw new Error(`expected ≥1 .webbase-card in dashboard, got ${cards}`);
  console.log('[drive] ✓ dashboard cards visible:', cards);

  console.log('[drive] SUCCESS');
} catch (err) {
  console.error('[drive] FAILED:', err?.message || err);
  exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}
process.exit(exitCode);
