import type { Brand, JSONSchema } from './types.js';
import type { SpinnerName, SpinnerDocumentation, EnvVarSpec } from './manifest.js';

/**
 * WarpThreadName — `@<scope>/<kebab-case>` identifier for a thread.
 *
 * Validation pattern: /^@[a-z0-9-]+\/[a-z0-9-]+$/
 */
export type WarpThreadName = Brand<string, 'WarpThreadName'>;

/**
 * A value referenced inside a WarpThread step's input bindings or in the
 * thread's outputs. Three kinds:
 *
 *  - `literal` — a constant value the thread author baked in.
 *  - `thread-input` — bound to one of the thread's declared inputs at
 *    invocation time.
 *  - `step-output` — bound to a path within an earlier step's output
 *    (dot-path; e.g. `answer.text` selects `output.answer.text`).
 *
 * Bindings are resolved lazily by the Weaver as it executes each step;
 * a binding that references a step that has not yet executed is a thread
 * authoring error, surfaced at compose time, not at runtime.
 */
export type WarpThreadValue =
  | { readonly kind: 'literal'; readonly value: unknown }
  | { readonly kind: 'thread-input'; readonly inputName: string }
  | { readonly kind: 'step-output'; readonly stepId: string; readonly path: string };

/** A single step in a WarpThread — invoke a Spinner's capability. */
export interface WarpThreadStep {
  /** Unique within the thread. Referenced by later steps' bindings. */
  readonly id: string;
  /** Human label shown in the Loom's thread view. */
  readonly displayName: string;
  /** Spinner whose capability is invoked. Must declare `threadable: true`. */
  readonly spinner: SpinnerName;
  /** Capability name on the named Spinner. */
  readonly capability: string;
  /** Bindings for the capability's input properties. */
  readonly inputs: Readonly<Record<string, WarpThreadValue>>;
  /** Optional human note explaining why this step is here. */
  readonly note?: string;
}

/** Schema-typed declaration of a thread input parameter. */
export interface WarpThreadInputSpec extends EnvVarSpec {
  readonly schema?: JSONSchema;
}

/**
 * WarpThreadManifest — declarative composition of Spinner capabilities.
 *
 * A thread is itself an artifact like a Spinner: it has a name, a
 * display name, documentation viewable in the Loom, and an audit source.
 * Threads are signed and digested the same way Spinners are
 * (see `./integrity.ts`).
 *
 * Spinner Weaving is the act of authoring a WarpThread: composing the
 * capabilities of Spinners into a workflow with declared inputs and
 * outputs. Webspinner is modular by design.
 *
 * Runtime is open work — see `OPEN_QUESTIONS.md` *Warp Thread runtime*.
 */
export interface WarpThreadManifest {
  readonly manifestVersion: '1.0';
  readonly name: WarpThreadName;
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  readonly homepage?: string;
  readonly license: string;
  /** Inputs the thread takes at invocation. */
  readonly inputs: readonly WarpThreadInputSpec[];
  readonly steps: readonly WarpThreadStep[];
  /** Output bindings — what the thread returns when complete. */
  readonly outputs: Readonly<Record<string, WarpThreadValue>>;
  readonly documentation: SpinnerDocumentation;
  /** CloudEvents `source` for events this thread emits. */
  readonly audit: { readonly source: string };
}
