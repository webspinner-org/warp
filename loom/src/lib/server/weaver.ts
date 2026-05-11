// Bootstrap Weaver — the in-Loom invocation runtime.
//
// Per `DECISIONS.md` 2026-05-10 — *Bootstrap Weaver runs inside the Loom*
// — this is the explicit one-time God exception. The canonical Weaver is
// Python+FastAPI per the Default-stack decision; this Node runtime is a
// transitional shim that supersedes when the canonical Weaver lands.
// Until then, the contract that Spinners see (vault → Spool reads →
// model call → audit emission → Silk Pattern append) is the same shape
// the canonical Weaver will honour.

import type {
  AuditResult,
  SpinnerManifest,
  SpinnerName,
  SpoolName,
  SpoolPassage,
} from '@webspinner-foundation/sdk';
import { authSuperuser } from './pocketbase.js';
import { decryptValue, type EncryptedValue } from './crypto.js';
import {
  callAnthropic,
  resolveAnthropicModel,
  AnthropicCallError,
} from './anthropic.js';
import { quietLoomChat, resolveKeplerModel, KeplerCallError } from './kepler.js';
import { retrieveTopK, spoolToSourceFile, type RetrievedPassage } from './embedding-retrieval.js';
import { readSpool, knownSpools } from './spools.js';
import {
  ensureJournalCollection,
  createEntry,
  recallEntries,
  listRecent,
  countEntries,
  type EntryKind,
  type JournalEntry,
} from './journal.js';
import { createShellRunner, ShellPermissionError, type ShellRunResult } from './shell.js';
import { addSecret, ensureCollection as ensureVaultCollection } from './secrets.js';
import { readFile, writeFile, mkdir, chmod, stat as fsStat } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import { platform as osPlatform, hostname as osHostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  ensureAuditCollection,
  writeAuditEvent,
  type AuditWriteRequest,
} from './audit.js';
import {
  appendSilkPattern,
  ensureSilkPatternCollection,
  summariseInput,
  summariseOutput,
} from './silk-pattern.js';
import { loadSpinner, loadSpinnerDoc } from './spinners.js';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';

export interface InvokeRequest {
  readonly slug: string;
  readonly capability: string;
  readonly input: unknown;
  readonly actorEmail: string;
  readonly actorId: string;
}

export interface InvokeSuccess {
  readonly ok: true;
  readonly output: unknown;
  readonly durationMs: number;
  readonly auditEventId: string;
  readonly silkEntryId: string;
  readonly modelTokens: { readonly input: number; readonly output: number };
}

export interface InvokeFailure {
  readonly ok: false;
  readonly kind: 'unknown-spinner' | 'unknown-capability' | 'integrity-gated' | 'pending' | 'config' | 'vault' | 'model' | 'internal';
  readonly message: string;
  readonly auditEventId?: string;
  readonly silkEntryId?: string;
}

export type InvokeResult = InvokeSuccess | InvokeFailure;

const DISPATCH = new Map<SpinnerName, Set<string>>([
  ['@webspinner-foundation/bootstrap' as SpinnerName, new Set(['consult', 'audit', 'record', 'surface'])],
  ['@webspinner-foundation/pablo' as SpinnerName, new Set(['review'])],
  ['@webspinner-foundation/wizards-journal' as SpinnerName, new Set(['record', 'recall', 'bootstrap'])],
  ['@webspinner-foundation/genesis' as SpinnerName, new Set(['provisionToolchain', 'syncRepo', 'buildWorkspace', 'generateBootstrapState', 'deployGrimoire', 'seedVault', 'deployLoom', 'verifyCell'])],
]);

const IMPLEMENTED = new Map<SpinnerName, Set<string>>([
  ['@webspinner-foundation/bootstrap' as SpinnerName, new Set(['consult', 'audit', 'record', 'surface'])],
  ['@webspinner-foundation/pablo' as SpinnerName, new Set(['review'])],
  ['@webspinner-foundation/wizards-journal' as SpinnerName, new Set(['record', 'recall', 'bootstrap'])],
  ['@webspinner-foundation/genesis' as SpinnerName, new Set(['provisionToolchain', 'syncRepo', 'buildWorkspace', 'verifyCell', 'generateBootstrapState', 'seedVault', 'deployGrimoire', 'deployLoom'])],
]);

export async function invoke(req: InvokeRequest): Promise<InvokeResult> {
  const t0 = Date.now();

  // 1. Load Spinner manifest and integrity
  const loaded = await loadSpinner(req.slug);
  if (!loaded.ok) {
    return {
      ok: false,
      kind: 'unknown-spinner',
      message: `No Spinner registered with slug "${req.slug}".`,
    };
  }
  const { manifest, bundleDir, integrity } = loaded.value;

  // 2. Integrity gate
  if (
    integrity.kind === 'digest-mismatch' ||
    integrity.kind === 'signature-invalid' ||
    integrity.kind === 'unknown-signer'
  ) {
    return {
      ok: false,
      kind: 'integrity-gated',
      message: `Integrity check failed (${integrity.kind}). Invocation gated. See WARP-CANON.md §19.2.`,
    };
  }

  // 3. Capability validation against manifest
  const declared = manifest.capabilities.find((c) => c.name === req.capability);
  if (!declared) {
    return {
      ok: false,
      kind: 'unknown-capability',
      message: `Spinner "${manifest.name}" does not declare capability "${req.capability}".`,
    };
  }
  const dispatchSet = DISPATCH.get(manifest.name);
  if (!dispatchSet || !dispatchSet.has(req.capability)) {
    return {
      ok: false,
      kind: 'unknown-spinner',
      message: `Bootstrap Weaver has no dispatch for "${manifest.name}". Future Spinners route through dynamic-import (canon §19, open work).`,
    };
  }
  const implementedSet = IMPLEMENTED.get(manifest.name);
  if (!implementedSet || !implementedSet.has(req.capability)) {
    return {
      ok: false,
      kind: 'pending',
      message: `Capability "${req.capability}" on "${manifest.name}" is registered but not yet wired in the bootstrap Weaver. See OPEN_QUESTIONS.md — *Bootstrap Spinner runtime — when does the Weaver pipeline land?* The contract is fixed; the implementation queues here.`,
    };
  }

  // 4. Authenticate against PocketBase as superuser (bootstrap auth)
  const pbEmail = process.env['WARP_PB_EMAIL'];
  const pbPassword = process.env['WARP_PB_PASSWORD'];
  if (!pbEmail || !pbPassword) {
    return {
      ok: false,
      kind: 'config',
      message: 'WARP_PB_EMAIL / WARP_PB_PASSWORD env vars missing. Bootstrap Weaver needs PocketBase superuser auth to read the vault and write audit.',
    };
  }
  const auth = await authSuperuser(fetch, pbEmail, pbPassword);
  if (!auth.ok) {
    return { ok: false, kind: 'config', message: 'PocketBase auth failed.' };
  }
  const pbToken = auth.auth.token;

  // 5. Ensure audit + silk-pattern collections
  await ensureAuditCollection(fetch, pbToken);
  await ensureSilkPatternCollection(fetch, pbToken);

  // 6. Resolve vault references
  const masterKey = process.env['WARP_VAULT_MASTER_KEY'];
  if (!masterKey) {
    return { ok: false, kind: 'vault', message: 'WARP_VAULT_MASTER_KEY env var missing.' };
  }

  const vault: Record<string, string> = {};
  for (const ref of manifest.vault) {
    const value = await resolveVaultRef(fetch, pbToken, masterKey, ref.uri);
    if (value === undefined) {
      if (ref.required) {
        return {
          ok: false,
          kind: 'vault',
          message: `Required vault reference "${ref.name}" → "${ref.uri}" is not stored. Add it via the Loom's Vault page (Operating Principle §17.2 — never via Claude Code).`,
        };
      }
      continue;
    }
    vault[ref.name] = value;
  }

  // 7. Resolve Spools (read declared sources)
  const spoolReads: Record<string, readonly SpoolPassage[]> = {};
  for (const ref of manifest.spools) {
    if (!knownSpools().includes(ref.spool)) {
      if (ref.required) {
        return {
          ok: false,
          kind: 'config',
          message: `Required Spool "${ref.spool}" is not registered with this Cell.`,
        };
      }
      continue;
    }
    spoolReads[ref.name] = await readSpool(ref.spool);
  }

  // 8. Load mission lock
  const missionLock = (await loadSpinnerDoc(bundleDir, 'mission-lock.md')) ?? '';

  // 9. Dispatch to capability handler
  let output: unknown;
  let modelTokens = { input: 0, output: 0 };
  let result: AuditResult = 'success';
  let errorMessage: string | undefined;

  try {
    if (manifest.name === ('@webspinner-foundation/bootstrap' as SpinnerName)) {
      const handled = await dispatchBootstrap(req.capability, req.input, {
        manifest,
        vault,
        missionLock,
        spoolReads,
      });
      output = handled.output;
      modelTokens = handled.modelTokens;
    } else if (manifest.name === ('@webspinner-foundation/pablo' as SpinnerName)) {
      const handled = await dispatchPablo(req.capability, req.input, {
        manifest,
        vault,
        missionLock,
        spoolReads,
      });
      output = handled.output;
      modelTokens = handled.modelTokens;
    } else if (manifest.name === ('@webspinner-foundation/wizards-journal' as SpinnerName)) {
      const handled = await dispatchJournal(req.capability, req.input, {
        manifest,
        vault,
        missionLock,
        spoolReads,
        pbToken,
        actorEmail: req.actorEmail,
        actorId: req.actorId,
      });
      output = handled.output;
      modelTokens = handled.modelTokens;
    } else if (manifest.name === ('@webspinner-foundation/genesis' as SpinnerName)) {
      const handled = await dispatchGenesis(req.capability, req.input, {
        manifest,
        vault,
        missionLock,
        spoolReads,
        pbToken,
      });
      output = handled.output;
      modelTokens = handled.modelTokens;
    } else {
      throw new Error('unreachable: dispatch table allowed but no handler matched');
    }
  } catch (e) {
    result = 'error';
    if (e instanceof KeplerCallError) {
      errorMessage = `${e.service} unreachable: ${e.message}. Check that the Kepler ${e.service} service is running (launchctl list | grep webspinner).`;
    } else if (e instanceof AnthropicCallError) {
      errorMessage = e.message;
    } else {
      errorMessage = e instanceof Error ? e.message : String(e);
    }
    output = { error: errorMessage };
  }

  const durationMs = Date.now() - t0;

  // 10. Emit audit event
  const audit: AuditWriteRequest = {
    type: 'wp.spinner.invoke',
    source: manifest.audit.source,
    actor: { kind: 'human', id: req.actorId, displayName: req.actorEmail, authMethod: 'pb-superuser' },
    result,
    reason: `Spinner "${manifest.displayName}" capability "${req.capability}" invoked by ${req.actorEmail}.`,
    subject: `${manifest.name}#${req.capability}`,
    ocsfClass: 6003,
    data: {
      spinnerId: manifest.name,
      capability: req.capability,
      durationMs,
      modelTokens,
    },
  };
  let auditEventId: string;
  try {
    const written = await writeAuditEvent(fetch, pbToken, audit);
    auditEventId = written.id;
  } catch (e) {
    auditEventId = '';
    errorMessage = (errorMessage ?? '') + ` (audit write failed: ${e instanceof Error ? e.message : String(e)})`;
  }

  // 11. Append Silk Pattern entry
  let silkEntryId = '';
  try {
    silkEntryId = await appendSilkPattern(fetch, pbToken, {
      spinner: manifest.name,
      capability: req.capability,
      invokedAt: new Date().toISOString(),
      durationMs,
      result,
      inputSummary: summariseInput(req.capability, req.input),
      outputSummary: summariseOutput(output),
      ...(auditEventId ? { auditEventId } : {}),
      ...(errorMessage ? { errorMessage } : {}),
    });
  } catch {
    // Silk pattern write failures are non-fatal; audit captured the event.
  }

  if (result !== 'success') {
    return {
      ok: false,
      kind: 'model',
      message: errorMessage ?? 'invocation failed',
      ...(auditEventId ? { auditEventId } : {}),
      ...(silkEntryId ? { silkEntryId } : {}),
    };
  }

  return {
    ok: true,
    output,
    durationMs,
    auditEventId,
    silkEntryId,
    modelTokens,
  };
}

