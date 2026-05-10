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
import { readFile } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import { platform as osPlatform } from 'node:os';
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
  ['@webspinner-foundation/bootstrap' as SpinnerName, new Set(['consult'])],
  ['@webspinner-foundation/pablo' as SpinnerName, new Set(['review'])],
  ['@webspinner-foundation/wizards-journal' as SpinnerName, new Set(['record', 'recall', 'bootstrap'])],
  ['@webspinner-foundation/genesis' as SpinnerName, new Set(['provisionToolchain'])],
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
  // declared in his manifest. Each library file shows up as a passage
  // tagged "library/<filename>"; Pablo cites them by that path in his
  // findings. Falls back gracefully when the spool is empty (e.g.
  // before the library files are committed).
  const libraryPassages = ctx.spoolReads['library'] ?? [];
  const libraryBlock =
    libraryPassages.length > 0
      ? '# Pablo library — cited references\n\n' +
        libraryPassages
          .map((p) => `## ${p.source}\n\n${p.content.trim()}`)
          .join('\n\n---\n\n') +
        '\n\nWhen you cite a rule, use the path as written (e.g. `library/contrast.md`).'
      : '';

  const systemPrompt = libraryBlock
    ? `${libraryBlock}\n\n---\n\n${ctx.missionLock}`
    : ctx.missionLock;

  const label = typeof input.label === 'string' ? input.label : '(no label given)';
  const topic = typeof input.topic === 'string' ? input.topic : '(no topic given)';
  const userMessage =
    `Surface label: ${JSON.stringify(label)}\n` +
    `Wizard intent / patron task: ${JSON.stringify(topic)}\n\n` +
    `HTML artifact for review (truncated if long):\n` +
    '```html\n' +
    trimmedHtml +
    '\n```\n\n' +
    `Review now. Return the JSON only, opening with "{".`;

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
  const limit = 12_000;
  if (html.length <= limit) return html;
  const headEndIdx = html.indexOf('</head>');
  const headEnd = headEndIdx > 0 ? headEndIdx + 7 : 4_000;
  const head = html.slice(0, Math.max(headEnd, 4_000));
  const bodySlice = headEnd > 0 ? html.slice(headEnd, headEnd + 8_000) : html.slice(4_000, 12_000);
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
  const input = (rawInput ?? {}) as { scope?: unknown; horizonDays?: unknown };
  const horizonDays =
    typeof input.horizonDays === 'number' && input.horizonDays > 0 ? Math.min(365, input.horizonDays) : 14;
  const scope = typeof input.scope === 'string' && input.scope.trim().length > 0 ? input.scope : undefined;

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

  return {
    output: {
      context,
      stats: {
        totalEntries: total,
        recentEntries: recent.length,
        horizonDays,
      },
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

async function dispatchGenesis(
  capability: string,
  input: unknown,
  ctx: BootstrapDispatchContext,
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
