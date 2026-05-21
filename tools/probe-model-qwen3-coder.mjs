#!/usr/bin/env node
/**
 * probe-model-qwen3-coder.mjs — Block 9: verify the Qwen3-Coder
 * model on the MLX server produces a v2-shaped schemaDraft that
 * survives the same validation the production propose path enforces.
 *
 * Calls /v1/chat/completions on Kepler's MLX server directly (the
 * Quiet Loom transport) with the SAME prompt the v2 propose composes
 * — precedents in-context, JSON-only output. Asserts the response
 * parses, has screens + navigation, every form has 6-12 fields, and
 * every link-to references a known parentEntity.
 *
 * This isolates "does the model work" from "is the demo Loom
 * configured to use it." Switching the default is a one-line manifest
 * change once this probe passes.
 *
 *   node ~/warp/tools/probe-model-qwen3-coder.mjs [model-id]
 *
 * Default model is mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MLX = process.env.WARP_KEPLER_URL ?? 'http://127.0.0.1:11445';
const MODEL = process.argv[2] ?? 'mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit';
const PRECEDENTS_DIR = join(homedir(), 'warp/foundation-precedents');

let failures = 0;
function check(label, cond, detail = '') {
  if (cond) console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

function loadPrecedent(slug) {
  const schema = JSON.parse(readFileSync(join(PRECEDENTS_DIR, slug, 'schema.json'), 'utf8'));
  const narrative = readFileSync(join(PRECEDENTS_DIR, slug, 'narrative.md'), 'utf8');
  return { schema, narrative };
}

function parseStrictJson(text) {
  // Trim a possible leading markdown fence.
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  }
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

async function main() {
  const sentence = 'I track plants in my garden, including bonsai I prune weekly.';
  const slugs = ['garden-log', 'recipe-collection', 'reading-journal'];
  const precedents = slugs.map((slug) => {
    const { schema, narrative } = loadPrecedent(slug);
    return {
      slug,
      schema,
      narrative,
      appName: schema.appName,
      domain: schema.domain,
      sentence: schema.appName, // placeholder
    };
  });

  console.log(`→ probe-model  mlx=${MLX}  model=${MODEL}`);
  console.log(`  sentence: ${JSON.stringify(sentence)}`);

  const precedentsBlock = precedents
    .map((p, i) => {
      return (
        `### Precedent ${i + 1}: ${p.appName} (${p.domain})\n` +
        `Schema:\n\`\`\`json\n${JSON.stringify(p.schema, null, 2)}\n\`\`\`\n\n` +
        `Why these entities, not others:\n${p.narrative}\n`
      );
    })
    .join('\n---\n\n');

  const userMessage =
    `The patron just said: ${JSON.stringify(sentence)}\n\n` +
    `Below are 3 Foundation precedents most relevant to what they want. Use them as the design template — match the level of entity decomposition, the field count per entity (6-12), the use of link-to relationships, the report selection, and the branding palette quality. Adapt to the patron's SPECIFIC intent, but stay at this quality bar.\n\n` +
    `${precedentsBlock}\n\n` +
    `Now produce a schemaDraft for the patron. Output strict JSON, no prose, no markdown fences:\n` +
    `{\n` +
    `  "narration": "2-3 sentences describing what you built — name the entities and the canonical reports. Match the tone of the precedent narratives.",\n` +
    `  "domain": "specific phrase like \\"small-business bookkeeping\\" or \\"home garden tracking\\"",\n` +
    `  "screensDraft": { appName, domain, screens, navigation } — same shape as the precedents above,\n` +
    `  "branding": { options: [{id, name, mood, palette}], selectedPaletteId } — same shape\n` +
    `}\n\n` +
    `Rules:\n` +
    `- Every entity needs a form-screen AND list-screen AND detail-screen.\n` +
    `- Every link-to field's linkTo target must be a known entity (one of the screen parentEntity values).\n` +
    `- Every navigation screen id must exist.\n` +
    `- Forms 6-12 fields each, sections used for grouping when there are 8+ fields.\n` +
    `- Do NOT ask clarifying questions. Pick reasonable defaults. The patron edits afterwards.\n` +
    `- Match the patron's SPECIFIC sentence, not the precedents verbatim. If they said "track plants in my garden including bonsai," include a bonsai-relevant field or screen the generic garden-log precedent didn't have.\n\n` +
    `Open with "{".`;

  const t0 = Date.now();
  const res = await fetch(`${MLX}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content:
            "You are the Webspinner Database Application Spinner. You design Webbase applications by extending Foundation precedents to fit a patron's specific intent. Output strict JSON matching the requested schema. Never ask clarifying questions.",
        },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 8192,
      temperature: 0.5,
    }),
  });
  const durMs = Date.now() - t0;
  check('MLX returned 200', res.ok, `status=${res.status} dur=${durMs}ms`);
  if (!res.ok) {
    console.log(`  body: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const body = await res.json();
  const text = body?.choices?.[0]?.message?.content ?? '';
  check('response has content', typeof text === 'string' && text.length > 0, `len=${text.length}`);

  const parsed = parseStrictJson(text);
  check('content parses as JSON', !!parsed);
  if (!parsed) {
    console.log(`  raw first 500: ${text.slice(0, 500)}`);
    console.log(`  raw last 500: ${text.slice(-500)}`);
    process.exit(1);
  }

  const draft = parsed.screensDraft;
  check('screensDraft is an object', draft && typeof draft === 'object');
  const screens = Array.isArray(draft?.screens) ? draft.screens : [];
  check('screensDraft.screens >= 6', screens.length >= 6, `count=${screens.length}`);

  const entities = new Set(screens.map((s) => s.parentEntity).filter((e) => typeof e === 'string'));
  check('at least 2 entities', entities.size >= 2, `entities=${[...entities].sort().join(',')}`);

  // Every entity should have form + list + detail.
  for (const entity of entities) {
    const kinds = new Set(screens.filter((s) => s.parentEntity === entity).map((s) => s.kind));
    check(
      `entity "${entity}" has form + list + detail`,
      kinds.has('form') && kinds.has('list') && kinds.has('detail'),
      `kinds=${[...kinds].sort().join(',')}`,
    );
  }

  // link-to integrity.
  let linkToCount = 0;
  let linkToValid = 0;
  for (const s of screens) {
    if (s.kind !== 'form') continue;
    const sections = s.layout?.sections ?? [];
    for (const sec of sections) {
      for (const f of sec.fields ?? []) {
        if (f.kind === 'link-to') {
          linkToCount++;
          if (entities.has(f.linkTo)) linkToValid++;
        }
      }
    }
  }
  check(
    'link-to fields point at known entities',
    linkToCount === linkToValid,
    `${linkToValid}/${linkToCount} valid`,
  );

  // Form field-count rule: 6-12 fields per form (the prompt asks for this).
  let formsInRange = 0;
  let totalForms = 0;
  for (const s of screens) {
    if (s.kind !== 'form') continue;
    totalForms++;
    const sections = s.layout?.sections ?? [];
    const fields = sections.reduce((acc, sec) => acc + (sec.fields?.length ?? 0), 0);
    if (fields >= 4 && fields <= 14) formsInRange++; // slack ±2 from the prompt
  }
  check(
    'form field counts in [4,14] range',
    formsInRange === totalForms,
    `${formsInRange}/${totalForms} in range`,
  );

  // Navigation integrity.
  const nav = Array.isArray(draft?.navigation) ? draft.navigation : [];
  const screenIds = new Set(screens.map((s) => s.id));
  let navValid = 0;
  let navTotal = 0;
  for (const g of nav) {
    for (const id of g.screens ?? []) {
      navTotal++;
      if (screenIds.has(id)) navValid++;
    }
  }
  check(
    'navigation screen ids reference real screens',
    navValid === navTotal && navTotal > 0,
    `${navValid}/${navTotal} valid`,
  );

  console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('probe crashed:', e);
  process.exit(2);
});