interface BootstrapDispatchContext {
  readonly manifest: SpinnerManifest;
  readonly vault: Readonly<Record<string, string>>;
  readonly missionLock: string;
  readonly spoolReads: Readonly<Record<string, readonly SpoolPassage[]>>;
}

interface DispatchOutput {
  readonly output: unknown;
  readonly modelTokens: { readonly input: number; readonly output: number };
}

async function dispatchBootstrap(
  capability: string,
  input: unknown,
  ctx: BootstrapDispatchContext,
): Promise<DispatchOutput> {
  switch (capability) {
    case 'consult':
      return bootstrapConsult(input, ctx);
    case 'audit':
      return bootstrapAudit(input, ctx);
    case 'record':
      return bootstrapRecord(input, ctx);
    case 'surface':
      return bootstrapSurface(input, ctx);
    default:
      throw new Error(`bootstrap dispatch: unhandled capability "${capability}"`);
  }
}

async function bootstrapConsult(
  rawInput: unknown,
  ctx: BootstrapDispatchContext,
): Promise<DispatchOutput> {
  const input = rawInput as { question?: unknown };
  if (typeof input?.question !== 'string' || input.question.trim().length === 0) {
    throw new Error('consult requires a non-empty `question` string.');
  }

  const provider = (ctx.manifest.model ?? '').split('/')[0];
  if (provider === 'anthropic') {
    throw new Error(
      'Bootstrap Spinner is configured for Anthropic, which is prohibited on the patron path per POLICY-PATRON-PATH-LLM.md R1. Switch model to "kepler/<...>".',
    );
  }
  const keplerModel = resolveKeplerModel(ctx.manifest.model);
  if (!keplerModel) {
    throw new Error(
      `Spinner declares unrecognised model "${ctx.manifest.model}". Use "kepler/qwen-2.5-14b" or similar; the Bootstrap Weaver only routes through the Quiet Loom.`,
    );
  }

  // Pablo retrieval — chunk-and-top-k from the declared Spools. This is
  // the canonical WRAG ground assembly (canon §4) replacing the prior
  // whole-file dump.
  const sourceFiles = [];
  for (const ref of ctx.manifest.spools) {
    const src = spoolToSourceFile(ref.spool);
    if (src) sourceFiles.push(src);
  }
  const retrieval = await retrieveTopK({
    question: input.question,
    sourceFiles,
    topK: 8,
  });

  let groundBlock = '';
  if (retrieval.passages.length > 0) {
    const sections = retrieval.passages.map((p: RetrievedPassage) =>
      `### Passage ${p.rank} — ${p.source}  (similarity ${p.score.toFixed(3)})\n\n${p.content}`,
    );
    groundBlock = `\n\n# Operative ground (Pablo top-${retrieval.passages.length} of ${retrieval.totalChunks} chunks)\n\n${sections.join('\n\n')}`;
  }

  const system = `${ctx.missionLock}${groundBlock}\n\n# Response format\n\nCite the source line of each passage you draw on, exactly as written above. The Loom extracts citations.`;

  const result = await quietLoomChat({
    system,
    userMessage: input.question,
    model: keplerModel,
    maxTokens: 2048,
  });

  const citations = extractCitations(result.text);
  return {
    output: {
      answer: result.text,
      citations,
      provenance: {
        provider: 'kepler.quiet-loom',
        model: result.model,
        stopReason: result.stopReason,
        retrieval: {
          via: 'kepler.embeddings',
          model: retrieval.model,
          totalChunks: retrieval.totalChunks,
          returnedPassages: retrieval.passages.length,
          elapsedMs: retrieval.elapsedMs,
          cacheHit: retrieval.cacheHit,
          sources: retrieval.passages.map((p) => p.source),
        },
      },
    },
    modelTokens: { input: result.inputTokens, output: result.outputTokens },
  };
}

const CITATION_RE = /(WARP-CANON\.md\s§[\d.]+|DECISIONS\.md\s[\d-]+|OPEN_QUESTIONS\.md\s—\s\*[^*]+\*|ch\.\s\d+)/g;

function extractCitations(text: string): readonly string[] {
  const matches = text.match(CITATION_RE) ?? [];
  return [...new Set(matches)];
}

// ── Bootstrap: audit (drift check) ────────────────────────────────────────
//
// Reads a subject (a file relative to the warp repo, or inline text),
// retrieves the most-relevant canon passages via Pablo's embedding
// pipeline, then asks the Quiet Loom to find drift — vocabulary lapses,
// brand-consistency violations, missing citations, scope creep. Returns
// structured findings with severity.

interface AuditInput {
  readonly subject?: unknown;
  readonly kind?: unknown;
}

interface DriftFinding {
  readonly severity: 'info' | 'warning' | 'error';
  readonly rule: string;
  readonly evidence: string;
  readonly suggestion: string;
}

