#!/usr/bin/env node
/**
 * probe-spinner-seed-purge.mjs — Block 10 backend probe.
 *
 *   1. Run propose + build on a fresh demo session so we have a real
 *      app with real PB collections.
 *   2. Invoke `seed` (LLM path) → assert records exist + the
 *      firstRun.seedDone flag flipped.
 *   3. Invoke `seed` again → assert it's a no-op (alreadySeeded=true,
 *      no extra records inserted).
 *   4. Invoke `seed` with `force: true` AND `records` (patron-supplied
 *      shape) → assert records were inserted from the literal payload,
 *      no LLM call.
 *   5. Invoke `purge` with confirm=true → assert all collections empty.
 *   6. Invoke `purge` again → idempotent (zero deletions).
 *   7. Invoke `purge` without confirm → 400/throw.
 *
 *   node ~/warp/tools/probe-spinner-seed-purge.mjs
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const PB_URL = process.env.WARP_PB_URL ?? 'http://127.0.0.1:8091';
const DEMO_LOOM = process.env.DEMO_LOOM_URL ?? 'http://127.0.0.1:3010';
const BOOT = process.env.WARP_BOOTSTRAP_DEMO_DIR ?? join(homedir(), '.warp/bootstrap-demo');
const PB_EMAIL = readFileSync(join(BOOT, 'pb-email'), 'utf8').trim();
const PB_PASS = readFileSync(join(BOOT, 'pb-password'), 'utf8').trim();

const SESSION_ID = `demo-seed-probe-${randomBytes(4).toString('hex')}`;

let failures = 0;
function check(label, cond, detail = '') {
  if (cond) console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
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

async function login() {
  const r = await fetch(`${DEMO_LOOM}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: DEMO_LOOM },
    body: new URLSearchParams({ wizard_id: PB_EMAIL, passphrase: PB_PASS }),
  });
  if (r.status !== 200) throw new Error(`demo-loom login: ${r.status}`);
  const m = (r.headers.get('set-cookie') ?? '').match(/wp_session=[^;]+/);
  if (!m) throw new Error('no wp_session cookie');
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

async function countRecordsAcross(token, entities) {
  let total = 0;
  const per = {};
  for (const e of entities) {
    const r = await fetch(
      `${PB_URL}/api/collections/${e.collectionName}/records?perPage=1&fields=id`,
      { headers: { Authorization: token } },
    );
    if (!r.ok) {
      per[e.slug] = -1;
      continue;
    }
    const b = await r.json();
    per[e.slug] = b.totalItems ?? 0;
    total += per[e.slug];
  }
  return { total, per };
}

async function main() {
  console.log(`→ probe-spinner-seed-purge  loom=${DEMO_LOOM}  session=${SESSION_ID}`);
  const token = await pbAuth();
  const cookie = await login();

  // 1a. Propose. Use a bookkeeping sentence to get a known-shape app.
  const t0 = Date.now();
  const proposeRes = await invoke(cookie, 'propose', {
    patronSentence:
      'Track expenses for a small consulting practice — amount, date, category, paid-to.',
  });
  check('propose returned 200', proposeRes.status === 200, `dur=${Date.now() - t0}ms`);
  check('propose ok', proposeRes.body?.ok === true);
  if (!proposeRes.body?.ok) {
    console.error('propose failed:', proposeRes.body);
    process.exit(2);
  }

  // 1b. Build with seedOnFirstOpen=true so firstRun gets stored.
  const buildRes = await invoke(cookie, 'build', { seedOnFirstOpen: true });
  check('build returned 200', buildRes.status === 200);
  check('build ok', buildRes.body?.ok === true);
  const appEntities = buildRes.body?.output?.entities ?? [];
  check('build returned entities', appEntities.length >= 1, `n=${appEntities.length}`);

  // Confirm firstRun was persisted.
  const appCheck = await fetch(
    `${PB_URL}/api/collections/wp_database_applications/records?perPage=1&filter=${encodeURIComponent('session_id = "' + SESSION_ID + '"')}`,
    { headers: { Authorization: token } },
  );
  const appBody = await appCheck.json();
  const firstRunStored = appBody?.items?.[0]?.schema_draft?.firstRun;
  check(
    'design.firstRun.seedOnFirstOpen persisted',
    firstRunStored?.seedOnFirstOpen === true,
    `value=${JSON.stringify(firstRunStored)}`,
  );

  // Pre-seed: collections should be empty.
  const preCount = await countRecordsAcross(token, appEntities);
  check('pre-seed collections empty', preCount.total === 0, `per=${JSON.stringify(preCount.per)}`);

  // 2. Seed (LLM path), count=5.
  const seedT0 = Date.now();
  const seedRes = await invoke(cookie, 'seed', { count: 5 });
  check('seed returned 200', seedRes.status === 200, `dur=${Date.now() - seedT0}ms`);
  check('seed ok', seedRes.body?.ok === true);
  check('seed phase === "seeded"', seedRes.body?.output?.phase === 'seeded');
  check('seed alreadySeeded === false', seedRes.body?.output?.alreadySeeded === false);
  const seedTotal = seedRes.body?.output?.totalInserted ?? 0;
  check('seed totalInserted >= entities*1', seedTotal >= appEntities.length, `total=${seedTotal}`);

  const postSeed = await countRecordsAcross(token, appEntities);
  check(
    'post-seed PB counts match perEntity',
    postSeed.total === seedTotal,
    `pb=${postSeed.total} response=${seedTotal}`,
  );

  // 3. Re-seed → no-op (alreadySeeded).
  const seedAgain = await invoke(cookie, 'seed', { count: 5 });
  check('re-seed returned 200', seedAgain.status === 200);
  check('re-seed alreadySeeded === true', seedAgain.body?.output?.alreadySeeded === true);
  const postReseed = await countRecordsAcross(token, appEntities);
  check(
    're-seed did NOT add records',
    postReseed.total === postSeed.total,
    `${postReseed.total} vs ${postSeed.total}`,
  );

  // 4. Force re-seed with patron-supplied records (one record per entity).
  const patronRecords = {};
  for (const e of appEntities) {
    const row = {};
    for (const f of e.fields) {
      switch (f.kind) {
        case 'number':
        case 'money':
          row[f.name] = 99;
          break;
        case 'date':
          row[f.name] = '2026-05-01';
          break;
        case 'yes-no':
          row[f.name] = true;
          break;
        default:
          row[f.name] = 'PATRON-LITERAL-' + e.slug;
      }
    }
    patronRecords[e.slug] = [row];
  }
  const forceRes = await invoke(cookie, 'seed', { force: true, records: patronRecords });
  check('force+records returned 200', forceRes.status === 200);
  check('force+records ok', forceRes.body?.ok === true);
  check('force+records modelCalls === 0', forceRes.body?.output?.provenance?.modelCalls === 0);
  const postForce = await countRecordsAcross(token, appEntities);
  check(
    'force+records added exactly one row per entity',
    postForce.total === postSeed.total + appEntities.length,
    `before=${postSeed.total} after=${postForce.total} expected=${postSeed.total + appEntities.length}`,
  );

  // Sample one record from the first entity and confirm the literal landed.
  const firstE = appEntities[0];
  const sampleRes = await fetch(
    `${PB_URL}/api/collections/${firstE.collectionName}/records?perPage=20`,
    { headers: { Authorization: token } },
  );
  const sampleBody = await sampleRes.json();
  const hasLiteral = (sampleBody.items ?? []).some((r) =>
    Object.values(r).some((v) => typeof v === 'string' && v.includes('PATRON-LITERAL')),
  );
  check('patron literal value present in PB', hasLiteral);

  // 5. Purge.
  const purgeRes = await invoke(cookie, 'purge', { confirm: true });
  check('purge returned 200', purgeRes.status === 200);
  check('purge ok', purgeRes.body?.ok === true);
  check('purge phase === "purged"', purgeRes.body?.output?.phase === 'purged');
  const purgeTotal = purgeRes.body?.output?.total ?? -1;
  check(
    'purge.total matches prior count',
    purgeTotal === postForce.total,
    `purge=${purgeTotal} prior=${postForce.total}`,
  );

  const postPurge = await countRecordsAcross(token, appEntities);
  check(
    'post-purge collections empty',
    postPurge.total === 0,
    `per=${JSON.stringify(postPurge.per)}`,
  );

  // 6. Purge again — idempotent.
  const purgeAgain = await invoke(cookie, 'purge', { confirm: true });
  check('re-purge ok', purgeAgain.body?.ok === true);
  check('re-purge total === 0', purgeAgain.body?.output?.total === 0);

  // 7. Purge without confirm → error.
  const noConfirm = await invoke(cookie, 'purge', {});
  check(
    'purge without confirm rejected',
    noConfirm.body?.ok === false ||
      (typeof noConfirm.body?.message === 'string' && /confirm/i.test(noConfirm.body.message)),
    `body=${JSON.stringify(noConfirm.body).slice(0, 120)}`,
  );

  // Also assert firstRun.seedDone is back to false after purge.
  const finalAppCheck = await fetch(
    `${PB_URL}/api/collections/wp_database_applications/records?perPage=1&filter=${encodeURIComponent('session_id = "' + SESSION_ID + '"')}`,
    { headers: { Authorization: token } },
  );
  const finalApp = await finalAppCheck.json();
  const finalFirstRun = finalApp?.items?.[0]?.schema_draft?.firstRun;
  check(
    'firstRun.seedDone reset to false after purge',
    finalFirstRun?.seedDone === false,
    `value=${JSON.stringify(finalFirstRun)}`,
  );

  console.log(failures === 0 ? '\n✓ all checks passed' : `\n✗ ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('probe crashed:', e?.message ?? e);
  process.exit(2);
});
