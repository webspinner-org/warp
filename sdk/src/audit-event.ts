import type { VaultURI } from './vault-uri.js';
import type { SpinnerManifest, SpinnerName } from './manifest.js';

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
  | 'wp.thread.invoke';

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
  'wp.thread.invoke': {
    readonly threadId: string;
    readonly stepCount: number;
    readonly durationMs: number;
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
