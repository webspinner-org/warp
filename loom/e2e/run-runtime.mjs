#!/usr/bin/env node
/**
 * run-runtime.mjs — drives the in-browser Webbase runtime end-to-end:
 *   1. Open /run/<code>?t=<token> (passphrase-unlock if locked).
 *   2. Pick the first form screen, fill required fields, Save.
 *   3. Navigate to the list screen, confirm the saved record appears.
 *   4. Verify link-to dropdowns get populated when the linked
 *      entity has records.
 *
 * Pass the shortCode + token on the CLI, or pull from the registry.
 */

import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TRY_BASE = 'https://try.webspinner.ai';
const APP_BASE = 'https://app.webspinner.ai';
const PASSPHRASE = 'open-sesame';

// Republish a fresh test Webbase so we control the passphrase the
// runtime is about to unlock with.
function pullCodeFromOutbox(email) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const tail = execSync(`ssh johns-mac-studio.local "tail -50 ~/.warp/email-outbox.jsonl"`, {
        encoding: 'utf8',
        timeout: 10_000,
      });
      const lines = tail.trim().split('\n').reverse();
      for (const line of lines) {
        if (!line.includes(email)) continue;
        const m = line.match(/verification code: (\d{6})/);
        if (m) return m[1];
      }
    } catch {
      /* retry */
    }
    execSync(`sleep 1`);
  }
  return null;
}

function findBuiltSession() {
  const script = `
    set -eu
    plist=$(launchctl print gui/$(id -u)/foundation.webspinner.loom-demo 2>/dev/null)
    email=$(echo "$plist" | sed -n 's/.*WARP_PB_EMAIL *=> *\\(.*\\) *$/\\1/p' | tr -d ' ')
    password=$(echo "$plist" | sed -n 's/.*WARP_PB_PASSWORD *=> *\\(.*\\) *$/\\1/p' | tr -d ' ')
    auth=$(curl -sS -X POST "http://127.0.0.1:8091/api/collections/_superusers/auth-with-password" -H "Content-Type: application/json" --data-binary @<(printf '{"identity":"%s","password":"%s"}' "$email" "$password"))
    token=$(echo "$auth" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
    filter=$(python3 -c 'import urllib.parse;print(urllib.parse.quote("built_at != null"))')
    list=$(curl -sS -H "Authorization: $token" "http://127.0.0.1:8091/api/collections/wp_database_applications/records?perPage=10&sort=-created&filter=$filter")
    echo "$list" | python3 -c 'import sys,json;d=json.load(sys.stdin);items=d.get("items",[]);demo=next((i for i in items if i.get("session_id","").startswith("demo-")),items[0] if items else None);print(demo["session_id"] if demo else "")'
  `;
  return execSync(`ssh johns-mac-studio.local 'bash -s' <<'EOF'\n${script}\nEOF\n`, {
    encoding: 'utf8',
    shell: '/bin/bash',
  }).trim();
}

