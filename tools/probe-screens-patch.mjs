#!/usr/bin/env node
/**
 * probe-screens-patch.mjs — end-to-end test of the Block-6
 * PATCH /api/sessions/[sessionId]/screens endpoint.
 *
 * What it does:
 *   1. Authenticate to PocketBase as superuser.
 *   2. Create a synthetic wp_spinner_sessions row for spinner_id=
 *      database-application with a known patron actor_email and a
 *      pre-populated screensDraft + other state fields we expect to
 *      survive untouched.
 *   3. Mint a warp_hub cookie for that patron email using the master
 *      key the Loom reads at boot.
 *   4. PATCH the new endpoint with an edited screensDraft.
 *   5. Read back the PB row and assert:
 *        - state.screensDraft was replaced
 *        - state.screensDraftEditedAt is fresh and ISO
 *        - state.clarifications / state.provenance / state.sentence
 *          are untouched
 *   6. Exercise the negative paths (wrong email → 403, malformed body
 *      → 400, missing session → 404, oversize body → 413).
 *   7. Delete the test row.
 *
 * Run on Kepler (the master key and PB live there):
 *   node ~/warp/tools/probe-screens-patch.mjs
 */

import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PB_URL = process.env.WARP_PB_URL ?? 'http://127.0.0.1:8090';
const LOOM_URL = process.env.WARP_LOOM_URL ?? 'http://johns-mac-studio.local:3000';
const PB_EMAIL =
  process.env.WARP_PB_EMAIL ??
  readFileSync(join(homedir(), '.warp/bootstrap/pb-email'), 'utf8').trim();
const PB_PASS =
  process.env.WARP_PB_PASSWORD ??
  readFileSync(join(homedir(), '.warp/bootstrap/pb-password'), 'utf8').trim();
const MASTER_KEY = process.env.WARP_HUB_COOKIE_KEY ?? process.env.WARP_VAULT_MASTER_KEY;
if (!MASTER_KEY) {
  console.error('WARP_HUB_COOKIE_KEY or WARP_VAULT_MASTER_KEY required');
  process.exit(2);
}

const PATRON_EMAIL = `probe-block6+${Date.now()}@warp.test`;
const OTHER_EMAIL = `probe-block6-other+${Date.now()}@warp.test`;
const SESSION_ID = `probe-block6-${randomBytes(6).toString('hex')}`;

