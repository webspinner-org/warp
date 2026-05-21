#!/usr/bin/env node
/**
 * probe-spinner-edit.mjs — exercise the Block-8 `edit` capability
 * on database-application end-to-end against the demo Loom.
 *
 * Setup:
 *   1. Pre-seed a wp_spinner_sessions row in the demo Loom's PB
 *      (port 8091) with a known screensDraft that has 3 entities
 *      (Note, Tag, Reminder) and a Title field on the Note form.
 *   2. POST /admin/spinners/database-application/invoke with
 *      capability='edit', instruction='rename the Title field to
 *      Headline on the Add Note form', and the same sessionId.
 *
 * Assertions:
 *   - response.ok === true
 *   - output.phase === 'edited'
 *   - output.screensDraft has 3 entities still (no entity drop)
 *   - The Note form's first field's label is 'Headline'
 *   - editLog has one entry in the persisted session state
 *
 * Run on Kepler:
 *   node ~/warp/tools/probe-spinner-edit.mjs
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

const SESSION_ID = `demo-edit-probe-${randomBytes(4).toString('hex')}`;
const PATRON_EMAIL = `probe-edit-${Date.now()}@warp.test`;

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

const initialScreensDraft = {
  appName: 'Notes',
  domain: 'personal note keeping',
  screens: [
    {
      id: 'form-note',
      kind: 'form',
      name: 'Add Note',
      parentEntity: 'note',
      layout: {
        sections: [
          {
            title: 'Note',
            fields: [
              { id: 'title', label: 'Title', kind: 'text', required: true },
              { id: 'body', label: 'Body', kind: 'long-text' },
              { id: 'when', label: 'When', kind: 'date' },
            ],
          },
        ],
      },
    },
    {
      id: 'list-note',
      kind: 'list',
      name: 'All notes',
      parentEntity: 'note',
      layout: { columns: [{ fieldId: 'title' }, { fieldId: 'when' }] },
    },
    {
      id: 'detail-note',
      kind: 'detail',
      name: 'Note details',
      parentEntity: 'note',
      layout: { showFields: ['title', 'body', 'when'] },
    },
    {
      id: 'form-tag',
      kind: 'form',
      name: 'Add Tag',
      parentEntity: 'tag',
      layout: {
        sections: [
          { title: 'Tag', fields: [{ id: 'name', label: 'Name', kind: 'text', required: true }] },
        ],
      },
    },
    {
      id: 'list-tag',
      kind: 'list',
      name: 'All tags',
      parentEntity: 'tag',
      layout: { columns: [{ fieldId: 'name' }] },
    },
    {
      id: 'detail-tag',
      kind: 'detail',
      name: 'Tag details',
      parentEntity: 'tag',
      layout: { showFields: ['name'] },
    },
    {
      id: 'form-reminder',
      kind: 'form',
      name: 'Add Reminder',
      parentEntity: 'reminder',
      layout: {
        sections: [
          {
            title: 'Reminder',
            fields: [
              { id: 'note', label: 'Note', kind: 'link-to', linkTo: 'note' },
              { id: 'due', label: 'Due', kind: 'date', required: true },
            ],
          },
        ],
      },
    },
    {
      id: 'list-reminder',
      kind: 'list',
      name: 'All reminders',
      parentEntity: 'reminder',
      layout: { columns: [{ fieldId: 'note' }, { fieldId: 'due' }] },
    },
    {
      id: 'detail-reminder',
      kind: 'detail',
      name: 'Reminder details',
      parentEntity: 'reminder',
      layout: { showFields: ['note', 'due'] },
    },
  ],
  navigation: [
    { label: 'Notes', primary: true, screens: ['form-note', 'list-note'] },
    { label: 'Tags', primary: false, screens: ['form-tag', 'list-tag'] },
    { label: 'Reminders', primary: false, screens: ['form-reminder', 'list-reminder'] },
  ],
};

async function login() {
  const r = await fetch(`${DEMO_LOOM}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: DEMO_LOOM },
    body: new URLSearchParams({ wizard_id: PB_EMAIL, passphrase: PB_PASS }),
  });
  if (r.status !== 200) throw new Error(`demo-loom login: ${r.status} ${await r.text()}`);
  const cookieHeader = r.headers.get('set-cookie') ?? '';
  const sessionMatch = cookieHeader.match(/wp_session=[^;]+/);
  if (!sessionMatch) throw new Error('demo-loom login: no wp_session cookie set');
  return sessionMatch[0];
}

async function main() {
  console.log(`→ probe-spinner-edit  pb=${PB_URL}  loom=${DEMO_LOOM}  session=${SESSION_ID}`);
  const token = await pbAuth();
  const auth = { Authorization: token, 'Content-Type': 'application/json' };

  // 1. Seed the session row with a known screensDraft.
  const nowIso = new Date().toISOString();
  const seedRes = await fetch(`${PB_URL}/api/collections/wp_spinner_sessions/records`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      spinner_id: '@webspinner-foundation/database-application',
      session_id: SESSION_ID,
      actor_kind: 'wizard',
      actor_id: PATRON_EMAIL,
      actor_email: PATRON_EMAIL,
      phase: 'proposed',
      last_capability: 'propose',
      state: {
        version: 2,
        flow: 'v2',
        screensDraft: initialScreensDraft,
        sentence: 'Notes app for personal use.',
      },
      status: 'active',
      started_at: nowIso,
      updated_at: nowIso,
    }),
  });
  if (!seedRes.ok) {
    console.error(`seed-row failed: ${seedRes.status} ${await seedRes.text()}`);
    process.exit(2);
  }
  const seedRow = await seedRes.json();
  const rowId = seedRow.id;

  try {
    // 2. Invoke the edit capability.
    const cookie = await login();
    const editRes = await fetch(`${DEMO_LOOM}/admin/spinners/database-application/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        capability: 'edit',
        sessionId: SESSION_ID,
        input: {
          instruction: 'Rename the Title field to Headline on the Add Note form.',
          screensDraft: initialScreensDraft,
        },
      }),
    });
    const editBody = await editRes.json().catch(() => ({}));
    if (editRes.status !== 200) {
      console.log(`  [edit body] ${JSON.stringify(editBody).slice(0, 400)}`);
    }
    check('edit returns 200', editRes.status === 200, `status=${editRes.status}`);
    check('edit response.ok', editBody.ok === true);
    const output = editBody.output ?? {};
    check('phase === "edited"', output.phase === 'edited', `phase=${output.phase}`);
    check(
      'narration is a non-empty string',
      typeof output.narration === 'string' && output.narration.length > 0,
      `narration=${(output.narration ?? '').slice(0, 80)}`,
    );
    check('deltas is an array', Array.isArray(output.deltas));
    const updatedDraft = output.screensDraft ?? {};
    const updatedScreens = Array.isArray(updatedDraft.screens) ? updatedDraft.screens : [];
    const entities = new Set(
      updatedScreens.map((s) => s.parentEntity).filter((e) => typeof e === 'string'),
    );
    check(
      'three entities preserved',
      entities.size === 3 && ['note', 'tag', 'reminder'].every((e) => entities.has(e)),
      `entities=${[...entities].sort().join(',')}`,
    );

    const noteForm = updatedScreens.find((s) => s.id === 'form-note');
    const titleField = noteForm?.layout?.sections?.[0]?.fields?.find((f) => f.id === 'title');
    check('Note form still exists', !!noteForm);
    check('Title field still has id="title"', !!titleField);
    check(
      'Title label is now "Headline"',
      titleField?.label === 'Headline',
      `got "${titleField?.label}"`,
    );

    // 3. Read the persisted session state.
    const readRes = await fetch(`${PB_URL}/api/collections/wp_spinner_sessions/records/${rowId}`, {
      headers: { Authorization: token },
    });
    const readBody = await readRes.json();
    const state = readBody.state ?? {};
    check(
      'session state.screensDraft updated',
      state.screensDraft?.screens?.find((s) => s.id === 'form-note')?.layout?.sections?.[0]
        ?.fields?.[0]?.label === 'Headline',
    );
    check(
      'session state.editLog populated',
      Array.isArray(state.editLog) && state.editLog.length === 1,
    );
    check(
      'editLog entry has instruction',
      state.editLog?.[0]?.instruction?.includes('Headline') ||
        state.editLog?.[0]?.instruction?.includes('Title'),
    );

    // 4. Negative path — instruction asking for a brand-new entity should be rejected.
    const badEditRes = await fetch(`${DEMO_LOOM}/admin/spinners/database-application/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        capability: 'edit',
        sessionId: SESSION_ID,
        input: {
          instruction:
            'Add a brand-new entity called Project with its own form, list, and detail screens.',
          screensDraft: initialScreensDraft,
        },
      }),
    });
    const badBody = await badEditRes.json().catch(() => ({}));
    // Either the LLM refused (ok: true, no new entity) or the validation
    // tripped (ok: false). Both count as the invariant holding.
    const badEntities = badBody?.output?.screensDraft?.screens
      ? new Set(
          badBody.output.screensDraft.screens
            .map((s) => s.parentEntity)
            .filter((e) => typeof e === 'string'),
        )
      : null;
    const invariantHeld =
      badBody?.ok === false ||
      (badEntities && [...badEntities].every((e) => ['note', 'tag', 'reminder'].includes(e)));
    check(
      'new-entity request did not introduce a new entity',
      !!invariantHeld,
      `entities=${badEntities ? [...badEntities].sort().join(',') : '(none)'}`,
    );
  } finally {
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
