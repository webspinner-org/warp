import type { VaultURI } from './vault-uri.js';
import type { SpinnerManifest, SpinnerName } from './manifest.js';
import type { SignerLabel } from './signing.js';

export type AuditEventType =
  | 'wp.vault.read'
  | 'wp.vault.write'
  | 'wp.vault.rotate'
  | 'wp.vault.delete'
  | 'wp.loom.login'
  | 'wp.loom.session.unlock'
  | 'wp.spinner.install'
  | 'wp.spinner.invoke'
  | 'wp.spinner.uninstall'
  | 'wp.spinner.integrity.fail'
  | 'wp.spinner.signed'
  | 'wp.spinner.verified'
  | 'wp.spinner.linted'
  | 'wp.spinner.integrity-checked'
  | 'wp.thread.invoke'
  | 'wp.weavers-tension.started'
  | 'wp.weavers-tension.step-approved'
  | 'wp.weavers-tension.step-flagged'
  | 'wp.weavers-tension.step-skipped'
  | 'wp.weavers-tension.step-completed'
  | 'wp.weavers-tension.step-failed'
  | 'wp.weavers-tension.step-remediated'
  | 'wp.weavers-tension.message'
  | 'wp.weavers-tension.paused'
  | 'wp.weavers-tension.resumed'
  | 'wp.weavers-tension.completed'
  | 'wp.weavers-tension.aborted';

export type AuditResult = 'success' | 'denied' | 'error';

/**
 * OCSF v1.8 class UIDs used for SIEM routing. We intentionally adopt only
 * the class identifiers, not the full OCSF payload schema — our `data` shape
 * is Warp-specific and lives in {@link AuditEventData}.
 */
export type AuditOcsfClass =
  | 3001 // Account Change
  | 3002 // Authentication
  | 6003; // API Activity

export interface AuditActor {
  readonly kind: 'human' | 'spinner' | 'system';
  /** User id, Spinner id, or 'foundation'. */
  readonly id: string;
  readonly displayName?: string;
  readonly remoteAddr?: string;
  /** e.g. 'pb-superuser' | 'cell-identity' | 'spinner-jwt' */
  readonly authMethod?: string;
}

/**
 * Discriminator-keyed payload shapes. Adding an event type is a single
 * diff: a new key here defines both the discriminator and the payload.
 */