let failures = 0;
function check(label, cond, detail = '') {
  if (cond) console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

function hubCookie(email, ttlMs = 60_000) {
  const expiry = Date.now() + ttlMs;
  const sig = createHmac('sha256', MASTER_KEY)
    .update(`${email}|${expiry}`)
    .digest('hex')
    .slice(0, 32);
  const raw = `${email}|${expiry}|${sig}`;
  return Buffer.from(raw).toString('base64url');
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

const initialScreensDraft = {
  appName: 'probe',
  domain: 'probe.local',
  screens: [
    {
      id: 'screen-1',
      kind: 'form',
      name: 'Item',
      parentEntity: 'item',
      layout: {
        sections: [
          {
            label: 'Item',
            fields: [
              { id: 'name', label: 'Name', kind: 'text', required: true },
              { id: 'qty', label: 'Quantity', kind: 'number' },
            ],
          },
        ],
      },
    },
  ],
  navigation: [{ label: 'Items', primary: true, screens: ['screen-1'] }],
};

const editedScreensDraft = JSON.parse(JSON.stringify(initialScreensDraft));
editedScreensDraft.screens[0].layout.sections[0].fields[0].label = 'Item name'; // rename
editedScreensDraft.screens[0].layout.sections[0].fields.splice(1, 1); // delete qty
editedScreensDraft.screens[0].layout.sections[0].fields.push({
  id: 'field_xyz',
  label: 'Tags',
  kind: 'text',
}); // add

async function main() {
  console.log(`→ probe-screens-patch  pb=${PB_URL}  loom=${LOOM_URL}  session=${SESSION_ID}`);
  const token = await pbAuth();
  const auth = { Authorization: token, 'Content-Type': 'application/json' };

  // 1. Create the test session row.
  const initialState = {
    screensDraft: initialScreensDraft,
    clarifications: [],
    sentence: 'I want to track items in my warehouse.',
    provenance: { provider: 'probe', modelCalls: 0 },
  };
  const nowIso = new Date().toISOString();
  const create = await fetch(`${PB_URL}/api/collections/wp_spinner_sessions/records`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      spinner_id: 'database-application',
      session_id: SESSION_ID,
      actor_kind: 'wizard',
      actor_id: PATRON_EMAIL,
      actor_email: PATRON_EMAIL,
      phase: 'propose',
      last_capability: 'propose',
      state: initialState,
      status: 'active',
      started_at: nowIso,
      updated_at: nowIso,
    }),
  });
  if (!create.ok) {
    console.error(`create-row: ${create.status} ${await create.text()}`);
    process.exit(2);
  }
  const row = await create.json();
  const rowId = row.id;

  try {
    const cookie = `warp_hub=${hubCookie(PATRON_EMAIL)}`;
    const cookieOther = `warp_hub=${hubCookie(OTHER_EMAIL)}`;

    // 2. Happy path: PATCH with valid edited screensDraft.
    const patchRes = await fetch(`${LOOM_URL}/api/sessions/${SESSION_ID}/screens`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ screensDraft: editedScreensDraft }),
    });
    const patchBody = await patchRes.json().catch(() => ({}));
    check('PATCH happy path returns 200', patchRes.status === 200, `status=${patchRes.status}`);
    check('response.ok is true', patchBody?.ok === true);
    check('response includes screensDraft', !!patchBody?.screensDraft);
    check(
      'response screensDraft has 2 fields',
      patchBody?.screensDraft?.screens?.[0]?.layout?.sections?.[0]?.fields?.length === 2,
    );

    // 3. Read the row back and verify the merge preserved other state.
    const readRes = await fetch(`${PB_URL}/api/collections/wp_spinner_sessions/records/${rowId}`, {
      headers: { Authorization: token },
    });
    const readBody = await readRes.json();
    const state = readBody.state ?? {};
    check('state.sentence preserved', state.sentence === initialState.sentence);
    check('state.clarifications preserved (empty array)', Array.isArray(state.clarifications));
    check(
      'state.provenance preserved',
      state.provenance?.provider === 'probe',
      `provider=${state.provenance?.provider}`,
    );
    check(
      'state.screensDraft replaced — field 0 label is "Item name"',
      state.screensDraft?.screens?.[0]?.layout?.sections?.[0]?.fields?.[0]?.label === 'Item name',
    );
    check(
      'state.screensDraft replaced — field 1 label is "Tags"',
      state.screensDraft?.screens?.[0]?.layout?.sections?.[0]?.fields?.[1]?.label === 'Tags',
    );
    check(
      'state.screensDraftEditedAt is ISO date',
      /^\d{4}-\d{2}-\d{2}T/.test(state.screensDraftEditedAt ?? ''),
    );

    // 4. Wrong patron → 403
    const wrongRes = await fetch(`${LOOM_URL}/api/sessions/${SESSION_ID}/screens`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookieOther },
      body: JSON.stringify({ screensDraft: editedScreensDraft }),
    });
    check('wrong-patron PATCH returns 403', wrongRes.status === 403, `status=${wrongRes.status}`);

    // 5. Missing cookie → 401
    const noAuthRes = await fetch(`${LOOM_URL}/api/sessions/${SESSION_ID}/screens`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ screensDraft: editedScreensDraft }),
    });
    check('no-cookie PATCH returns 401', noAuthRes.status === 401, `status=${noAuthRes.status}`);

    // 6. Malformed JSON → 400
    const badJsonRes = await fetch(`${LOOM_URL}/api/sessions/${SESSION_ID}/screens`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: 'not-json',
    });
    check('bad-JSON PATCH returns 400', badJsonRes.status === 400, `status=${badJsonRes.status}`);

    // 7. Missing screensDraft.screens → 400
    const badShapeRes = await fetch(`${LOOM_URL}/api/sessions/${SESSION_ID}/screens`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ screensDraft: { foo: 'bar' } }),
    });
    check(
      'bad-shape PATCH returns 400',
      badShapeRes.status === 400,
      `status=${badShapeRes.status}`,
    );

    // 8. Unknown session → 404
    const unknownRes = await fetch(
      `${LOOM_URL}/api/sessions/does-not-exist-${Date.now()}/screens`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ screensDraft: editedScreensDraft }),
      },
    );
    check(
      'unknown-session PATCH returns 404',
      unknownRes.status === 404,
      `status=${unknownRes.status}`,
    );

    // 9. Oversize body → 413 (compose ~300 KB)
    const bigField = (label) => ({ id: 'f', label, kind: 'text' });
    const giantDraft = {
      screens: [
        {
          id: 'screen-big',
          kind: 'form',
          layout: {
            sections: [
              {
                fields: Array.from({ length: 2000 }, () => bigField('x'.repeat(150))),
              },
            ],
          },
        },
      ],
    };
    const giantRes = await fetch(`${LOOM_URL}/api/sessions/${SESSION_ID}/screens`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ screensDraft: giantDraft }),
    });
    check('oversize PATCH returns 413', giantRes.status === 413, `status=${giantRes.status}`);
  } finally {
    // Clean up.
    await fetch(`${PB_URL}/api/collections/wp_spinner_sessions/records/${rowId}`, {
      method: 'DELETE',
      headers: { Authorization: token },
    });
  }

  console.log(failures === 0 ? '\n✓ all checks passed' : `\n✗ ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('probe crashed:', e);
  process.exit(2);
});
