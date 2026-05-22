#!/usr/bin/env node
/**
 * probe-publish-with-sample.mjs — Block 11 backend probe.
 *
 *   1. Run propose → build → seed on a fresh demo session.
 *   2. Mint a ticket; POST /admin/db-app/<sid>/publish with
 *      includeSampleData=true.
 *   3. Read the wp_app_packages row directly and assert
 *      bundle.data.sampleRecords carries an array per entity slug,
 *      each non-empty, each row stripped of PB metadata
 *      (no id / created / updated / collectionId / collectionName).
 *   4. Hit /run/<shortCode>?t=<installToken> and assert the page
 *      load includes the sampleRecords in its data payload (rendered
 *      into a __sveltekit_data script).
 *   5. Publish AGAIN with includeSampleData=false → bundle.data is
 *      null (or missing sampleRecords).
 *
 * Run on Kepler:
 *   node ~/warp/tools/probe-publish-with-sample.mjs
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHmac } from 'node:crypto';

const PB_URL = process.env.WARP_PB_URL ?? 'http://127.0.0.1:8091';
const DEMO_LOOM = process.env.DEMO_LOOM_URL ?? 'http://127.0.0.1:3010';
const BOOT = process.env.WARP_BOOTSTRAP_DEMO_DIR ?? join(homedir(), '.warp/bootstrap-demo');
const PB_EMAIL = readFileSync(join(BOOT, 'pb-email'), 'utf8').trim();
const PB_PASS = readFileSync(join(BOOT, 'pb-password'), 'utf8').trim();
const MASTER_KEY = process.env.WARP_HUB_COOKIE_KEY ?? process.env.WARP_VAULT_MASTER_KEY;
if (!MASTER_KEY) {
  console.error('WARP_VAULT_MASTER_KEY required');
  process.exit(2);
}

const SESSION_ID = `demo-sample-probe-${randomBytes(4).toString('hex')}`;
const TEST_EMAIL = `probe-sample-${Date.now()}@warp.test`;

let failures = 0;
function check(label, cond, detail = '') {
  if (cond) console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

function mintTicket(email, sessionId, masterKey, ttlMs = 30 * 60 * 1000) {
  const expiry = Date.now() + ttlMs;
  const payload = `${email}|${sessionId}|${expiry}`;
  const sig = createHmac('sha256', masterKey).update(payload).digest('hex').slice(0, 32);
  return Buffer.from(payload + '|' + sig).toString('base64url');
}

async function pbAuth() {
  const r = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASS }),
  });
  if (!r.ok) throw new Error(`pb-auth: ${r.status} ${await r.text()}`);
  return (await r.json()).token;
}

async function loomLogin() {
  const r = await fetch(`${DEMO_LOOM}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: DEMO_LOOM },
    body: new URLSearchParams({ wizard_id: PB_EMAIL, passphrase: PB_PASS }),
  });
  if (r.status !== 200) throw new Error(`demo-loom login: ${r.status}`);
  const m = (r.headers.get('set-cookie') ?? '').match(/wp_session=[^;]+/);
  if (!m) throw new Error('no wp_session');
  return m[0];
}

async function invoke(cookie, capability, input) {
  const r = await fetch(`${DEMO_LOOM}/admin/spinners/database-application/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ capability, sessionId: SESSION_ID, input }),
  });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}

async function main() {
  console.log(`→ probe-publish-with-sample  session=${SESSION_ID}`);
  const token = await pbAuth();
  const cookie = await loomLogin();

  // 1. propose + build + seed
  const propose = await invoke(cookie, 'propose', {
    patronSentence: 'Track recipes with ingredients and steps.',
  });
  check('propose ok', propose.body?.ok === true);
  if (!propose.body?.ok) {
    console.error('propose failed:', propose.body);
    process.exit(2);
  }
  const build = await invoke(cookie, 'build', { seedOnFirstOpen: false });
  check('build ok', build.body?.ok === true);
  const entities = build.body?.output?.entities ?? [];
  check('build returned entities', entities.length >= 1, `n=${entities.length}`);

  const seed = await invoke(cookie, 'seed', { count: 5 });
  check('seed ok', seed.body?.ok === true);
  check('seed inserted records', (seed.body?.output?.totalInserted ?? 0) > 0);

  // 2. publish with includeSampleData=true
  const ticket1 = mintTicket(TEST_EMAIL, SESSION_ID, MASTER_KEY);
  const pubRes1 = await fetch(`${DEMO_LOOM}/admin/db-app/${SESSION_ID}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ ticket: ticket1, includeSampleData: true }),
  });
  const pubBody1 = await pubRes1.json().catch(() => null);
  check(
    'publish with sample data returned 200',
    pubRes1.status === 200,
    `status=${pubRes1.status}`,
  );
  check('publish ok', pubBody1?.ok === true, JSON.stringify(pubBody1 ?? {}).slice(0, 200));
  const shortCode1 = pubBody1?.shortCode;
  const installToken1 = pubBody1?.installToken;
  check('shortCode present', typeof shortCode1 === 'string' && shortCode1.length > 0);

  // 3. inspect the wp_app_packages row directly — Block-11 stores
  // the snapshot in the sibling `sample_records` column, not inside
  // the signed bundle.
  if (shortCode1) {
    const pkgRes = await fetch(
      `${PB_URL}/api/collections/wp_app_packages/records?perPage=1&filter=${encodeURIComponent(`short_code = "${shortCode1}"`)}`,
      { headers: { Authorization: token } },
    );
    const pkgBody = await pkgRes.json();
    const row = pkgBody.items?.[0];
    check('package row exists', !!row);
    const samples = row?.sample_records ?? null;
    check(
      'package row sample_records is an object',
      !!samples && typeof samples === 'object',
      `keys=${Object.keys(samples ?? {}).join(',')}`,
    );
    let perEntityOk = 0;
    let totalRows = 0;
    if (samples) {
      for (const e of entities) {
        const arr = samples[e.slug];
        if (Array.isArray(arr) && arr.length > 0) {
          perEntityOk++;
          totalRows += arr.length;
        }
      }
    }
    check(
      'every entity has at least one sample row',
      perEntityOk === entities.length,
      `${perEntityOk}/${entities.length}`,
    );
    check('total snapshot rows > 0', totalRows > 0, `total=${totalRows}`);
    // Spot-check: PB metadata stripped on a sample row.
    const firstSlug = entities[0]?.slug;
    const firstRow = firstSlug ? samples?.[firstSlug]?.[0] : null;
    if (firstRow && typeof firstRow === 'object') {
      const keys = Object.keys(firstRow);
      const meta = keys.filter((k) =>
        ['id', 'created', 'updated', 'collectionId', 'collectionName', 'expand'].includes(k),
      );
      check('PB metadata stripped from sample rows', meta.length === 0, `keys=${keys.join(',')}`);
    } else {
      check('first sample row inspectable', false, 'no row to spot-check');
    }
  }

  // 4. fetch /run/<shortCode> and verify the SvelteKit data payload
  //    carries sampleRecords (server-rendered into the HTML).
  if (shortCode1 && installToken1) {
    const runRes = await fetch(
      `${DEMO_LOOM}/run/${shortCode1}?t=${encodeURIComponent(installToken1)}`,
      { headers: { Accept: 'text/html' } },
    );
    const html = await runRes.text();
    check(
      '/run page returns 200',
      runRes.status === 200,
      `status=${runRes.status} bodyLen=${html.length}`,
    );
    // The SvelteKit-rendered HTML embeds the server data; we check
    // the verbatim presence of the sampleRecords key in the HTML.
    check('/run HTML embeds sampleRecords key', html.includes('sampleRecords'), '');
  }

  // 5. publish AGAIN with includeSampleData=false — bundle.data null.
  const ticket2 = mintTicket(TEST_EMAIL, SESSION_ID, MASTER_KEY);
  const pubRes2 = await fetch(`${DEMO_LOOM}/admin/db-app/${SESSION_ID}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ ticket: ticket2 }),
  });
  const pubBody2 = await pubRes2.json().catch(() => null);
  check('re-publish without sample returned 200', pubRes2.status === 200);
  check(
    're-publish short_code stable',
    pubBody2?.shortCode === shortCode1,
    `${pubBody2?.shortCode} vs ${shortCode1}`,
  );
  if (pubBody2?.shortCode) {
    const pkgRes = await fetch(
      `${PB_URL}/api/collections/wp_app_packages/records?perPage=1&filter=${encodeURIComponent(`short_code = "${pubBody2.shortCode}"`)}`,
      { headers: { Authorization: token } },
    );
    const pkgBody = await pkgRes.json();
    const row = pkgBody.items?.[0];
    check(
      're-publish without sample clears sample_records column',
      row?.sample_records === null || row?.sample_records === undefined,
      `value=${JSON.stringify(row?.sample_records)}`,
    );
  }

  console.log(failures === 0 ? '\n✓ all checks passed' : `\n✗ ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('probe crashed:', e?.message ?? e);
  process.exit(2);
});
