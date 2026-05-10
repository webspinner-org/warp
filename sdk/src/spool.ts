import type { Brand, JSONSchema } from './types.js';

/**
 * SpoolName — `@<scope>/<kebab-case>` identifier for a registered Spool.
 *
 * Validation pattern: /^@[a-z0-9-]+\/[a-z0-9-]+$/
 *
 * Reserved prefix `_self/<name>` denotes a Cell-local Spool (canon, audit
 * log, vault index). Foundation-published Spools use the
 * `@webspinner-foundation/...` scope.
 */
export type SpoolName = Brand<string, 'SpoolName'>;

/**
 * A Spool is a registered data source that Spinners draw from at
 * invocation time. The canon is a Spool. The manuscript is a Spool. The
 * audit log is a Spool. A Cell's own document collection is a Spool. The
 * vault is *not* a Spool — secrets are referenced by `vault://` URI, with
 * a different lifecycle and a different threat model.
 *
 * A Spool's source is opaque to the Spinner: the Weaver gives a Spinner
 * `context.read(spoolName, query)` and returns passages. The Spinner does
 * not know whether the Spool is a flat file, a vector index, a federated
 * peer's retrieval capability, or a live API. This is canon §4 (WRAG)
 * applied uniformly: *we do not ask the model to know the source. We ask
 * the model to reason about what the Spool returned.*
 */
export interface SpoolManifest {
  readonly manifestVersion: '1.0';
  readonly name: SpoolName;
  readonly displayName: string;
  readonly description: string;
  /**
   * Sensitivity classification per `WARP-CANON.md` §7. The Weaver uses
   * this when routing Spinner invocations: a Spool classified Privileged
   * never feeds a BYOK call routed off-Cell.
   */
  readonly sensitivity: 'public' | 'personal' | 'confidential' | 'privileged';
  /**
   * Source-specific configuration. Opaque to consumers; interpreted by
   * the Spool implementation registered with the Weaver.
   */
  readonly source: Readonly<Record<string, unknown>>;
  /**
   * Optional input schema for read queries. When present, the Weaver
   * validates queries against it before invoking the Spool.
   */
  readonly querySchema?: JSONSchema;
}

/**
 * SpoolRef — a Spinner's manifest reference to a Spool it reads from.
 * The Weaver enforces the reference: a Spinner cannot read from a Spool
 * it has not declared, even if the Spool is registered with the Cell.
 */
export interface SpoolRef {
  /** Logical name the Spinner code refers to (e.g. `canon`, `manuscript`). */
  readonly name: string;
  /** The Spool to draw from. */
  readonly spool: SpoolName;
  readonly required: boolean;
}

/**
 * A passage returned by a Spool read. The Spinner reasons over passages
 * and cites them by `source` in its output.
 */
export interface SpoolPassage {
  /** Stable identifier — file path + section anchor, manuscript chapter + paragraph, etc. */
  readonly source: string;
  /** Verbatim retrieved text. */
  readonly content: string;
  /** Re-ranker score in [0, 1]. Defaults to 1 for whole-source reads. */
  readonly score: number;
}
