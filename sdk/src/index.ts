export type { Brand, JSONSchema } from './types.js';

export type {
  VaultURI,
  ParsedVaultURI,
  VaultURIParseError,
  VaultURIParseResult,
} from './vault-uri.js';
export { parseVaultURI, buildVaultURI } from './vault-uri.js';

export type {
  AuditEvent,
  AuditEventType,
  AuditEventData,
  AuditActor,
  AuditResult,
  AuditOcsfClass,
} from './audit-event.js';

export type {
  SpinnerManifest,
  SpinnerName,
  SpinnerDocumentation,
  SpinnerCapability,
  SpinnerDependency,
  VaultRef,
  EnvVarSpec,
} from './manifest.js';

export type {
  SpinnerDigest,
  SpinnerSignature,
  SpinnerSignatureAlgorithm,
  InstalledSpinner,
  IntegrityStatus,
} from './integrity.js';
export { parseSpinnerDigest, formatSpinnerDigest } from './integrity.js';

export { canonicalizeJSON } from './canonical-json.js';

export type {
  BundleReader,
  BundleDigestRecord,
  DocumentationDigest,
  DigestComputeError,
  DigestComputeResult,
} from './digest.js';
export { computeBundleDigest } from './digest.js';

export type {
  Ed25519Keypair,
  SignerLabel,
  SignBundleDigestInput,
  VerifyBundleDigestInput,
  VerifyResult,
} from './signing.js';
export {
  generateKeypair,
  keypairFromPrivateHex,
  fingerprintOf,
  signBundleDigest,
  verifyBundleDigest,
} from './signing.js';

export type {
  WarpThreadManifest,
  WarpThreadName,
  WarpThreadStep,
  WarpThreadValue,
  WarpThreadInputSpec,
} from './thread.js';

export type { SpoolManifest, SpoolName, SpoolRef, SpoolPassage } from './spool.js';

export type { SilkPatternEntry, SilkPatternMetrics, SilkPattern } from './silk-pattern.js';