async function bootstrapAudit(
  rawInput: unknown,
  ctx: BootstrapDispatchContext,
): Promise<DispatchOutput> {
  const input = (rawInput ?? {}) as AuditInput;
  if (typeof input.subject !== 'string' || input.subject.trim().length === 0) {
    throw new Error('audit requires a non-empty `subject` string.');
  }
  if (input.kind !== 'file' && input.kind !== 'text') {
    throw new Error('audit requires `kind` to be "file" or "text".');
  }

  let body: string;
  let displaySubject: string;
  if (input.kind === 'file') {
    const relPath = input.subject;
    // Restrict to repo-relative paths; no escaping out of the repo dir.
    if (relPath.includes('..')) {
      throw new Error('audit file path must not include "..".');
    }
    const absPath = resolvePath(WARP_REPO_DIR, relPath);
    if (!absPath.startsWith(WARP_REPO_DIR)) {
      throw new Error(`audit file path resolves outside the warp repo: ${absPath}`);
    }
    try {
      body = await readFile(absPath, 'utf8');
    } catch (e) {
      throw new Error(`Failed to read ${relPath}: ${e instanceof Error ? e.message : String(e)}`);
    }
    displaySubject = relPath;
  } else {
    body = input.subject;
    displaySubject = '(inline text)';
  }

  // Retrieve canon ground relevant to the subject.
  const sourceFiles = [];
  for (const ref of ctx.manifest.spools) {
    const src = spoolToSourceFile(ref.spool);
    if (src) sourceFiles.push(src);
  }
  // The "question" for retrieval is the first ~600 chars of the artifact
  // — that's what we want to find drift against.
  const probe = body.slice(0, 600);
  const retrieval = await retrieveTopK({
    question: probe,
    sourceFiles,
    topK: 6,
  });

  const keplerModel = resolveKeplerModel(ctx.manifest.model);
  if (!keplerModel) {
    throw new Error(
      `Bootstrap Spinner declares unrecognised model "${ctx.manifest.model}". audit needs a kepler/ model.`,
    );
  }

  const groundBlock = retrieval.passages.length
    ? retrieval.passages
        .map((p, i) => `## Canon passage ${i + 1} — ${p.source} (score ${p.score.toFixed(3)})\n\n${p.content}`)
        .join('\n\n')
    : '_(no canon passages retrieved)_';

  const driftLock = `${ctx.missionLock}

# Drift check task

You are auditing an artifact for drift from the Warp canon. The canon
passages above (retrieved by embedding similarity) are your reference.
Find lapses on these axes:

  - **Vocabulary** — Cell / Spinner / Spool / Skein / Silk Pattern /
    Warp Thread / Weaver / Loom / Grimoire / Wizard / Patron. Generic
    substitutes (tenant, agent, data source, workflow) are violations.
  - **SI vs AI** — patron-facing copy must use "Synthetic Intelligence"
    or "SI", never "AI" as a load-bearing standalone word. "AI" as a
    substring of unrelated words (e.g. "Sinai", "main", "available")
    is NOT a violation. Identifiers, class names, and file names are
    exempt from the SI/AI rule.
  - **Em-dashes** — preserve, never replace with hyphens or commas.
  - **Internal hostnames** — patron copy must not name "Kepler",
    "Spindle", "Hetzner", model identifiers, ports. Admin / developer
    surfaces are exempt.
  - **Scope creep** — proposals beyond what the canon describes for
    the current bootstrap epoch.
  - **Missing citations** — claims about the architecture that should
    cite a canon section or chapter and don't.

## Evidence discipline

The \`evidence\` field on every finding must be **quoted verbatim**
from the artifact under review — the exact line, sentence, or phrase
as it appears in the source. Do NOT paraphrase, summarise, or invent
sentences. If you cannot quote the exact passage that supports the
finding, the finding does not belong in the response.

Before returning any finding, mentally search the artifact for the
literal characters in your \`evidence\`. If you don't find them, drop
the finding.

The Foundation prefers a shorter list of grounded findings over a
longer list of plausible-sounding ones.

## Output

Return STRICT JSON only:

\`\`\`json
{
  "drift": [
    {
      "severity": "info" | "warning" | "error",
      "rule": "<short rule name>",
      "evidence": "<verbatim quote from the artifact>",
      "suggestion": "<imperative fix>"
    }
  ]
}
\`\`\`

Severity:
  - **error** — vocabulary or brand violation in load-bearing patron-facing prose.
  - **warning** — drift visible to Wizard but not to patrons.
  - **info** — opportunities for sharper alignment.

Return \`drift: []\` if the artifact is faithful. The Foundation
treats an honest empty list as a higher signal than a padded list of
INF findings.`;

  const userMessage = `# Subject — \`${displaySubject}\`\n\n${trimForAudit(body)}\n\n# Retrieved canon ground\n\n${groundBlock}\n\nAudit now. Return the JSON only.`;

  const result = await quietLoomChat({
    system: driftLock,
    userMessage,
    model: keplerModel,
    maxTokens: 1800,
  });

  const drift = parseDriftJson(result.text);

  return {
    output: {
      subject: displaySubject,
      drift,
      provenance: {
        provider: 'kepler.quiet-loom',
        model: result.model,
        retrieval: {
          via: 'kepler.embeddings',
          totalChunks: retrieval.totalChunks,
          returnedPassages: retrieval.passages.length,
          elapsedMs: retrieval.elapsedMs,
          cacheHit: retrieval.cacheHit,
        },
      },
    },
    modelTokens: { input: result.inputTokens, output: result.outputTokens },
  };
}

function trimForAudit(body: string): string {
  const max = 8000;
  if (body.length <= max) return body;
  return body.slice(0, max) + '\n\n[... truncated for audit ...]';
}

function parseDriftJson(raw: string): readonly DriftFinding[] {
  let txt = (raw ?? '').trim();
  if (txt.startsWith('```')) {
    txt = txt.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '');
  }
  const m = txt.match(/\{[\s\S]*\}/m);
  if (!m) return [];
  let obj: unknown;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    return [];
  }
  if (!obj || typeof obj !== 'object') return [];
  const raw_drift = (obj as Record<string, unknown>)['drift'];
  if (!Array.isArray(raw_drift)) return [];
  const out: DriftFinding[] = [];
  for (const f of raw_drift) {
    if (!f || typeof f !== 'object') continue;
    const fo = f as Record<string, unknown>;
    out.push({
      severity:
        (fo['severity'] as DriftFinding['severity']) === 'error' ||
        (fo['severity'] as DriftFinding['severity']) === 'warning' ||
        (fo['severity'] as DriftFinding['severity']) === 'info'
          ? (fo['severity'] as DriftFinding['severity'])
          : 'info',
      rule: typeof fo['rule'] === 'string' ? (fo['rule'] as string) : '',
      evidence: typeof fo['evidence'] === 'string' ? (fo['evidence'] as string) : '',
      suggestion: typeof fo['suggestion'] === 'string' ? (fo['suggestion'] as string) : '',
    });
  }
  return out;
}

// ── Bootstrap: record (draft a DECISIONS.md entry) ────────────────────────
//
// Pure formatting — no LLM. The Wizard supplies the title, the body, and
// optionally the entry being superseded; the handler shapes them into a
// DECISIONS.md-conforming markdown block ready to append. The Wizard
// reviews and pastes; we don't write the file from here.

interface RecordInput {
  readonly title?: unknown;
  readonly body?: unknown;
  readonly supersedes?: unknown;
}

async function bootstrapRecord(
  rawInput: unknown,
  ctx: BootstrapDispatchContext,
): Promise<DispatchOutput> {
  void ctx;
  const input = (rawInput ?? {}) as RecordInput;
  if (typeof input.title !== 'string' || input.title.trim().length === 0) {
    throw new Error('record requires a non-empty `title`.');
  }
  if (typeof input.body !== 'string' || input.body.trim().length === 0) {
    throw new Error('record requires a non-empty `body`.');
  }
  const date = new Date().toISOString().slice(0, 10);
  const title = input.title.trim();
  const body = input.body.trim();
  const supersedes =
    typeof input.supersedes === 'string' && input.supersedes.trim().length > 0
      ? input.supersedes.trim()
      : undefined;

  // If the body already starts with `**Decision:**`, leave it alone;
  // otherwise wrap the first paragraph as the decision summary.
  let entryBody = body;
  if (!/^\*\*(Decision|Why)/.test(body)) {
    const paragraphs = body.split(/\n{2,}/);
    const first = paragraphs[0]?.trim() ?? body;
    const rest = paragraphs.slice(1).join('\n\n').trim();
    entryBody = rest ? `**Decision:** ${first}\n\n${rest}` : `**Decision:** ${first}`;
  }

  // If there's no Why: line anywhere, append a placeholder; the Wizard
  // owns filling it in.
  if (!/\*\*Why:\*\*|\bWhy:/i.test(entryBody)) {
    entryBody += `\n\n**Why:** _(state the reason this decision was made — what hinges on it.)_`;
  }

  const supersedesBlock = supersedes ? `\n\n**Supersedes:** ${supersedes}` : '';

  const entry = `## ${date} — ${title}\n\n${entryBody}${supersedesBlock}\n`;

  return {
    output: { entry },
    modelTokens: { input: 0, output: 0 },
  };
}

// ── Bootstrap: surface (unfinished threads) ───────────────────────────────
//
// Reads OPEN_QUESTIONS.md, recent DECISIONS sections, and scans
// WARP-CANON.md for "spec pending" markers. Returns a flat list of
// threads sorted by recency / staleness. Counters ADD drift — what's
// still open in this Cell.

interface SurfaceThread {
  readonly kind: 'uncommitted' | 'open-question' | 'spec-pending' | 'todo';
  readonly subject: string;
  readonly ageDays: number;
}

async function bootstrapSurface(
  rawInput: unknown,
  ctx: BootstrapDispatchContext,
): Promise<DispatchOutput> {
  void rawInput;
  void ctx;

  const threads: SurfaceThread[] = [];

  // Open questions — every `## ` heading in OPEN_QUESTIONS.md.
  try {
    const oq = await readFile(join(WARP_REPO_DIR, 'OPEN_QUESTIONS.md'), 'utf8');
    const headings = oq
      .split('\n')
      .filter((line) => /^## (?!\d{4}-)/.test(line))
      .map((line) => line.replace(/^## /, '').trim());
    for (const h of headings) {
      threads.push({ kind: 'open-question', subject: h, ageDays: 0 });
    }
  } catch {
    // tolerate
  }

  // Spec-pending markers across WARP-CANON.md (case-insensitive grep).
  try {
    const canon = await readFile(join(WARP_REPO_DIR, 'WARP-CANON.md'), 'utf8');
    const lines = canon.split('\n');
    const seen = new Set<string>();
    for (const line of lines) {
      const m = line.match(/spec\s+pending/i);
      if (!m) continue;
      // De-dup by line content.
      const trimmed = line.trim();
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      const subject = trimmed.length > 120 ? trimmed.slice(0, 117) + '…' : trimmed;
      threads.push({ kind: 'spec-pending', subject, ageDays: 0 });
    }
  } catch {
    // tolerate
  }

  // Dated TODOs — look for `// TODO(YYYY-MM-DD)` style markers in source.
  try {
    const todos = await scanForDatedTodos(WARP_REPO_DIR);
    for (const t of todos) threads.push(t);
  } catch {
    // tolerate
  }

  return {
    output: { threads },
    modelTokens: { input: 0, output: 0 },
  };
}

async function scanForDatedTodos(repoDir: string): Promise<readonly SurfaceThread[]> {
  // Lightweight scan — only known top-level source directories, and
  // only files we'd expect TODOs in. The full repo grep is the Wizard's
  // tool; this is the surface counter to ADD drift, not a forensic.
  const { readdir } = await import('node:fs/promises');
  const candidates: string[] = [];
  const topDirs = ['loom/src', 'sdk/src', 'spinners', 'tools'];
  for (const d of topDirs) {
    try {
      await walk(join(repoDir, d), candidates, 0);
    } catch {
      // tolerate
    }
  }
  const out: SurfaceThread[] = [];
  const now = Date.now();
  for (const file of candidates) {
    try {
      const text = await readFile(file, 'utf8');
      const lines = text.split('\n');
      for (const line of lines) {
        const m = line.match(/\bTODO\s*\((\d{4}-\d{2}-\d{2})\)\s*:?\s*(.+)/);
        if (!m) continue;
        const date = m[1];
        const subject = m[2].trim().slice(0, 120);
        const ageDays = Math.max(0, Math.floor((now - new Date(date).getTime()) / 86_400_000));
        out.push({
          kind: 'todo',
          subject: `${file.replace(repoDir + '/', '')}: ${subject}`,
          ageDays,
        });
      }
    } catch {
      // tolerate
    }
  }

  async function walk(dir: string, acc: string[], depth: number): Promise<void> {
    if (depth > 6) return;
    let entries: { name: string; isFile: () => boolean; isDirectory: () => boolean }[] = [];
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as unknown as typeof entries;
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.name === 'node_modules') continue;
      if (e.name === 'dist' || e.name === 'build') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full, acc, depth + 1);
      } else if (e.isFile() && /\.(ts|tsx|js|jsx|svelte|py|md)$/.test(e.name)) {
        acc.push(full);
      }
    }
  }

  return out;
}

