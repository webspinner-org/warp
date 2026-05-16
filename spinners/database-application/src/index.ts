// Database Application Spinner — entrypoint loaded by the Weaver.
//
// The Spinner exports its type contract from this module; the actual
// runtime work (research via `context.fetch`, schema drafting via
// `context.quietLoom`, session persistence via `context.session`)
// lives in the Loom's `weaver.ts` bootstrap dispatcher (`dispatchDatabaseApplication`)
// for the bootstrap epoch. When the canonical Python+FastAPI Weaver
// lands, the contract here does not change; only the dispatcher does.
//
// Mirror of Pablo's pattern: the SDK's canonical `SpinnerContext` is
// the runtime surface (fetch + quietLoom + embed + session + the
// bootstrap primitives). This module declares the input/output types
// per capability; the bootstrap dispatcher constructs the context
// and consumes / produces those shapes.

import type { SpinnerName, SpinnerContext } from '@webspinner-foundation/sdk';

export type Capability = 'propose' | 'refine' | 'build';

// ── propose ────────────────────────────────────────────────────────

export interface ProposeInput {
  /** The Webspinner's plain-English description of what they want to keep track of. */
  readonly patronSentence: string;
}

export type ClarificationKind = 'single-choice' | 'multi-choice' | 'free-text' | 'yes-no';

export interface Clarification {
  readonly id: string;
  readonly question: string;
  readonly kind: ClarificationKind;
  readonly options?: readonly string[];
}

/**
 * The draft schema is intentionally typed as an opaque object in the
 * SDK contract — the Spinner-internal shape evolves as we learn what
 * the Quiet Loom produces. Future tightening lives in a versioned
 * sub-schema once we have empirical learning from the propose runtime.
 */
export type SchemaDraft = Readonly<Record<string, unknown>>;

export interface ProposeOutput {
  readonly narration: string;
  readonly domain?: string;
  readonly schemaDraft?: SchemaDraft;
  readonly clarifications: readonly Clarification[];
  readonly phase: 'proposed';
}

// ── refine ─────────────────────────────────────────────────────────

export type ClarificationAnswer = string | readonly string[] | boolean;

export interface RefineAnswer {
  readonly id: string;
  readonly answer: ClarificationAnswer;
}

export interface RefineInput {
  readonly answers: readonly RefineAnswer[];
}

export interface RefineOutput {
  readonly narration: string;
  readonly schemaDraft?: SchemaDraft;
  readonly clarifications: readonly Clarification[];
  readonly readyToBuild: boolean;
  readonly phase: 'refining' | 'ready';
}

// ── build ──────────────────────────────────────────────────────────

export type BuildInput = Readonly<Record<string, never>>;

export type ArtifactKind = 'collection' | 'view' | 'report' | 'binding';

export interface BuildArtifact {
  readonly kind: ArtifactKind;
  readonly name: string;
  readonly location: string;
}

export interface BuildOutput {
  readonly narration: string;
  readonly deployedSurfaceUrl: string;
  readonly artifacts: readonly BuildArtifact[];
  readonly phase: 'built';
}

// ── session state shape (Spinner-internal) ─────────────────────────

/**
 * The Spinner's working state in `context.session.state`. Opaque to the
 * platform; this module is the source of truth for its shape. Evolves
 * as the runtime learns. Versioned via the `version` field; older
 * sessions are migrated forward on read.
 */
export interface DatabaseApplicationSession {
  readonly version: 1;
  readonly patronSentence: string;
  readonly domain?: string;
  readonly schemaDraft?: SchemaDraft;
  /** Research sources the Spinner has consulted (URLs). */
  readonly sources: readonly string[];
  /** Clarifications asked, in order, with answers when given. */
  readonly turns: readonly {
    readonly capability: Capability;
    readonly clarifications: readonly Clarification[];
    readonly answers?: readonly RefineAnswer[];
    readonly timestamp: string;
  }[];
  /** Set when `build` completes. */
  readonly built?: {
    readonly deployedSurfaceUrl: string;
    readonly artifacts: readonly BuildArtifact[];
    readonly timestamp: string;
  };
}

export const SPINNER_ID = '@webspinner-foundation/database-application' as SpinnerName;

/**
 * The Weaver calls this. The bootstrap dispatcher in
 * `loom/src/lib/server/weaver.ts` (`dispatchDatabaseApplication`)
 * supersedes this throw — it constructs the `SpinnerContext` and runs
 * the actual research / schema / build work. When the canonical
 * Python Weaver lands, this module's contract remains the truth.
 */
export async function invoke(
  capability: Capability,
  input: unknown,
  context: SpinnerContext,
): Promise<unknown> {
  void input;
  void context;
  throw new Error(
    `Database Application invocation pending Weaver runtime. Capability="${capability}". ` +
      `Bootstrap dispatch lives in the Loom's weaver.ts; this module's contract does ` +
      `not change when the Python Weaver lands.`,
  );
}