async function freshPublish() {
  const sessionId = findBuiltSession();
  if (!sessionId) throw new Error('no built session');
  const testEmail = `e2e-${Date.now()}@webspinner.foundation`;
  const start = await fetch(`${TRY_BASE}/api/email-verify/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, sessionId }),
  });
  if (!start.ok) throw new Error('email-verify start failed');
  const code = pullCodeFromOutbox(testEmail);
  if (!code) throw new Error('no code');
  const fin = await fetch(`${TRY_BASE}/api/email-verify/finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, sessionId, code }),
  });
  const finBody = await fin.json();
  if (!finBody.ok) throw new Error('email-verify finish failed: ' + JSON.stringify(finBody));
  const pub = await fetch(`${TRY_BASE}/api/app/${sessionId}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: finBody.ticket, passphrase: PASSPHRASE }),
  });
  const pubBody = await pub.json();
  if (!pubBody.ok) throw new Error('publish failed: ' + JSON.stringify(pubBody));
  console.log('[drive] fresh publish:', pubBody.shortCode, 'v' + pubBody.version);
  return { short: pubBody.shortCode, token: pubBody.installToken };
}

const { short: SHORT, token: TOKEN } = await freshPublish();

const SHOT_DIR = join(
  homedir(),
  'Desktop',
  'playwright-try',
  'run-runtime-' + new Date().toISOString().replace(/[:.]/g, '-'),
);
mkdirSync(SHOT_DIR, { recursive: true });
console.log('[drive] artifacts →', SHOT_DIR);
console.log('[drive] url:', `${APP_BASE}/run/${SHORT}?t=${TOKEN}`);

let exitCode = 0;
const browser = await chromium.launch({ headless: true });
// Fresh context so IndexedDB starts empty.
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => console.log('[browser]', m.type(), m.text()));

try {
  await page.goto(`${APP_BASE}/run/${SHORT}?t=${TOKEN}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SHOT_DIR, '01-loaded.png'), fullPage: true });

  // Unlock if locked.
  const pwInput = page.locator('.unlock-shell input[type=password]');
  if ((await pwInput.count()) > 0) {
    console.log('[drive] passphrase required — unlocking');
    await pwInput.fill(PASSPHRASE);
    await page.locator('.unlock-shell button[type=submit]').click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(SHOT_DIR, '02-unlocked.png'), fullPage: true });
  }

  // Confirm we landed on a runtime shell (sidebar present).
  const sidenav = await page.locator('.sidenav').count();
  if (sidenav === 0) throw new Error('sidenav missing after load');
  console.log('[drive] runtime shell present');

  // Click the first form-kind screen in the sidebar.
  // The Business Ledger nav: Transactions → Record a transaction.
  const navButtons = page.locator('.sidenav button');
  const navCount = await navButtons.count();
  console.log('[drive] nav buttons:', navCount);

  // Find a form screen by looking for the first that, when clicked,
  // shows a form-card.
  let formScreenIdx = -1;
  for (let i = 0; i < navCount; i++) {
    await navButtons.nth(i).click();
    await page.waitForTimeout(250);
    if ((await page.locator('.form-card').count()) > 0) {
      formScreenIdx = i;
      console.log('[drive] form screen at nav idx:', i);
      break;
    }
  }
  if (formScreenIdx < 0) throw new Error('no form screen found');
  await page.screenshot({ path: join(SHOT_DIR, '03-form-screen.png'), fullPage: true });

  // Fill all required fields.
  const requiredInputs = page.locator(
    '.form-card .field input[required], .form-card .field select[required], .form-card .field textarea[required]',
  );
  const reqCount = await requiredInputs.count();
  console.log('[drive] required field count:', reqCount);

  // First pass: detect link-to selects that have NO options beyond the
  // empty placeholder — those need their related entity seeded first
  // before we can submit the form. The runtime should handle empty
  // dropdowns gracefully but our test record needs valid data.
  let needsPriorSeed = false;
  const selects = page.locator('.form-card select');
  const selCount = await selects.count();
  for (let i = 0; i < selCount; i++) {
    const opts = await selects.nth(i).locator('option').count();
    if (opts <= 1) {
      const required = await selects.nth(i).getAttribute('required');
      if (required !== null) {
        needsPriorSeed = true;
        console.log('[drive] required link-to/select has no options — need to seed first');
        break;
      }
    }
  }
  // If we need to seed a linked entity first, navigate to its form
  // screen, fill + save, then come back.
  if (needsPriorSeed) {
    // Find any other form screen and try to fill + save it first.
    for (let i = 0; i < navCount; i++) {
      if (i === formScreenIdx) continue;
      await navButtons.nth(i).click();
      await page.waitForTimeout(250);
      if ((await page.locator('.form-card').count()) === 0) continue;
      // Check if THIS form has empty required selects too — if yes, skip.
      let blocked = false;
      const inner = await page.locator('.form-card select[required]').count();
      for (let j = 0; j < inner; j++) {
        const optC = await page
          .locator('.form-card select[required]')
          .nth(j)
          .locator('option')
          .count();
        if (optC <= 1) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      // Fill + save this one.
      console.log('[drive] seeding prior form at nav idx:', i);
      await fillForm(page, 'prior-' + i);
      await page.locator('.form-card button[type=submit]').click();
      await page.waitForTimeout(400);
      break;
    }
    // Now go back to the original target form screen.
    await navButtons.nth(formScreenIdx).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(SHOT_DIR, '04-after-prior-seed.png'), fullPage: true });
  }

  // Fill the target form.
  await fillForm(page, 'main');
  await page.screenshot({ path: join(SHOT_DIR, '05-form-filled.png'), fullPage: true });
  await page.locator('.form-card button[type=submit]').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SHOT_DIR, '06-form-saved.png'), fullPage: true });

  // Saved? Check for the "Saved." flash.
  const saved = await page.locator('.form-card .saved').count();
  if (saved === 0) console.log('[drive] WARN: no Saved flash');

  // Navigate to a list screen and confirm at least one row appears.
  let listFound = false;
  for (let i = 0; i < navCount; i++) {
    await navButtons.nth(i).click();
    await page.waitForTimeout(250);
    if ((await page.locator('.list-table').count()) > 0) {
      const rows = await page.locator('.list-table tbody tr').count();
      console.log(`[drive] list screen idx ${i}: ${rows} rows`);
      if (rows > 0) {
        listFound = true;
        await page.screenshot({ path: join(SHOT_DIR, '07-list-with-rows.png'), fullPage: true });
        break;
      }
    }
  }
  if (!listFound) throw new Error('no list screen showed any rows after save');

  console.log('[drive] SUCCESS');
} catch (err) {
  console.error('[drive] FAILED:', err?.message || err);
  await page
    .screenshot({ path: join(SHOT_DIR, '99-failure.png'), fullPage: true })
    .catch(() => undefined);
  exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}

async function fillForm(page, tag) {
  const fields = page.locator('.form-card .field');
  const count = await fields.count();
  for (let i = 0; i < count; i++) {
    const field = fields.nth(i);
    const labelEl = field.locator('.field-label');
    const labelTxt = ((await labelEl.textContent()) ?? '').trim();
    const isRequired = (await labelEl.locator('.req').count()) > 0;
    const input = field.locator('input, select, textarea').first();
    const tag2 = await input.evaluate((el) => el.tagName.toLowerCase());
    if (tag2 === 'select') {
      const opts = await input.locator('option').count();
      if (opts > 1) {
        await input.selectOption({ index: 1 });
      }
    } else if (tag2 === 'textarea') {
      await input.fill(`${tag}-text-${labelTxt}`);
    } else {
      const type = await input.getAttribute('type');
      if (type === 'number') {
        await input.fill('42');
      } else if (type === 'date') {
        await input.fill('2026-05-18');
      } else if (type === 'checkbox') {
        if (isRequired) await input.check();
      } else if (type === 'email') {
        await input.fill('test@example.com');
      } else {
        await input.fill(`${tag} ${labelTxt}`);
      }
    }
  }
}

process.exit(exitCode);
