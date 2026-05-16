// SpinnerContext — the canonical runtime context the Weaver passes to a
// Spinner's capability handler. The shape is fixed in the SDK so every
// Spinner inherits the same primitives regardless of which Weaver
// implementation hosts them (bootstrap-shim-in-Loom today, Python+FastAPI
// canonical Weaver later). The Bootstrap exception applies until the
// Python Weaver lands: the Loom constructs this context inline during
// dispatch; the contract here does not change.
//
// What's in here, and why:
//
//   - `spinnerId`, `vault`, `missionLock`, `resolveVault`, `emitAudit`
//     are the bootstrap primitives every Spinner already needs. They
//     existed as ad-hoc `InvokeContext` shapes in `spinners/*/src/index.ts`;
//     this file is the SDK canonicalisation.
//   - `fetch` is the gated outbound HTTP primitive. The Spinner declares
//     the hosts it may reach in `manifest.outboundAllowlist`; the
//     Weaver's gated implementation refuses everything else and emits
//     `wp.spinner.outbound.fetch` per call (success | denied | error).
//   - `quietLoom` and `embed` are the sovereign-runtime LLM + embeddings
//     primitives. Per `POLICY-PATRON-PATH-LLM.md` R1 + the Weaver's
//     existing model gate (`loom/src/lib/server/weaver.ts:454,1031`),
//     Spinners route generation + embeddings through the Kepler-resident
//     services — never through Anthropic/OpenAI. The types here mirror
//     what `loom/src/lib/server/kepler.ts` already serves; they live
//     here so Spinners depend on the SDK, not on the Loom's bootstrap
//     shim.

import type { AuditEvent, AuditEventType } from './audit-event.js';
import type { SpinnerName } from './manifest.js';
import type { VaultURI } from './vault-uri.js';