export interface AuditEventData {
  'wp.vault.read': {
    readonly uri: VaultURI;
    readonly resolvedVersion: number;
  };
  'wp.vault.write': {
    readonly uri: VaultURI;
    readonly newVersion: number;
    readonly bytes: number;
  };
  'wp.vault.rotate': {
    readonly uri: VaultURI;
    readonly oldVersion: number;
    readonly newVersion: number;
  };
  'wp.vault.delete': {
    readonly uri: VaultURI;
    readonly hardDelete: boolean;
  };
  'wp.loom.login': {
    readonly method: string;
    readonly mfaUsed: boolean;
  };
  'wp.loom.session.unlock': {
    readonly sessionTtlSec: number;
  };
  'wp.spinner.install': {
    readonly manifest: SpinnerManifest;
    readonly digest: string;
    readonly signers: readonly string[];
  };
  'wp.spinner.invoke': {
    readonly spinnerId: SpinnerName;
    readonly capability: string;
    readonly durationMs: number;
  };
  'wp.spinner.uninstall': {
    readonly spinnerId: SpinnerName;
    readonly version: string;
  };
  'wp.spinner.integrity.fail': {
    readonly spinnerId: SpinnerName;
    readonly recordedDigest: string;
    readonly observedDigest: string;
    readonly action: 'gated' | 'warned';
  };
  /**
   * Emitted once per `signSpinnerBundle` call. Success cases populate
   * every domain field; early failures (path-not-allowed, bundle-not-
   * found, manifest-invalid) populate only what was known at the
   * failure point and set `errorKind`.
   */
  'wp.spinner.signed': {
    readonly bundlePath: string;
    readonly spinnerName?: SpinnerName;
    readonly digest?: string;
    readonly signerFingerprint?: string;
    readonly signerLabel?: SignerLabel;
    readonly identityCreated?: boolean;
    readonly errorKind?: string;
  };
  /**
   * Emitted once per `verifySpinnerBundle` call. `unsigned`,
   * `digestMatches`, `allValid` describe the verification verdict.
   * Early failures (path-not-allowed, manifest-invalid) populate only
   * `bundlePath` + `errorKind`.
   */
  'wp.spinner.verified': {
    readonly bundlePath: string;
    readonly spinnerName?: SpinnerName;
    readonly digestMatches?: boolean;
    readonly recordedDigest?: string;
    readonly observedDigest?: string;
    readonly signers?: readonly {
      readonly fingerprint: string;
      readonly valid: boolean;
      readonly reason?: string;
    }[];
    readonly allValid?: boolean;
    readonly unsigned?: boolean;
    readonly errorKind?: string;
  };
  /**
   * Emitted once per `refreshIntegrity` operation. Records the new
   * integrity verdict against the wp_skein row's previously-recorded
   * digest. `transition` carries the before/after status so an
   * auditor can spot when a Spinner went from verified → tampered.
   */
  'wp.spinner.integrity-checked': {
    readonly spinnerName: SpinnerName;
    readonly slug: string;
    readonly bundlePath: string;
    readonly previousStatus: string;
    readonly newStatus: string;
    readonly recordedDigest: string;
    readonly observedDigest?: string;
    readonly transitioned: boolean;
  };
  /**
   * Emitted once per `lintSpinnerBundle` operation. Success populates
   * digest + counts; the linter's findings live on the operation row
   * in `wp_operations.output`. Early failures (path-not-allowed,
   * manifest-invalid) populate only bundlePath + errorKind.
   */
  'wp.spinner.linted': {
    readonly bundlePath: string;
    readonly spinnerName?: SpinnerName;
    readonly ok?: boolean;
    readonly digest?: string;
    readonly errorCount?: number;
    readonly warningCount?: number;
    readonly errorKind?: string;
  };
  'wp.thread.invoke': {
    readonly threadId: string;
    readonly stepCount: number;
    readonly durationMs: number;
  };
  /**
   * Weaver's Tension — the narrated, gated scenario surface. Each run
   * fires a `started` event on creation, a `completed` or `aborted`
   * event on termination, and one `step-{approved,flagged,skipped}`
   * event per gate plus one `message` event per chat message.
   */
  'wp.weavers-tension.started': {
    readonly scenarioSlug: string;
    readonly runId: string;
    readonly stepCount: number;
  };
  'wp.weavers-tension.step-approved': {
    readonly scenarioSlug: string;
    readonly runId: string;
    readonly stepIndex: number;
    readonly stepKey: string;
    readonly observation?: string;
    readonly verifierEvidence?: Record<string, unknown>;
  };
  'wp.weavers-tension.step-flagged': {
    readonly scenarioSlug: string;
    readonly runId: string;
    readonly stepIndex: number;
    readonly stepKey: string;
    readonly reason: string;
    readonly verifierEvidence?: Record<string, unknown>;
  };
  'wp.weavers-tension.step-skipped': {
    readonly scenarioSlug: string;
    readonly runId: string;
    readonly stepIndex: number;
    readonly stepKey: string;
    readonly reason?: string;
  };
  'wp.weavers-tension.step-completed': {
    readonly scenarioSlug: string;
    readonly runId: string;
    readonly stepIndex: number;
    readonly stepKey: string;
    readonly evidence?: Record<string, unknown>;
  };
  'wp.weavers-tension.step-failed': {
    readonly scenarioSlug: string;
    readonly runId: string;
    readonly stepIndex: number;
    readonly stepKey: string;
    readonly reason: string;
    readonly evidence?: Record<string, unknown>;
  };
  'wp.weavers-tension.step-remediated': {
    readonly scenarioSlug: string;
    readonly runId: string;
    readonly stepIndex: number;
    readonly stepKey: string;
    readonly attempts: number;
    readonly evidence?: Record<string, unknown>;
  };
  'wp.weavers-tension.message': {
    readonly scenarioSlug: string;
    readonly runId: string;
    readonly stepIndex: number;
    readonly authorKind: 'wizard' | 'webspinner' | 'si' | 'system';
    readonly body: string;
  };
  'wp.weavers-tension.paused': {
    readonly scenarioSlug: string;
    readonly runId: string;
    readonly atStepIndex: number;
  };
  'wp.weavers-tension.resumed': {
    readonly scenarioSlug: string;
    readonly runId: string;
    readonly atStepIndex: number;
  };
  'wp.weavers-tension.completed': {
    readonly scenarioSlug: string;
    readonly runId: string;
    readonly approvedCount: number;
    readonly flaggedCount: number;
    readonly skippedCount: number;
    readonly durationMs: number;
  };
  'wp.weavers-tension.aborted': {
    readonly scenarioSlug: string;
    readonly runId: string;
    readonly atStepIndex: number;
    readonly reason: string;
  };
}

/**
 * AuditEvent — CloudEvents 1.0 envelope + OCSF class UID extension + Warp payload.
 *
 * - `id` is a UUIDv7 string (RFC 9562) — sortable by time, standardised.
 * - `wpreason` is required: matches Operating Principle §17.2 — every
 *   secret access logged with caller + timestamp + reason.
 * - `wpocsfclass` routes to SIEM tooling.
 *
 * Extension attributes are lowercase per the CloudEvents spec; the `wp`
 * prefix namespaces them to Warp.
 */
export interface AuditEvent<T extends AuditEventType = AuditEventType> {
  readonly specversion: '1.0';
  /** UUIDv7 string. Producer guarantees `source`+`id` is unique. */
  readonly id: string;
  /** URI of the producer (e.g. `wp://loom.cell.local/vault`). */
  readonly source: string;
  readonly type: T;

  /** RFC 3339 timestamp. */
  readonly time: string;
  /** Resource targeted — e.g. the VaultURI string for vault events. */
  readonly subject?: string;
  readonly datacontenttype: 'application/json';

  // CloudEvents extension attributes (lowercase per spec).
  readonly wpactor: AuditActor;
  readonly wpresult: AuditResult;
  readonly wpreason: string;
  /** Trace correlation across services. */
  readonly wpcorrelationid?: string;
  readonly wpocsfclass: AuditOcsfClass;

  readonly data: AuditEventData[T];
}