async function resolveVaultRef(
  fetchFn: typeof fetch,
  token: string,
  masterKey: string,
  uri: string,
): Promise<string | undefined> {
  // Bootstrap vault URI shape: vault://_self/<name>
  // The vault_secrets PocketBase collection stores by `name` (canonical
  // path), with ciphertext+iv. We extract <name> from the URI's tail.
  const match = uri.match(/^vault:\/\/_self\/(.+?)(?:[?#].*)?$/);
  if (!match) return undefined;
  const name = match[1];
  const url = `${PB_URL}/api/collections/vault_secrets/records?filter=${encodeURIComponent(`name = "${name}"`)}&perPage=1`;
  const res = await fetchFn(url, { headers: { Authorization: token } });
  if (!res.ok) return undefined;
  const body = (await res.json()) as { items?: readonly (EncryptedValue & { name: string })[] };
  const row = body.items?.[0];
  if (!row) return undefined;
  try {
    return await decryptValue(masterKey, { ciphertext: row.ciphertext, iv: row.iv });
  } catch {
    return undefined;
  }
}

// ── Pablo dispatch ─────────────────────────────────────────────────────────
//
// Pablo is the Foundation's design-quality reviewer. His Mission Lock
// already encodes his persona, the cited library, and the strict-JSON
// output contract — so dispatch is a thin shell: hand the rendered HTML
// to the Quiet Loom with the Mission Lock as system prompt, parse the
// JSON defensively, return the typed result.

interface PabloReviewInput {
  readonly html: unknown;
  readonly label?: unknown;
  readonly topic?: unknown;
  readonly computedStyles?: unknown;
}

interface PabloFinding {
  readonly severity: 'low' | 'medium' | 'high';
  readonly category:
    | 'contrast'
    | 'typography'
    | 'composition'
    | 'brand'
    | 'interaction'
    | 'accessibility'
    | 'other';
  readonly finding: string;
  readonly evidence: string;
  readonly fix: string;
  readonly source: string;
}

interface PabloReviewOutput {
  readonly verdict: 'passes' | 'concerns' | 'fails';
  readonly verdict_text: string;
  readonly in_pablo_voice: string;
  readonly findings: readonly PabloFinding[];
}

async function dispatchPablo(
  capability: string,
  input: unknown,
  ctx: BootstrapDispatchContext,
): Promise<DispatchOutput> {
  switch (capability) {
    case 'review':
      return pabloReview(input, ctx);
    default:
      throw new Error(`pablo dispatch: unhandled capability "${capability}"`);
  }
}

async function pabloReview(
  rawInput: unknown,
  ctx: BootstrapDispatchContext,
): Promise<DispatchOutput> {
  const input = rawInput as PabloReviewInput;
  if (typeof input?.html !== 'string' || input.html.trim().length === 0) {
    throw new Error('review requires a non-empty `html` string.');
  }

  const provider = (ctx.manifest.model ?? '').split('/')[0];
  if (provider === 'anthropic') {
    throw new Error(
      'Pablo Spinner is configured for Anthropic, which is prohibited on the patron path per POLICY-PATRON-PATH-LLM.md R1. Switch model to "kepler/<...>".',
    );
  }
  const keplerModel = resolveKeplerModel(ctx.manifest.model);
  if (!keplerModel) {
    throw new Error(
      `Pablo declares unrecognised model "${ctx.manifest.model}". Use "kepler/qwen-2.5-14b" or similar; the Bootstrap Weaver only routes through the Quiet Loom.`,
    );
  }

  // Pablo doesn't need every byte. Keep the head and a slice of body so
  // the review sees both styles and content. Mirrors the Foundation
  // reference implementation's truncation policy.
  const trimmedHtml = trimHtmlForReview(input.html);

  // Pablo's library — concatenated from the `pablo-references` Spool
  // declared in his manifest. Capped to a token budget so the prompt
  // doesn't blow past the model's prompt-processing comfort zone.
  // Files included in order; each truncated; first dropped when over
  // budget. Pablo cites by `library/<file>` path.
  const libraryPassages = ctx.spoolReads['library'] ?? [];
  const LIBRARY_BUDGET_CHARS = 12_000;
  const PER_FILE_CAP = 2_400;
  let libraryBlock = '';
  if (libraryPassages.length > 0) {
    let runningTotal = 0;
    const sections: string[] = [];
    for (const p of libraryPassages) {
      if (runningTotal >= LIBRARY_BUDGET_CHARS) break;
      const trimmed = p.content.trim();
      const headerLen = `## ${p.source}\n\n`.length;
      const allowed = Math.min(PER_FILE_CAP, LIBRARY_BUDGET_CHARS - runningTotal - headerLen);
      const slice = trimmed.length > allowed ? trimmed.slice(0, allowed) + '\n\n_[trimmed]_' : trimmed;
      sections.push(`## ${p.source}\n\n${slice}`);
      runningTotal += headerLen + slice.length + 6;
    }
    libraryBlock =
      '# Pablo library — cited references\n\n' +
      sections.join('\n\n---\n\n') +
      '\n\nWhen you cite a rule, use the path as written (e.g. `library/contrast.md`).';
  }

  const systemPrompt = libraryBlock
    ? `${libraryBlock}\n\n---\n\n${ctx.missionLock}`
    : ctx.missionLock;

  const label = typeof input.label === 'string' ? input.label : '(no label given)';
  const topic = typeof input.topic === 'string' ? input.topic : '(no topic given)';

  // Computed-styles snapshot: when the caller captured resolved CSS
  // for the surface (in-browser `getComputedStyle` walk), include it
  // so Pablo cites real values instead of guessing at CSS variables.
  // Trimmed to 40 elements + compact JSON to keep the prompt short.
  let stylesBlock = '';
  if (Array.isArray(input.computedStyles) && input.computedStyles.length > 0) {
    const trimmed = (input.computedStyles as unknown[]).slice(0, 40);
    stylesBlock =
      '\n\n# Resolved computed styles (browser snapshot)\n\n' +
      'Each entry is one rendered element. Cite values from this snapshot ' +
      'as `evidence` instead of guessing CSS variable resolutions.\n\n' +
      '```json\n' +
      JSON.stringify(trimmed).slice(0, 4000) +
      '\n```\n';
  }

  const userMessage =
    `Surface label: ${JSON.stringify(label)}\n` +
    `Wizard intent / patron task: ${JSON.stringify(topic)}\n\n` +
    `HTML artifact for review (truncated if long):\n` +
    '```html\n' +
    trimmedHtml +
    '\n```' +
    stylesBlock +
    `\n\nReview now. Return the JSON only, opening with "{".`;

  const result = await quietLoomChat({
    system: systemPrompt,
    userMessage,
    model: keplerModel,
    maxTokens: 2048,
  });

  const parsed = parsePabloJson(result.text);

  return {
    output: {
      ...parsed,
      provenance: {
        provider: 'kepler.quiet-loom',
        model: result.model,
        stopReason: result.stopReason,
        htmlLengthIn: input.html.length,
        htmlLengthSent: trimmedHtml.length,
      },
    },
    modelTokens: { input: result.inputTokens, output: result.outputTokens },
  };
}

function trimHtmlForReview(html: string): string {
  // Aggressive trim — Pablo doesn't need every byte. Total ~6KB max.
  const limit = 6_000;
  if (html.length <= limit) return html;
  const headEndIdx = html.indexOf('</head>');
  const headEnd = headEndIdx > 0 ? Math.min(headEndIdx + 7, 2_000) : 2_000;
  const head = html.slice(0, Math.max(headEnd, 1_500));
  const bodySlice =
    headEnd > 0 ? html.slice(headEnd, headEnd + 4_000) : html.slice(2_000, 6_000);
  return head + '\n<!-- … (body truncated for review) … -->\n' + bodySlice;
}

const PABLO_JSON_RE = /\{[\s\S]*\}/m;

function parsePabloJson(raw: string): PabloReviewOutput {
  let txt = (raw ?? '').trim();
  // Strip code fences if Pablo bolts them on despite the lock.
  if (txt.startsWith('```')) {
    txt = txt.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '');
  }
  const match = txt.match(PABLO_JSON_RE);
  if (!match) {
    return {
      verdict: 'concerns',
      verdict_text: 'Pablo returned no JSON envelope; the Loom could not parse a verdict.',
      in_pablo_voice: '',
      findings: [],
    };
  }
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return {
      verdict: 'concerns',
      verdict_text: 'Pablo returned malformed JSON; the Loom could not parse a verdict.',
      in_pablo_voice: '',
      findings: [],
    };
  }
  if (!obj || typeof obj !== 'object') {
    return {
      verdict: 'concerns',
      verdict_text: 'Pablo returned an empty envelope.',
      in_pablo_voice: '',
      findings: [],
    };
  }
  const o = obj as Record<string, unknown>;
  const verdict =
    o['verdict'] === 'passes' || o['verdict'] === 'concerns' || o['verdict'] === 'fails'
      ? (o['verdict'] as 'passes' | 'concerns' | 'fails')
      : 'concerns';
  const findingsRaw = Array.isArray(o['findings']) ? (o['findings'] as unknown[]) : [];
  const findings: PabloFinding[] = [];
  for (const f of findingsRaw) {
    if (!f || typeof f !== 'object') continue;
    const fo = f as Record<string, unknown>;
    findings.push({
      severity: (fo['severity'] as PabloFinding['severity']) ?? 'medium',
      category: (fo['category'] as PabloFinding['category']) ?? 'other',
      finding: typeof fo['finding'] === 'string' ? (fo['finding'] as string) : '',
      evidence: typeof fo['evidence'] === 'string' ? (fo['evidence'] as string) : '',
      fix: typeof fo['fix'] === 'string' ? (fo['fix'] as string) : '',
      source: typeof fo['source'] === 'string' ? (fo['source'] as string) : 'pablos-eye',
    });
  }
  return {
    verdict,
    verdict_text: typeof o['verdict_text'] === 'string' ? (o['verdict_text'] as string) : '',
    in_pablo_voice: typeof o['in_pablo_voice'] === 'string' ? (o['in_pablo_voice'] as string) : '',
    findings,
  };
}

// ── Wizard's Journal dispatch ──────────────────────────────────────────────

interface JournalDispatchContext extends BootstrapDispatchContext {
  readonly pbToken: string;
  readonly actorEmail: string;
  readonly actorId: string;
}

const ENTRY_KINDS: ReadonlySet<EntryKind> = new Set([
  'action',
  'decision',
  'problem',
  'learning',
  'note',
]);

const WARP_REPO_DIR = resolvePath(process.env['WARP_REPO_DIR'] ?? join(process.cwd(), '..'));

async function dispatchJournal(
  capability: string,
  input: unknown,
  ctx: JournalDispatchContext,
): Promise<DispatchOutput> {
  // Ensure the collection exists before any read/write.
  const ensured = await ensureJournalCollection(fetch, ctx.pbToken);
  if (!ensured.ok) {
    throw new Error(
      `Failed to ensure wp_journal_entries collection: ${JSON.stringify(ensured.error)}`,
    );
  }

  switch (capability) {
    case 'record':
      return journalRecord(input, ctx);
    case 'recall':
      return journalRecall(input, ctx);
    case 'bootstrap':
      return journalBootstrap(input, ctx);
    default:
      throw new Error(`wizards-journal dispatch: unhandled capability "${capability}"`);
  }
}

async function journalRecord(
  rawInput: unknown,
  ctx: JournalDispatchContext,
): Promise<DispatchOutput> {
  const input = (rawInput ?? {}) as {
    kind?: unknown;
    title?: unknown;
    body?: unknown;
    tags?: unknown;
    relatedSpinners?: unknown;
    public?: unknown;
  };
  if (typeof input.kind !== 'string' || !ENTRY_KINDS.has(input.kind as EntryKind)) {
    throw new Error(
      `record requires kind ∈ {action, decision, problem, learning, note}; got ${JSON.stringify(input.kind)}.`,
    );
  }
  if (typeof input.title !== 'string' || input.title.trim().length === 0) {
    throw new Error('record requires a non-empty title.');
  }
  if (typeof input.body !== 'string' || input.body.trim().length === 0) {
    throw new Error('record requires a non-empty body.');
  }

  const tags = Array.isArray(input.tags)
    ? input.tags.filter((t): t is string => typeof t === 'string')
    : [];
  const relatedSpinners = Array.isArray(input.relatedSpinners)
    ? input.relatedSpinners.filter((s): s is string => typeof s === 'string')
    : [];
  const publicFlag = typeof input.public === 'boolean' ? input.public : false;

  const result = await createEntry(fetch, ctx.pbToken, {
    actorEmail: ctx.actorEmail,
    actorId: ctx.actorId,
    kind: input.kind as EntryKind,
    title: input.title.trim(),
    body: input.body.trim(),
    tags,
    relatedSpinners,
    publicFlag,
  });

  if (!result.ok) {
    if (result.error.kind === 'embed-failed') {
      throw new KeplerCallError(
        'embeddings',
        `Embedding sidecar failed during record: ${result.error.message}`,
      );
    }
    throw new Error(
      `Failed to write journal entry: ${result.error.status} — ${result.error.body}`,
    );
  }

  const row = result.value;
  return {
    output: {
      id: row.id,
      timestamp: row.timestamp,
      kind: row.kind,
      title: row.title,
    },
    modelTokens: { input: 0, output: 0 },
  };
}

async function journalRecall(
  rawInput: unknown,
  ctx: JournalDispatchContext,
): Promise<DispatchOutput> {
  const input = (rawInput ?? {}) as {
    query?: unknown;
    since?: unknown;
    limit?: unknown;
    kind?: unknown;
    tag?: unknown;
  };
  if (typeof input.query !== 'string' || input.query.trim().length === 0) {
    throw new Error('recall requires a non-empty query string.');
  }
  const since = typeof input.since === 'string' ? input.since : undefined;
  const limit = typeof input.limit === 'number' ? input.limit : undefined;
  const kind =
    typeof input.kind === 'string' && ENTRY_KINDS.has(input.kind as EntryKind)
      ? (input.kind as EntryKind)
      : undefined;
  const tag = typeof input.tag === 'string' && input.tag.length > 0 ? input.tag : undefined;

  const result = await recallEntries(fetch, ctx.pbToken, {
    query: input.query,
    since,
    limit,
    kind,
    tag,
  });
  if (!result.ok) {
    if (result.error.kind === 'embed-failed') {
      throw new KeplerCallError(
        'embeddings',
        `Embedding sidecar failed during recall: ${result.error.message}`,
      );
    }
    throw new Error(`Failed to recall journal entries: ${result.error.status} — ${result.error.body}`);
  }
  return {
    output: result.value,
    modelTokens: { input: 0, output: 0 },
  };
}

async function journalBootstrap(
  rawInput: unknown,
  ctx: JournalDispatchContext,
): Promise<DispatchOutput> {
  const input = (rawInput ?? {}) as {
    scope?: unknown;
    horizonDays?: unknown;
    writeTo?: unknown;
  };
  const horizonDays =
    typeof input.horizonDays === 'number' && input.horizonDays > 0 ? Math.min(365, input.horizonDays) : 14;
  const scope = typeof input.scope === 'string' && input.scope.trim().length > 0 ? input.scope : undefined;
  // Optional repo-relative path to write the context markdown to.
  // The Wizard sets `writeTo: "BOOTSTRAP.md"` to drop the context where
  // the next Claude Code session in `~/warp/` will pick it up.
  const writeTo =
    typeof input.writeTo === 'string' && input.writeTo.trim().length > 0
      ? input.writeTo.trim()
      : undefined;

  // Recent entries within horizon.
  const recentResult = await listRecent(fetch, ctx.pbToken, { horizonDays });
  if (!recentResult.ok) {
    const detail =
      recentResult.error.kind === 'backend'
        ? `${recentResult.error.status} — ${recentResult.error.body}`
        : recentResult.error.message;
    throw new Error(`Failed to list recent journal entries: ${detail}`);
  }
  const recent = recentResult.value;
  const recentByKind = (k: EntryKind) => recent.filter((e) => e.kind === k);

  const totalResult = await countEntries(fetch, ctx.pbToken);
  const total = totalResult.ok ? totalResult.value : recent.length;

  // Tail of DECISIONS.md (last three dated entries by `## YYYY-MM-DD`).
  const decisionsTail = await tailDatedSections('DECISIONS.md', 3).catch(() => '');

  // Top of OPEN_QUESTIONS.md (first three sections after the header).
  const openTop = await topSections('OPEN_QUESTIONS.md', 3).catch(() => '');

  // Compose markdown.
  let context = `# Resume context — generated ${new Date().toISOString()}\n\n`;
  context += `Horizon: last ${horizonDays} day${horizonDays === 1 ? '' : 's'}. `;
  context += `${recent.length} of ${total} journal entries match.${scope ? ` Scope filter: \`${scope}\`.` : ''}\n\n`;

  // Current focus: most recent entry tagged "focus", or fall back to the latest entry.
  const focus = recent.find((e) => Array.isArray(e.tags) && e.tags.includes('focus')) ?? recent[0];
  if (focus) {
    context += `## Current focus\n\n**${focus.title}** — _${focus.kind}, ${focus.timestamp.slice(0, 10)}_\n\n${truncateBody(focus.body, 600)}\n\n`;
  } else {
    context += `## Current focus\n\n_Journal is empty within the horizon. Start writing._\n\n`;
  }

  // Recent actions.
  const actions = recentByKind('action').slice(0, 5);
  if (actions.length > 0) {
    context += `## Recent actions\n\n`;
    for (const a of actions) {
      context += `- _${a.timestamp.slice(0, 10)}_ — **${a.title}**\n`;
    }
    context += `\n`;
  }

  // Recent decisions (from journal + DECISIONS.md tail).
  const journalDecisions = recentByKind('decision').slice(0, 3);
  if (journalDecisions.length > 0 || decisionsTail.length > 0) {
    context += `## Last decisions\n\n`;
    for (const d of journalDecisions) {
      context += `- _${d.timestamp.slice(0, 10)}_ — **${d.title}** _(journal)_\n`;
    }
    if (decisionsTail.length > 0) {
      context += `\n_From \`DECISIONS.md\` tail:_\n\n${decisionsTail}\n`;
    }
  }

  // Open questions teaser.
  if (openTop.length > 0) {
    context += `## Open questions (top of \`OPEN_QUESTIONS.md\`)\n\n${openTop}\n`;
  }

  // Recent learnings / problems if any.
  const learnings = recentByKind('learning').slice(0, 3);
  const problems = recentByKind('problem').slice(0, 3);
  if (learnings.length > 0) {
    context += `## Recent learnings\n\n`;
    for (const l of learnings) context += `- _${l.timestamp.slice(0, 10)}_ — **${l.title}**: ${truncateBody(l.body, 240)}\n`;
    context += `\n`;
  }
  if (problems.length > 0) {
    context += `## Open problems\n\n`;
    for (const p of problems) context += `- _${p.timestamp.slice(0, 10)}_ — **${p.title}**: ${truncateBody(p.body, 240)}\n`;
    context += `\n`;
  }

  context += `\n_End of resume context — Wizard's Journal v0.1._`;

  let writtenPath: string | undefined;
  if (writeTo) {
    if (writeTo.includes('..')) {
      throw new Error('bootstrap.writeTo must be a relative path within the warp repo (no "..").');
    }
    const target = resolvePath(WARP_REPO_DIR, writeTo);
    if (!target.startsWith(WARP_REPO_DIR)) {
      throw new Error(`bootstrap.writeTo resolves outside the warp repo: ${target}`);
    }
    const { writeFile } = await import('node:fs/promises');
    await writeFile(target, context, 'utf8');
    writtenPath = target;
  }

  return {
    output: {
      context,
      stats: {
        totalEntries: total,
        recentEntries: recent.length,
        horizonDays,
      },
      ...(writtenPath ? { writtenPath } : {}),
    },
    modelTokens: { input: 0, output: 0 },
  };
}

