import type { Brand, JSONSchema } from './types.js';
import type { VaultURI } from './vault-uri.js';
import type { AuditEventType } from './audit-event.js';
import type { SpoolRef } from './spool.js';

/**
 * SpinnerName — `@<scope>/<kebab-case>` identifier
 * (e.g. `@webspinner-foundation/bootstrap`, or `@<cell>/<name>` for
 * Cell-published Spinners).
 *
 * Validation pattern: /^@[a-z0-9-]+\/[a-z0-9-]+$/
 */
export type SpinnerName = Brand<string, 'SpinnerName'>;

export interface VaultRef {
  /** Logical name the Spinner code refers to (e.g. `ANTHROPIC_API_KEY`). */
  readonly name: string;
  /** Where the secret resolves from at runtime. */
  readonly uri: VaultURI;
  readonly required: boolean;
}

export interface EnvVarSpec {
  readonly name: string;
  readonly required: boolean;
  /** Default applied when not set. NEVER put secrets here — use VaultRef. */
  readonly default?: string;
  readonly description: string;
}

export interface SpinnerDependency {
  readonly name: SpinnerName;
  /** SemVer range, e.g. "^1.2.0", ">=2.0.0 <3.0.0". */
  readonly versionRange: string;
}

export interface SpinnerCapability {
  /** camelCase, e.g. "consult". */
  readonly name: string;
  /** Human-readable label shown in the Loom. */
  readonly displayName: string;
  /** Plain-language description rendered to the Wizard. */
  readonly description: string;
  /** JSON Schema (Draft 2020-12) describing the capability's input. */
  readonly inputSchema?: JSONSchema;
  /** JSON Schema (Draft 2020-12) describing the capability's output. */
  readonly outputSchema?: JSONSchema;
  /** AuditEvent types this capability emits when invoked. */
  readonly emitsAudit?: readonly AuditEventType[];
}

/**
 * Documentation paths the Loom renders. All paths are relative to the
 * Spinner's bundle directory. Markdown only. The Wizard reads these.
 *
 * `howItWorks` is required: every Spinner explains itself in plain
 * language, transparently and verbosely. The Webspinner UX is everything;
 * a Spinner that does not explain itself is not production-candidate.
 */
export interface SpinnerDocumentation {
  /** "How It Works" — the operative explanation. Required. */
  readonly howItWorks: string;
  /** Short README. Optional but conventional. */
  readonly readme?: string;
  /** Optional examples document. */
  readonly examples?: string;
  /** Additional documentation files surfaced in the Loom. */
  readonly additional?: readonly { readonly title: string; readonly path: string }[];
}

/**
 * SpinnerManifest — declarative metadata the Weaver uses to install,
 * verify, configure, and invoke a Spinner.
 *
 * Two version fields:
 *   - manifestVersion: schema version of THIS shape ('1.0' today; bump major
 *     on breaking changes, minor on additive-only). Mirrors CloudEvents'
 *     specversion convention.
 *   - version: SemVer of the Spinner itself.
 *
 * Integrity fields (digest, signatures) are NOT in the manifest — they are
 * computed *over* the canonical bundle (manifest + entrypoint + docs) and
 * recorded alongside it as `InstalledSpinner` in the Grimoire (see
 * `./integrity.ts`).
 */
export interface SpinnerManifest {
  readonly manifestVersion: '1.0';
  readonly name: SpinnerName;
  /** Human-readable name shown everywhere in the Loom. Important. */
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  readonly homepage?: string;
  /** SPDX identifier (e.g. "Apache-2.0"). */
  readonly license: string;
  /** Module path the runtime loads to instantiate the Spinner. */
  readonly entrypoint: string;
  /** Optional "provider/model" identifier consumed by the BYOK gateway. */
  readonly model?: string;
  readonly vault: readonly VaultRef[];
  /**
   * Spools — registered data sources this Spinner reads from at
   * invocation time. The canon is a Spool. The manuscript is a Spool.
   * The Weaver enforces the reference: a Spinner cannot read from a
   * Spool it has not declared, even if the Spool is registered with the
   * Cell. See `./spool.ts`.
   */
  readonly spools: readonly SpoolRef[];
  readonly env: readonly EnvVarSpec[];
  readonly dependsOn: readonly SpinnerDependency[];
  readonly capabilities: readonly SpinnerCapability[];
  /**
   * Shell commands this Spinner may invoke through the Weaver's gated
   * `context.shell({command, args, cwd?, env?})` helper. Each entry is a
   * top-level binary name (e.g. "brew", "node", "pnpm"). The Weaver
   * refuses any command not in this list. Empty / omitted = no shell
   * access (the default). Per OPEN_QUESTIONS — *Cell provisioning*.
   */
  readonly shellAllowlist?: readonly string[];
  /**
   * Outbound hosts this Spinner may reach through the Weaver's gated
   * `context.fetch({url, method?, headers?, body?, timeoutMs?})` helper.
   * Each entry is a single fully-qualified DNS hostname (e.g.
   * `"en.wikipedia.org"`, `"www.irs.gov"`); paths/methods/headers aren't
   * restricted, hosts are. The Weaver refuses any URL whose host is not
   * in this list and emits `wp.spinner.outbound.fetch` (result=denied)
   * for the attempt. Empty / omitted = no outbound HTTP access (the
   * default). Mirrors `shellAllowlist` discipline: every external
   * dependency is declared in the manifest, audited per call, and
   * enforceable by the Weaver.
   */
  readonly outboundAllowlist?: readonly string[];
  /** Documentation surfaced in the Loom — required. */
  readonly documentation: SpinnerDocumentation;
  /**
   * Per-Spinner thumbnail — relative path inside the bundle directory.
   * Required. Every Spinner has a unique mark surfaced in the Loom: the
   * Skein card, the Installed list card, the Spinner detail page hero.
   * SVG is canonical (sharp at any size, themable, animatable, lightweight);
   * raster (PNG/WebP) is permitted but not preferred. Per `WARP-CANON.md`
   * §17.5 (*Wow as Baseline*) and §19.7 (*The UX is the architecture*).
   */
  readonly thumbnail: string;
  /**
   * Whether this Spinner can be a step in a Warp Thread. Default true.
   * Set false for Spinners that have side-effects or per-call constraints
   * that make composition unsafe.
   */
  readonly threadable: boolean;
  /** CloudEvents `source` for events this Spinner emits. */
  readonly audit: { readonly source: string };
}
