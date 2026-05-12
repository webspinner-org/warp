/**
 * `spinner.sign` operation — the meta-runtime envelope around the
 * Tier 0 signing primitive. Steps:
 *
 *   1. Validate the bundle path is within the Cell's known Spinner
 *      sandboxes (`$HOME/warp/spinners/` or `$HOME/Cells/spinners/`).
 *   2. Read + parse `<bundlePath>/manifest.json`.
 *   3. Compute the canonical bundle digest.
 *   4. Ensure the Cell identity is provisioned (auto-creates on first
 *      sign).
 *   5. Sign the digest record with the Cell's identity key.
 *   6. Write provenance (`provenance/<hex>.json` + `.sig` +
 *      `signers.json`).
 *   7. Record one row in `wp_operations` with structured input/output.
 *
 * The op is **idempotent** at the SDK layer — re-signing the same
 * bundle with the same key produces the same on-disk bytes — but the
 * operation row is always written, so the Wizard can see they
 * re-signed (a normal event, not an error).
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  computeBundleDigest,
  signBundleDigest,
  writeProvenance,
  type AuditEventData,
  type AuditResult,
  type SignerLabel,
  type SpinnerManifest,
  type SpinnerName,
  type SignersManifest,
} from '@webspinner-foundation/sdk';
import { ensureCellIdentity, loadCellKeypair, type CellIdentityPublic } from './identity.js';
import { nodeProvenanceIO } from './provenance-node.js';
import { ensureAuditCollection, writeAuditEvent } from './audit.js';
import { writeOperation, operationActorToAuditActor, type OperationActor } from './operations.js';

export interface SignOperationInput {
  readonly bundlePath: string;
  readonly actor: OperationActor;
  readonly fetch: typeof fetch;
  readonly pbToken: string;
  readonly masterKey: string;
  readonly now?: () => Date;
}

export type SignOperationError =
  | { readonly kind: 'path-not-allowed'; readonly path: string }
  | { readonly kind: 'bundle-not-found'; readonly path: string }
  | { readonly kind: 'manifest-invalid'; readonly detail: string }
  | { readonly kind: 'digest-failed'; readonly detail: string }
  | { readonly kind: 'identity-failed'; readonly detail: string }
  | { readonly kind: 'provenance-failed'; readonly detail: string };

export interface SignOperationOutput {
  readonly opId: string;
  readonly digest: string;
  readonly signerFingerprint: string;
  readonly signerLabel: 'cell-identity-key';
  readonly signersManifest: SignersManifest;
  readonly identityCreated: boolean;
  readonly filesWritten: readonly string[];
}

export type SignOperationResult =
  | { readonly ok: true; readonly value: SignOperationOutput }
  | { readonly ok: false; readonly error: SignOperationError; readonly opId?: string };

function allowedBundleRoots(): readonly string[] {
  return [resolve(homedir(), 'warp/spinners'), resolve(homedir(), 'Cells/spinners')];
}

function isPathAllowed(bundlePath: string): boolean {
  const abs = resolve(bundlePath);
  for (const root of allowedBundleRoots()) {
    if (abs === root) return false; // the root itself is not a bundle
    if (abs.startsWith(root + '/') || abs.startsWith(root + '\\')) return true;
  }
  return false;
}

async function bundleExists(bundlePath: string): Promise<boolean> {
  try {
    const s = await stat(bundlePath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function signSpinnerBundle(input: SignOperationInput): Promise<SignOperationResult> {
  const startedAt = (input.now ?? (() => new Date()))().toISOString();
  // Audit-context accumulators — populated as the pipeline progresses so
  // finish() can write a maximally-informative audit event regardless of
  // where we exit.
  let spinnerName: SpinnerName | undefined;
  // eslint-disable-next-line prefer-const -- reassigned after ensureCellIdentity succeeds; ESLint's flow analysis misses it
  let cellFingerprint: string | undefined;

  // Step 1: path validation.
  if (!isPathAllowed(input.bundlePath)) {
    return finish({
      input,
      startedAt,
      result: { ok: false, error: { kind: 'path-not-allowed', path: input.bundlePath } },
      spinnerName,
      cellFingerprint,
    });
  }

  if (!(await bundleExists(input.bundlePath))) {
    return finish({
      input,
      startedAt,
      result: { ok: false, error: { kind: 'bundle-not-found', path: input.bundlePath } },
      spinnerName,
      cellFingerprint,
    });
  }

  // Step 2: manifest.
  let manifest: SpinnerManifest;
  try {
    const raw = await readFile(resolve(input.bundlePath, 'manifest.json'), 'utf8');
    manifest = JSON.parse(raw) as SpinnerManifest;
    spinnerName = manifest.name;
  } catch (e) {
    return finish({
      input,
      startedAt,
      result: {
        ok: false,
        error: { kind: 'manifest-invalid', detail: (e as Error).message },
      },
      spinnerName,
      cellFingerprint,
    });
  }

  const io = nodeProvenanceIO(input.bundlePath);

  // Step 3: digest.
  const digestResult = await computeBundleDigest(manifest, io.reader, input.now);
  if (!digestResult.ok) {
    return finish({
      input,
      startedAt,
      result: {
        ok: false,
        error: { kind: 'digest-failed', detail: digestResult.error.kind },
      },
      spinnerName,
      cellFingerprint,
    });
  }

  // Step 4: identity.
  const ensure = await ensureCellIdentity(input.fetch, input.pbToken, input.masterKey, input.now);
  if (!ensure.ok) {
    return finish({
      input,
      startedAt,
      result: {
        ok: false,
        error: { kind: 'identity-failed', detail: JSON.stringify(ensure.error) },
      },
      spinnerName,
      cellFingerprint,
    });
  }
  const identity: CellIdentityPublic = ensure.value.identity;
  cellFingerprint = identity.fingerprint;

  const keypairResult = await loadCellKeypair(input.fetch, input.pbToken, input.masterKey);
  if (!keypairResult.ok || !keypairResult.value) {
    return finish({
      input,
      startedAt,
      result: {
        ok: false,
        error: {
          kind: 'identity-failed',
          detail: keypairResult.ok
            ? 'no-keypair-after-ensure'
            : JSON.stringify(keypairResult.error),
        },
      },
      spinnerName,
      cellFingerprint,
    });
  }
  const keypair = keypairResult.value;

  // Step 5: sign.
  const signature = signBundleDigest({
    digestRecord: digestResult.value,
    privateKeyHex: keypair.privateKeyHex,
    publicKeyHex: keypair.publicKeyHex,
    signer: 'cell-identity-key',
    now: input.now,
  });

  // Step 6: provenance.
  const wrote = await writeProvenance({
    digestRecord: digestResult.value,
    signature,
    publicKeyHex: keypair.publicKeyHex,
    signerLabel: 'cell-identity-key',
    reader: io.reader,
    writer: io.writer,
  });
  if (!wrote.ok) {
    return finish({
      input,
      startedAt,
      result: {
        ok: false,
        error: { kind: 'provenance-failed', detail: JSON.stringify(wrote.error) },
      },
      spinnerName,
      cellFingerprint,
    });
  }

  const hex = digestResult.value.digest.split(':')[1] ?? '';
  const filesWritten = [
    `provenance/${hex}.json`,
    `provenance/${hex}.${signature.signer}.sig`,
    `provenance/signers.json`,
  ];

  return finish({
    input,
    startedAt,
    result: {
      ok: true,
      value: {
        opId: '', // filled in by finish()
        digest: digestResult.value.digest,
        signerFingerprint: identity.fingerprint,
        signerLabel: 'cell-identity-key',
        signersManifest: wrote.signersManifest,
        identityCreated: ensure.value.created,
        filesWritten,
      },
    },
    spinnerName,
    cellFingerprint,
  });
}

async function finish(args: {
  input: SignOperationInput;
  startedAt: string;
  result: SignOperationResult;
  spinnerName?: SpinnerName;
  cellFingerprint?: string;
}): Promise<SignOperationResult> {
  const endedAt = (args.input.now ?? (() => new Date()))().toISOString();
  const inputPayload = { bundlePath: args.input.bundlePath };

  const write = await writeOperation(args.input.fetch, args.input.pbToken, {
    kind: 'spinner.sign',
    status: args.result.ok ? 'ok' : 'failed',
    startedAt: args.startedAt,
    endedAt,
    actor: args.input.actor,
    input: inputPayload,
    ...(args.result.ok
      ? {
          output: {
            digest: args.result.value.digest,
            signerFingerprint: args.result.value.signerFingerprint,
            identityCreated: args.result.value.identityCreated,
            filesWritten: args.result.value.filesWritten,
          },
        }
      : {
          error: {
            kind: args.result.error.kind,
            message: JSON.stringify(args.result.error),
          },
        }),
  });

  if (!write.ok) {
    // We logged nothing — return the original result but flag the
    // operations write failure on stderr so the operator sees it.
    console.error(
      `[spinner-sign-op] failed to write wp_operations row: HTTP ${write.status} ${write.body}`,
    );
    return args.result;
  }
  const opId = write.row.opId;

  // Audit event — one per call, correlated to the operation by opId.
  // Failures here don't propagate; the operation already succeeded or
  // failed independently of audit-write health.
  try {
    await emitSignAuditEvent({ ...args, opId });
  } catch (err) {
    console.error(`[spinner-sign-op] audit write failed: ${(err as Error).message}`);
  }

  if (args.result.ok) {
    return { ok: true, value: { ...args.result.value, opId } };
  }
  return { ...args.result, opId };
}

async function emitSignAuditEvent(args: {
  input: SignOperationInput;
  result: SignOperationResult;
  spinnerName?: SpinnerName;
  cellFingerprint?: string;
  opId: string;
}): Promise<void> {
  // Idempotently ensure the audit collection exists before writing.
  // First-call cost is one GET; steady-state is one GET (cached at PB).
  const ensured = await ensureAuditCollection(args.input.fetch, args.input.pbToken);
  if (!ensured.ok) {
    throw new Error(`audit ensure failed: HTTP ${ensured.status} ${ensured.body}`);
  }

  const source = `urn:webspinner:cell:${args.cellFingerprint ?? 'unknown'}`;

  let auditResult: AuditResult;
  let reason: string;
  if (args.result.ok) {
    auditResult = 'success';
    reason = `Signed ${args.spinnerName ?? args.input.bundlePath} → ${args.result.value.digest}`;
  } else if (args.result.error.kind === 'path-not-allowed') {
    auditResult = 'denied';
    reason = `Bundle path refused by sandbox: ${args.result.error.path}`;
  } else {
    auditResult = 'error';
    reason = `Sign failed: ${args.result.error.kind}`;
  }

  const successFields: Partial<AuditEventData['wp.spinner.signed']> = args.result.ok
    ? {
        digest: args.result.value.digest,
        signerFingerprint: args.result.value.signerFingerprint,
        signerLabel: args.result.value.signerLabel satisfies SignerLabel,
        identityCreated: args.result.value.identityCreated,
      }
    : { errorKind: args.result.error.kind };

  const data: AuditEventData['wp.spinner.signed'] = {
    bundlePath: args.input.bundlePath,
    ...(args.spinnerName !== undefined ? { spinnerName: args.spinnerName } : {}),
    ...successFields,
  };

  await writeAuditEvent(args.input.fetch, args.input.pbToken, {
    type: 'wp.spinner.signed',
    source,
    subject: args.spinnerName ?? args.input.bundlePath,
    actor: operationActorToAuditActor(args.input.actor),
    result: auditResult,
    reason,
    correlationId: args.opId,
    ocsfClass: 6003,
    data,
  });
}