function truncateBody(body: string, max: number): string {
  const trimmed = body.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1) + '…';
}

/** Read `DECISIONS.md`-style markdown and return the last N `## YYYY-...` sections. */
async function tailDatedSections(filename: string, n: number): Promise<string> {
  const text = await readFile(join(WARP_REPO_DIR, filename), 'utf8').catch(() => '');
  if (!text) return '';
  const sections = text.split(/\n(?=## )/g).filter((s) => /^## \d{4}-/.test(s));
  return sections.slice(-n).join('\n\n');
}

/** Read a markdown file and return the first N `## ` sections (skipping front matter). */
async function topSections(filename: string, n: number): Promise<string> {
  const text = await readFile(join(WARP_REPO_DIR, filename), 'utf8').catch(() => '');
  if (!text) return '';
  const sections = text.split(/\n(?=## )/g).filter((s) => /^## /.test(s));
  return sections.slice(0, n).join('\n\n');
}

// ── Genesis dispatch ───────────────────────────────────────────────────────
//
// Genesis is the re-runnable Cell-provisioning Spinner. v0.1 ships a
// single capability: `provisionToolchain` reports on the host's
// toolchain (Homebrew / Node / pnpm / Tailscale / git). It does NOT
// install anything yet — that's v0.2 once the audit + idempotency
// patterns are settled.
//
// Shell access is gated through the Spinner's manifest `shellAllowlist`.
// Any command outside the allowlist throws ShellPermissionError.

interface ToolReport {
  readonly present: boolean;
  readonly version?: string;
  readonly path?: string;
  readonly note?: string;
}

interface ProvisionReport {
  readonly host: {
    readonly platform: string;
    readonly uname?: string;
    readonly macosVersion?: string;
  };
  readonly tools: {
    readonly brew: ToolReport;
    readonly node: ToolReport;
    readonly pnpm: ToolReport;
    readonly tailscale: ToolReport;
    readonly git: ToolReport;
  };
  readonly missing: readonly string[];
  readonly ready: boolean;
  readonly note: string;
}

interface GenesisDispatchContext extends BootstrapDispatchContext {
  readonly pbToken: string;
}

async function dispatchGenesis(
  capability: string,
  input: unknown,
  ctx: GenesisDispatchContext,
): Promise<DispatchOutput> {
  void input;
  const shell = createShellRunner(ctx.manifest.shellAllowlist ?? []);
  if (shell.allowlist.length === 0) {
    throw new Error(
      'Genesis Spinner has no shellAllowlist declared in manifest.json. Genesis cannot probe a host without shell access.',
    );
  }
  switch (capability) {
    case 'provisionToolchain':
      return genesisProvisionToolchain(shell);
    case 'syncRepo':
      return genesisSyncRepo(input, shell);
    case 'buildWorkspace':
      return genesisBuildWorkspace(input, shell);
    case 'verifyCell':
      return genesisVerifyCell(input);
    case 'generateBootstrapState':
      return genesisGenerateBootstrapState(input);
    case 'seedVault':
      return genesisSeedVault(input, ctx);
    case 'deployGrimoire':
      return genesisDeployGrimoire(input, shell);
    case 'deployLoom':
      return genesisDeployLoom(input, shell);
    default:
      throw new Error(`genesis dispatch: unhandled capability "${capability}"`);
  }
}

async function genesisProvisionToolchain(
  shell: ReturnType<typeof createShellRunner>,
): Promise<DispatchOutput> {
  // Helper: try a `--version` probe; fall back to which-locate.
  async function probe(
    command: string,
    versionArgs: readonly string[] = ['--version'],
  ): Promise<ToolReport> {
    try {
      const res = await shell.run({ command, args: versionArgs, timeoutMs: 8_000 });
      if (res.exitCode === 0) {
        // First line of stdout (or stderr if stdout empty) is usually the version.
        const head = (res.stdout || res.stderr).split('\n')[0]?.trim() ?? '';
        const pathRes = await whichOf(shell, command).catch(() => undefined);
        return { present: true, version: head, path: pathRes };
      }
      // Non-zero exit: check whether the binary exists at all.
      const pathRes = await whichOf(shell, command).catch(() => undefined);
      if (pathRes) {
        return { present: true, path: pathRes, note: `exit ${res.exitCode}` };
      }
      return { present: false, note: `${command} not found (exit ${res.exitCode})` };
    } catch (e) {
      if (e instanceof ShellPermissionError) {
        return { present: false, note: e.message };
      }
      return { present: false, note: e instanceof Error ? e.message : String(e) };
    }
  }

  const platform = osPlatform();
  const host: ProvisionReport['host'] = { platform };

  try {
    const uname = await shell.run({ command: 'uname', args: ['-a'], timeoutMs: 3_000 });
    if (uname.exitCode === 0) {
      (host as { uname?: string }).uname = uname.stdout.trim();
    }
  } catch {
    // tolerate
  }
  if (platform === 'darwin') {
    try {
      const sw = await shell.run({ command: 'sw_vers', args: [], timeoutMs: 3_000 });
      if (sw.exitCode === 0) {
        (host as { macosVersion?: string }).macosVersion = sw.stdout.trim().replace(/\s+/g, ' ');
      }
    } catch {
      // tolerate
    }
  }

  const tools = {
    brew: await probe('brew'),
    node: await probe('node'),
    pnpm: await probe('pnpm'),
    tailscale: await probe('tailscale', ['version']),
    git: await probe('git'),
  };

  const missing = (Object.entries(tools) as [string, ToolReport][])
    .filter(([, r]) => !r.present)
    .map(([k]) => k);

  const ready = missing.length === 0;
  const note = ready
    ? 'Toolchain is ready. Genesis can proceed to deployGrimoire / deployLoom.'
    : `Missing: ${missing.join(', ')}. Install before proceeding. v0.1 of Genesis only probes; install is a future capability.`;

  const report: ProvisionReport = { host, tools, missing, ready, note };

  return {
    output: report as unknown as Record<string, unknown>,
    modelTokens: { input: 0, output: 0 },
  };
}

async function whichOf(
  shell: ReturnType<typeof createShellRunner>,
  command: string,
): Promise<string | undefined> {
  try {
    const r = await shell.run({ command: 'which', args: [command], timeoutMs: 3_000 });
    if (r.exitCode === 0) {
      return r.stdout.trim().split('\n')[0];
    }
  } catch {
    // tolerate
  }
  return undefined;
}

// ── Genesis: syncRepo, buildWorkspace, verifyCell ─────────────────────────

const HOME_DIR = process.env['HOME'] ?? '/';
const DEFAULT_TARGET_DIR = join(HOME_DIR, 'warp');

interface SyncRepoInput {
  readonly source?: unknown;
  readonly sourcePath?: unknown;
  readonly gitRemote?: unknown;
  readonly gitRef?: unknown;
  readonly targetPath?: unknown;
}

async function genesisSyncRepo(
  rawInput: unknown,
  shell: ReturnType<typeof createShellRunner>,
): Promise<DispatchOutput> {
  const input = (rawInput ?? {}) as SyncRepoInput;
  const source = typeof input.source === 'string' ? input.source : 'local-rsync';
  const targetPath = resolveTargetPath(input.targetPath, DEFAULT_TARGET_DIR);

  // Ensure the parent directory exists.
  await shell.run({ command: 'mkdir', args: ['-p', targetPath], timeoutMs: 5_000 });

  if (source === 'local-rsync') {
    const sourcePath = resolveTargetPath(input.sourcePath, WARP_REPO_DIR);
    if (!sourcePath.endsWith('/')) {
      // rsync semantics: trailing slash on source copies contents into target.
    }
    const args = [
      '-a',
      '--delete',
      '--exclude=node_modules',
      '--exclude=.svelte-kit',
      '--exclude=dist',
      '--exclude=build',
      '--exclude=playwright-report',
      '--exclude=test-results',
      '--exclude=*.tsbuildinfo',
      '--exclude=.git',
      sourcePath.endsWith('/') ? sourcePath : `${sourcePath}/`,
      targetPath.endsWith('/') ? targetPath : `${targetPath}/`,
    ];
    const r = await shell.run({ command: 'rsync', args, timeoutMs: 120_000 });
    return {
      output: {
        source: 'local-rsync',
        sourcePath,
        targetPath,
        exitCode: r.exitCode,
        durationMs: r.durationMs,
        stdoutTail: r.stdout.split('\n').slice(-12).join('\n'),
        stderrTail: r.stderr.split('\n').slice(-12).join('\n'),
        ok: r.exitCode === 0,
      },
      modelTokens: { input: 0, output: 0 },
    };
  }

  if (source === 'git-remote') {
    const remote = typeof input.gitRemote === 'string' ? input.gitRemote : '';
    if (!remote) {
      throw new Error('syncRepo with source="git-remote" requires `gitRemote` URL.');
    }
    const ref = typeof input.gitRef === 'string' ? input.gitRef : 'main';
    // We clone fresh; the Wizard handles updates of an existing checkout
    // separately (`git fetch && git checkout` is a different cap, future).
    const r = await shell.run({
      command: 'git',
      args: ['clone', '--depth', '1', '--branch', ref, remote, targetPath],
      timeoutMs: 180_000,
    });
    return {
      output: {
        source: 'git-remote',
        gitRemote: remote,
        gitRef: ref,
        targetPath,
        exitCode: r.exitCode,
        durationMs: r.durationMs,
        stdoutTail: r.stdout.split('\n').slice(-12).join('\n'),
        stderrTail: r.stderr.split('\n').slice(-12).join('\n'),
        ok: r.exitCode === 0,
      },
      modelTokens: { input: 0, output: 0 },
    };
  }

  throw new Error(
    `syncRepo: unknown source "${source}". Use "local-rsync" or "git-remote".`,
  );
}

function resolveTargetPath(rawValue: unknown, fallback: string): string {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    return fallback;
  }
  // Expand ~ at the start.
  let v = rawValue.trim();
  if (v.startsWith('~')) v = v.replace(/^~/, HOME_DIR);
  return resolvePath(v);
}

interface BuildWorkspaceInput {
  readonly targetPath?: unknown;
  readonly skipBuild?: unknown;
}

async function genesisBuildWorkspace(
  rawInput: unknown,
  shell: ReturnType<typeof createShellRunner>,
): Promise<DispatchOutput> {
  const input = (rawInput ?? {}) as BuildWorkspaceInput;
  const targetPath = resolveTargetPath(input.targetPath, DEFAULT_TARGET_DIR);
  const skipBuild = input.skipBuild === true;

  const installResult = await shell.run({
    command: 'pnpm',
    args: ['install'],
    cwd: targetPath,
    timeoutMs: 300_000,
  });

  const steps: Array<Record<string, unknown>> = [
    {
      step: 'pnpm install',
      cwd: targetPath,
      exitCode: installResult.exitCode,
      durationMs: installResult.durationMs,
      stdoutTail: installResult.stdout.split('\n').slice(-8).join('\n'),
      stderrTail: installResult.stderr.split('\n').slice(-8).join('\n'),
      ok: installResult.exitCode === 0,
    },
  ];

  let buildResult: ShellRunResult | undefined;
  if (!skipBuild && installResult.exitCode === 0) {
    buildResult = await shell.run({
      command: 'pnpm',
      args: ['-r', '--if-present', 'build'],
      cwd: targetPath,
      timeoutMs: 300_000,
    });
    steps.push({
      step: 'pnpm -r --if-present build',
      cwd: targetPath,
      exitCode: buildResult.exitCode,
      durationMs: buildResult.durationMs,
      stdoutTail: buildResult.stdout.split('\n').slice(-8).join('\n'),
      stderrTail: buildResult.stderr.split('\n').slice(-8).join('\n'),
      ok: buildResult.exitCode === 0,
    });
  }

  const ok = installResult.exitCode === 0 && (skipBuild || buildResult?.exitCode === 0);

  return {
    output: { targetPath, steps, ok },
    modelTokens: { input: 0, output: 0 },
  };
}

interface VerifyCellInput {
  readonly loomUrl?: unknown;
  readonly grimoireUrl?: unknown;
}

interface ProbeResult {
  readonly check: string;
  readonly target: string;
  readonly ok: boolean;
  readonly status?: number;
  readonly note?: string;
  readonly durationMs: number;
}

// ── Genesis: generateBootstrapState ───────────────────────────────────────
//
// Writes the four bootstrap state files under ~/.warp/bootstrap/, mode
// 0600. Files: vault-master-key (32 hex bytes), dev-bypass-token (32
// hex bytes), pb-email, pb-password (32 hex bytes). Idempotency:
// default refuses to overwrite an existing file; `force: true`
// regenerates all four. Returns per-file status, NEVER the value of
// any secret.

interface GenerateBootstrapStateInput {
  readonly force?: unknown;
  readonly emailDomain?: unknown;
}

interface BootstrapStateFile {
  readonly path: string;
  readonly state: 'existed' | 'created' | 'regenerated';
  readonly mode: string;
}

async function genesisGenerateBootstrapState(
  rawInput: unknown,
): Promise<DispatchOutput> {
  const input = (rawInput ?? {}) as GenerateBootstrapStateInput;
  const force = input.force === true;
  const emailDomain =
    typeof input.emailDomain === 'string' && input.emailDomain.length > 0
      ? input.emailDomain
      : 'cell.local';

  const dir = join(HOME_DIR, '.warp', 'bootstrap');
  await mkdir(dir, { recursive: true });

  const targets = [
    { name: 'vault-master-key', generator: () => randomBytes(32).toString('hex') },
    { name: 'dev-bypass-token', generator: () => randomBytes(32).toString('hex') },
    { name: 'pb-email', generator: () => `wizard@${emailDomain}` },
    { name: 'pb-password', generator: () => randomBytes(24).toString('hex') },
  ];

  const results: BootstrapStateFile[] = [];

  for (const t of targets) {
    const fullPath = join(dir, t.name);
    let exists = false;
    try {
      await fsStat(fullPath);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists && !force) {
      results.push({ path: fullPath, state: 'existed', mode: '0600' });
      continue;
    }
    const value = t.generator();
    await writeFile(fullPath, value, { encoding: 'utf8', mode: 0o600 });
    await chmod(fullPath, 0o600);
    results.push({
      path: fullPath,
      state: exists ? 'regenerated' : 'created',
      mode: '0600',
    });
  }

  return {
    output: {
      directory: dir,
      files: results,
      hint:
        'Values are never returned in the output. Read them via `cat ~/.warp/bootstrap/<file>` only when needed; treat the directory as the operator-trusted root of the Cell.',
    },
    modelTokens: { input: 0, output: 0 },
  };
}

// ── Genesis: seedVault ────────────────────────────────────────────────────
//
// Encrypts a batch of operator-supplied secrets with the Cell's vault
// master key and writes them to the vault_secrets collection. Idempotency:
// duplicate names are reported but not overwritten (use the Loom's
// /admin/vault Delete-then-Add to rotate). Per Operating Principle §17.2
// the values must NOT pass through Claude Code; the canonical paths for
// the Wizard are (a) /admin/vault hand-entry, (b) seedVault invoked from
// terminal with values sourced from his keychain. This handler is the
// (b) path's server side.

interface SeedVaultInput {
  readonly secrets?: unknown;
}

interface SeedSecret {
  readonly name: string;
  readonly description?: string;
  readonly value: string;
}

interface SeedResult {
  readonly name: string;
  readonly state: 'created' | 'duplicate' | 'invalid' | 'error';
  readonly note?: string;
}

async function genesisSeedVault(
  rawInput: unknown,
  ctx: GenesisDispatchContext,
): Promise<DispatchOutput> {
  const input = (rawInput ?? {}) as SeedVaultInput;
  if (!Array.isArray(input.secrets)) {
    throw new Error('seedVault requires `secrets: [{ name, value, description? }]`.');
  }
  const secrets: SeedSecret[] = [];
  for (const raw of input.secrets as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    if (typeof o['name'] !== 'string' || typeof o['value'] !== 'string') continue;
    secrets.push({
      name: o['name'] as string,
      value: o['value'] as string,
      description: typeof o['description'] === 'string' ? (o['description'] as string) : '',
    });
  }

  const masterKey = process.env['WARP_VAULT_MASTER_KEY'];
  if (!masterKey) {
    throw new Error(
      'seedVault: WARP_VAULT_MASTER_KEY is not set in the Loom\'s env. Run generateBootstrapState first and reload the Loom plist.',
    );
  }
  await ensureVaultCollection(fetch, ctx.pbToken);

  const results: SeedResult[] = [];
  for (const s of secrets) {
    try {
      const r = await addSecret(
        fetch,
        ctx.pbToken,
        masterKey,
        s.name,
        s.value,
        s.description ?? '',
      );
      if (r.ok) {
        results.push({ name: s.name, state: 'created' });
      } else if (r.error.kind === 'duplicate-name') {
        results.push({ name: s.name, state: 'duplicate', note: 'a secret with this name already exists' });
      } else if (r.error.kind === 'invalid-name') {
        results.push({ name: s.name, state: 'invalid', note: 'name must match [a-zA-Z0-9_./-]+' });
      } else {
        results.push({
          name: s.name,
          state: 'error',
          note: `backend error: ${JSON.stringify(r.error)}`,
        });
      }
    } catch (e) {
      results.push({ name: s.name, state: 'error', note: e instanceof Error ? e.message : String(e) });
    }
  }

  const created = results.filter((r) => r.state === 'created').length;
  const duplicate = results.filter((r) => r.state === 'duplicate').length;
  const errored = results.filter((r) => r.state === 'error' || r.state === 'invalid').length;

  return {
    output: {
      attempted: secrets.length,
      created,
      duplicate,
      errored,
      results,
    },
    modelTokens: { input: 0, output: 0 },
  };
}

// ── Genesis: deployGrimoire and deployLoom ────────────────────────────────
//
// Both write a launchd plist under ~/Library/LaunchAgents/ and load it
// via launchctl. Linux systemd path is a separate decision
// (OPEN_QUESTIONS.md). macOS-only for v0.2; refuses if osPlatform() !==
// 'darwin' so the linux path lands explicitly when written.

interface DeployServiceInput {
  readonly force?: unknown;
  readonly plistPath?: unknown;
}

interface DeployResult {
  readonly plistPath: string;
  readonly state: 'existed-unchanged' | 'created' | 'updated';
  readonly loaded: boolean;
  readonly note?: string;
}

async function writeAndLoadPlist(
  args: {
    readonly label: string;
    readonly plistPath: string;
    readonly content: string;
    readonly force: boolean;
  },
  shell: ReturnType<typeof createShellRunner>,
): Promise<DeployResult> {
  let prior: string | undefined;
  try {
    prior = await readFile(args.plistPath, 'utf8');
  } catch {
    prior = undefined;
  }
  const unchanged = prior !== undefined && prior === args.content;
  if (unchanged) {
    // Verify it's loaded.
    const list = await shell.run({ command: 'launchctl', args: ['list', args.label], timeoutMs: 3_000 });
    const loaded = list.exitCode === 0;
    return { plistPath: args.plistPath, state: 'existed-unchanged', loaded };
  }
  if (prior !== undefined && !args.force) {
    return {
      plistPath: args.plistPath,
      state: 'existed-unchanged',
      loaded: false,
      note: 'plist differs from the on-disk version; pass `force: true` to update.',
    };
  }

  await mkdir(resolvePath(args.plistPath, '..'), { recursive: true });
  await writeFile(args.plistPath, args.content, { encoding: 'utf8', mode: 0o600 });
  await chmod(args.plistPath, 0o600);

  // bootout (best-effort), then bootstrap.
  const uid = process.getuid?.() ?? 501;
  await shell.run({ command: 'launchctl', args: ['bootout', `gui/${uid}/${args.label}`], timeoutMs: 3_000 }).catch(() => undefined);
  const boot = await shell.run({
    command: 'launchctl',
    args: ['bootstrap', `gui/${uid}`, args.plistPath],
    timeoutMs: 5_000,
  });
  const loaded = boot.exitCode === 0;
  return {
    plistPath: args.plistPath,
    state: prior !== undefined ? 'updated' : 'created',
    loaded,
    note: loaded ? undefined : `launchctl bootstrap exited ${boot.exitCode}: ${boot.stderr.trim()}`,
  };
}

interface DeployGrimoireInput extends DeployServiceInput {
  readonly pocketbaseBin?: unknown;
  readonly dataDir?: unknown;
  readonly port?: unknown;
}

async function genesisDeployGrimoire(
  rawInput: unknown,
  shell: ReturnType<typeof createShellRunner>,
): Promise<DispatchOutput> {
  if (osPlatform() !== 'darwin') {
    throw new Error(
      'deployGrimoire v0.2 is macOS-only (launchd). Linux systemd path is open work.',
    );
  }
  const input = (rawInput ?? {}) as DeployGrimoireInput;
  const force = input.force === true;
  const label = 'foundation.webspinner.grimoire';
  const plistPath =
    typeof input.plistPath === 'string' && input.plistPath.length > 0
      ? resolveTargetPath(input.plistPath, '')
      : join(HOME_DIR, 'Library', 'LaunchAgents', `${label}.plist`);
  const pbBin =
    typeof input.pocketbaseBin === 'string' && input.pocketbaseBin.length > 0
      ? input.pocketbaseBin
      : '/opt/homebrew/bin/pocketbase';
  const dataDir =
    typeof input.dataDir === 'string' && input.dataDir.length > 0
      ? input.dataDir
      : join(HOME_DIR, 'Library', 'Application Support', 'Webspinner Foundation', 'Grimoire', 'pb_data');
  const port = typeof input.port === 'number' && input.port > 0 ? input.port : 8090;

  await mkdir(dataDir, { recursive: true });
  const logDir = join(HOME_DIR, 'Library', 'Application Support', 'Webspinner Foundation', 'Grimoire', 'logs');
  await mkdir(logDir, { recursive: true });

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${pbBin}</string>
    <string>serve</string>
    <string>--http</string>
    <string>127.0.0.1:${port}</string>
    <string>--dir</string>
    <string>${dataDir}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
    <key>Crashed</key>
    <true/>
  </dict>
  <key>StandardOutPath</key>
  <string>${join(logDir, 'grimoire.out.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(logDir, 'grimoire.err.log')}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>${HOME_DIR}</string>
  </dict>
</dict>
</plist>
`;

  const result = await writeAndLoadPlist({ label, plistPath, content, force }, shell);
  return {
    output: { service: 'grimoire', label, port, dataDir, ...result },
    modelTokens: { input: 0, output: 0 },
  };
}

interface DeployLoomInput extends DeployServiceInput {
  readonly nodeBin?: unknown;
  readonly loomEntry?: unknown;
  readonly port?: unknown;
  readonly origin?: unknown;
}

async function genesisDeployLoom(
  rawInput: unknown,
  shell: ReturnType<typeof createShellRunner>,
): Promise<DispatchOutput> {
  if (osPlatform() !== 'darwin') {
    throw new Error(
      'deployLoom v0.2 is macOS-only (launchd). Linux systemd path is open work.',
    );
  }
  const input = (rawInput ?? {}) as DeployLoomInput;
  const force = input.force === true;
  const label = 'foundation.webspinner.loom';
  const plistPath =
    typeof input.plistPath === 'string' && input.plistPath.length > 0
      ? resolveTargetPath(input.plistPath, '')
      : join(HOME_DIR, 'Library', 'LaunchAgents', `${label}.plist`);
  const nodeBin =
    typeof input.nodeBin === 'string' && input.nodeBin.length > 0
      ? input.nodeBin
      : '/opt/homebrew/bin/node';
  const loomEntry =
    typeof input.loomEntry === 'string' && input.loomEntry.length > 0
      ? input.loomEntry
      : join(HOME_DIR, 'warp', 'loom', 'build', 'index.js');
  const port = typeof input.port === 'number' && input.port > 0 ? input.port : 3000;
  const origin =
    typeof input.origin === 'string' && input.origin.length > 0
      ? input.origin
      : `http://${osHostname()}:${port}`;
  const logDir = join(HOME_DIR, 'Library', 'Application Support', 'Webspinner Foundation', 'Loom', 'logs');
  await mkdir(logDir, { recursive: true });

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${loomEntry}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
    <key>Crashed</key>
    <true/>
  </dict>
  <key>StandardOutPath</key>
  <string>${join(logDir, 'loom.out.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(logDir, 'loom.err.log')}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>${HOME_DIR}</string>
    <key>HOST</key>
    <string>0.0.0.0</string>
    <key>PORT</key>
    <string>${port}</string>
    <key>ORIGIN</key>
    <string>${origin}</string>
    <key>PROTOCOL_HEADER</key>
    <string>x-forwarded-proto</string>
    <key>HOST_HEADER</key>
    <string>x-forwarded-host</string>
    <key>WARP_REPO_DIR</key>
    <string>${join(HOME_DIR, 'warp')}</string>
  </dict>
</dict>
</plist>
`;

  const result = await writeAndLoadPlist({ label, plistPath, content, force }, shell);
  return {
    output: {
      service: 'loom',
      label,
      port,
      origin,
      loomEntry,
      ...result,
      note:
        result.note ||
        'Loom plist written. Note: this v0.2 deployLoom does not set vault master key, PB superuser creds, or Resend keys — those env vars come from generateBootstrapState + manual plist enrichment for now.',
    },
    modelTokens: { input: 0, output: 0 },
  };
}

async function genesisVerifyCell(rawInput: unknown): Promise<DispatchOutput> {
  const input = (rawInput ?? {}) as VerifyCellInput;
  const loomUrl =
    typeof input.loomUrl === 'string' && input.loomUrl.length > 0
      ? input.loomUrl
      : 'http://127.0.0.1:3000';
  const grimoireUrl =
    typeof input.grimoireUrl === 'string' && input.grimoireUrl.length > 0
      ? input.grimoireUrl
      : process.env['WARP_PB_URL'] ?? 'http://127.0.0.1:8090';

  async function probe(check: string, target: string, expectStatus?: number): Promise<ProbeResult> {
    const t0 = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      const r = await fetch(target, { signal: controller.signal });
      clearTimeout(timer);
      const ok = expectStatus ? r.status === expectStatus : r.status >= 200 && r.status < 500;
      return {
        check,
        target,
        ok,
        status: r.status,
        durationMs: Date.now() - t0,
      };
    } catch (e) {
      return {
        check,
        target,
        ok: false,
        note: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - t0,
      };
    }
  }

  const checks: ProbeResult[] = [];

  // Loom answers — / should return 200 with HTML.
  checks.push(await probe('loom-root', `${loomUrl}/`));
  // Loom /admin should 303 to /login (unauthenticated).
  const adminProbe = await probe('loom-admin-gate', `${loomUrl}/admin`);
  checks.push({
    ...adminProbe,
    ok: adminProbe.status === 303 || adminProbe.status === 302 || adminProbe.status === 200,
    note: adminProbe.status === 303 ? 'redirects to /login as expected' : adminProbe.note,
  });

  // Grimoire (PocketBase) answers — /api/health returns 200 with a healthy payload.
  checks.push(await probe('grimoire-health', `${grimoireUrl}/api/health`, 200));

  // Vault collection exists.
  try {
    const t0 = Date.now();
    const r = await fetch(`${grimoireUrl}/api/collections/vault_secrets`);
    checks.push({
      check: 'vault-collection',
      target: `${grimoireUrl}/api/collections/vault_secrets`,
      ok: r.status === 401 || r.status === 200, // 401 means it exists but we're not authed
      status: r.status,
      note:
        r.status === 401
          ? 'collection exists (returns 401 without auth)'
          : r.status === 200
            ? 'collection visible'
            : `unexpected status ${r.status}`,
      durationMs: Date.now() - t0,
    });
  } catch (e) {
    checks.push({
      check: 'vault-collection',
      target: `${grimoireUrl}/api/collections/vault_secrets`,
      ok: false,
      note: e instanceof Error ? e.message : String(e),
      durationMs: 0,
    });
  }

  const ready = checks.every((c) => c.ok);
  const summary = ready
    ? 'Cell is reachable. Loom, Grimoire, and the vault collection respond.'
    : `Cell is partially reachable. Failing checks: ${checks.filter((c) => !c.ok).map((c) => c.check).join(', ')}.`;

  return {
    output: { loomUrl, grimoireUrl, ready, summary, checks },
    modelTokens: { input: 0, output: 0 },
  };
}
