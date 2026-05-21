// Validate every generated precedent JSON against the ScreensDraft
// shape from loom/src/lib/server/database-applications.ts. Fail loud
// if any precedent drifts.

import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const DIR = join(REPO, 'foundation-precedents');

const SCREEN_KINDS = new Set(['form', 'list', 'detail', 'report']);
const FIELD_KINDS = new Set([
  'text',
  'long-text',
  'number',
  'date',
  'money',
  'yes-no',
  'choice',
  'multi-choice',
  'link-to',
]);

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function checkField(f, ctx) {
  if (typeof f.id !== 'string') fail(`${ctx}: field missing id`);
  if (typeof f.label !== 'string') fail(`${ctx}: field ${f.id} missing label`);
  if (!FIELD_KINDS.has(f.kind)) fail(`${ctx}: field ${f.id} bad kind ${f.kind}`);
  if (f.options !== undefined && !Array.isArray(f.options))
    fail(`${ctx}: field ${f.id} options not array`);
  if (f.kind === 'link-to' && typeof f.linkTo !== 'string')
    fail(`${ctx}: field ${f.id} link-to missing linkTo`);
}

function checkScreen(s, ctx, _entities) {
  if (typeof s.id !== 'string') fail(`${ctx}: screen missing id`);
  if (!SCREEN_KINDS.has(s.kind)) fail(`${ctx}: screen ${s.id} bad kind ${s.kind}`);
  if (typeof s.name !== 'string') fail(`${ctx}: screen ${s.id} missing name`);
  if (typeof s.parentEntity !== 'string') fail(`${ctx}: screen ${s.id} missing parentEntity`);
  if (s.kind === 'form') {
    if (!Array.isArray(s.layout?.sections)) fail(`${ctx}: ${s.id} form missing sections`);
    for (const sec of s.layout.sections) {
      if (!Array.isArray(sec.fields)) fail(`${ctx}: ${s.id} section missing fields`);
      for (const fd of sec.fields) checkField(fd, `${ctx}.${s.id}`);
    }
  } else if (s.kind === 'list') {
    if (!Array.isArray(s.layout?.columns)) fail(`${ctx}: ${s.id} list missing columns`);
  } else if (s.kind === 'detail') {
    if (!Array.isArray(s.layout?.showFields)) fail(`${ctx}: ${s.id} detail missing showFields`);
  } else if (s.kind === 'report') {
    if (typeof s.layout?.describes !== 'string') fail(`${ctx}: ${s.id} report missing describes`);
    if (!Array.isArray(s.layout?.sourceEntities))
      fail(`${ctx}: ${s.id} report missing sourceEntities`);
  }
}

function validate(slug) {
  const path = join(DIR, slug, 'schema.json');
  let schema;
  try {
    schema = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(`${slug}: cannot parse schema.json: ${e.message}`);
  }
  if (typeof schema.appName !== 'string') fail(`${slug}: missing appName`);
  if (typeof schema.domain !== 'string') fail(`${slug}: missing domain`);
  if (!Array.isArray(schema.screens)) fail(`${slug}: missing screens`);
  if (!Array.isArray(schema.navigation)) fail(`${slug}: missing navigation`);
  const entities = new Set(schema.screens.map((s) => s.parentEntity));
  for (const s of schema.screens) checkScreen(s, slug, entities);
  // Link-to integrity: every linkTo target must be a known entity.
  for (const s of schema.screens) {
    if (s.kind !== 'form') continue;
    for (const sec of s.layout.sections) {
      for (const f of sec.fields) {
        if (f.kind === 'link-to' && !entities.has(f.linkTo)) {
          fail(`${slug}: field ${s.id}.${f.id} link-to=${f.linkTo} not an entity`);
        }
      }
    }
  }
  // Navigation integrity: every nav screen id exists.
  const screenIds = new Set(schema.screens.map((s) => s.id));
  for (const g of schema.navigation) {
    for (const sid of g.screens) {
      if (!screenIds.has(sid)) fail(`${slug}: nav screen ${sid} not in screens`);
    }
  }
  // Branding sanity.
  if (!schema.branding?.options?.length) fail(`${slug}: missing branding`);
  return {
    slug,
    entities: entities.size,
    screens: schema.screens.length,
    nav: schema.navigation.length,
    fields: schema.screens
      .filter((s) => s.kind === 'form')
      .reduce((n, s) => n + s.layout.sections.reduce((m, sec) => m + sec.fields.length, 0), 0),
  };
}

const slugs = readdirSync(DIR).filter((d) => !d.startsWith('.'));
const summary = slugs.map(validate);
console.table(summary);
console.log(`\nAll ${slugs.length} precedents valid.`);