export interface SpinnerAuditDraft {
  readonly type: AuditEventType;
  readonly subject?: string;
  readonly reason: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * Outbound HTTP request a Spinner makes through `context.fetch`. The
 * URL's host must be in the manifest's `outboundAllowlist`. Body is a
 * string (the Weaver does not interpret JSON / form encodings — the
 * Spinner constructs the request). Method is constrained to safe verbs
 * for research-class work; future revisions may broaden it when a
 * Spinner empirically needs PUT/DELETE/PATCH.
 */
export interface SpinnerFetchRequest {
  readonly url: string;
  readonly method?: 'GET' | 'HEAD' | 'POST';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** Per-call timeout. Defaults to 15 s; hard cap 60 s. */
  readonly timeoutMs?: number;
}

/**
 * Outbound HTTP response. `text` is the response body, truncated at the
 * Weaver's `MAX_RESPONSE_BYTES` cap (the cap is implementation-defined
 * but documented in the dispatcher). Headers are a plain object — single
 * value per name; multi-value headers are joined with `", "`.
 */
export interface SpinnerFetchResponse {
  readonly url: string;
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Readonly<Record<string, string>>;
  readonly text: string;
  readonly durationMs: number;
  readonly bytesRead: number;
  readonly truncated: boolean;
}

/**
 * Sovereign-runtime Quiet Loom call. The Spinner's manifest `model`
 * field is the contract — the Weaver routes by that and refuses any
 * non-`kepler/*` model on the patron path. The Spinner does not pass
 * a model identifier here; the Weaver injects it.
 */
export interface SpinnerQuietLoomRequest {
  readonly system: string;
  readonly userMessage: string;
  readonly maxTokens?: number;
}

export interface SpinnerQuietLoomResponse {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly stopReason: string;
}

/**
 * Sovereign-runtime embeddings call. Returns one vector per input text,
 * dimensions and model identifier of the embeddings sidecar
 * (MiniLM-L6-v2 today, 384-dim normalised; BGE-M3 at scale per the
 * canon's default stack).
 */
export interface SpinnerEmbedRequest {
  readonly texts: readonly string[];
}

export interface SpinnerEmbedResponse {
  readonly vectors: readonly (readonly number[])[];
  readonly dim: number;
  readonly model: string;
}

/**
 * Re-entrant session — the Spinner's persistent working state across
 * capability invocations on the same session. Loaded by the dispatcher
 * before the handler runs; modified through `save()`. The Spinner does
 * not see the storage layer; the Loom (today) and the canonical Weaver
 * (later) provide identical semantics.
 *
 * Re-entrancy semantics:
 *
 *   - **Coarse-grained.** Between capability calls, the patron can
 *     leave at any safe point and come back later. The next call's
 *     `state` / `phase` reflect the last `save()`.
 *   - **Fine-grained (cooperative).** Within a single capability call,
 *     a Spinner doing multi-step work (research → schema → questions)
 *     can `save()` between steps. If the Loom restarts mid-call, the
 *     next invocation sees the most recent checkpoint.
 *   - **No atomic / optimistic concurrency in v0.** Concurrent writes
 *     on the same session are last-writer-wins; the Loom serialises
 *     patron turns above this layer.
 *
 * State shape is Spinner-defined: the platform persists it as JSON and
 * hands it back untouched. `phase` is a Spinner-defined string the
 * Loom uses to render "where are we" in patron-facing surfaces.
 */
export interface SpinnerSession {
  /** UUID minted by the Loom on the first invocation in this session. */
  readonly id: string;
  /** True iff there is no persisted row yet — the Spinner is starting fresh. */
  readonly isFirstTurn: boolean;
  /** Last-persisted state. Empty object on first turn. */
  readonly state: Readonly<Record<string, unknown>>;
  /** Last-persisted phase string. Empty string on first turn. */
  readonly phase: string;
  /**
   * Persist a new state + phase atomically. Upsert semantics: the row
   * is created on first save, updated thereafter. Emits
   * `wp.spinner.session.save` to the audit chain.
   */
  save(next: {
    readonly state: Record<string, unknown>;
    readonly phase: string;
    readonly status?: 'active' | 'completed' | 'aborted';
  }): Promise<void>;
}

/**
 * The canonical SpinnerContext the Weaver constructs and passes to a
 * capability handler. All primitives are async and return typed shapes;
 * the Spinner never reaches host APIs directly.
 */
export interface SpinnerContext {
  readonly spinnerId: SpinnerName;
  /** Vault values pre-resolved at invocation start, keyed by manifest `name`. */
  readonly vault: Readonly<Record<string, string>>;
  /** The Spinner's mission-lock text, injected as system prompt for model calls. */
  readonly missionLock: string;
  /** Re-resolve a vault URI on demand (when a value rotates mid-invocation). */
  resolveVault(uri: VaultURI): Promise<string>;
  /** Emit a typed audit event into the Cell's audit chain. */
  emitAudit(event: SpinnerAuditDraft): Promise<AuditEvent>;
  /**
   * Gated outbound HTTP. The URL's host must be in the manifest's
   * `outboundAllowlist`. Throws on permission denial; returns a typed
   * response on network completion (including non-2xx status). Every
   * call emits `wp.spinner.outbound.fetch` regardless of outcome.
   */
  fetch(req: SpinnerFetchRequest): Promise<SpinnerFetchResponse>;
  /**
   * Sovereign generation through the Cell's Quiet Loom. The Spinner's
   * mission-lock is the system prompt unless overridden in the request.
   */
  quietLoom(req: SpinnerQuietLoomRequest): Promise<SpinnerQuietLoomResponse>;
  /** Sovereign embeddings through the Cell's embeddings sidecar. */
  embed(req: SpinnerEmbedRequest): Promise<SpinnerEmbedResponse>;
  /**
   * Re-entrant session state — survives Spinner death, Loom restart,
   * and patron-departure-and-return. Every Spinner gets one; the
   * Spinner author decides how to use it.
   */
  readonly session: SpinnerSession;
}
