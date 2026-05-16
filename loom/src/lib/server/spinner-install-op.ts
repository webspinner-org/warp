/**
 * `spinner.install` operation — the write side of the Spinner
 * lifecycle. Takes a bundle that exists on disk, validates it via
 * `lintSpinnerBundle` (errors gate), signs it with the Cell identity
 * if not already signed, classifies its source, computes the
 * integrity verdict, and writes the `wp_skein` row. Idempotent on
 * re-install (the row is PATCHed).
 *
 * The pipeline batch 5's authoring form calls to finish a save:
 *   form fills template → install reads it → lint → sign → register
 *
 * Steps in order:
 *   1. path allowlist        — refuse outside known sandboxes
 *   2. bundle exists         — refuse if directory missing
 *   3. read manifest.json    — refuse if malformed
 *   4. lint                  — call lintSpinnerBundle; refuse on errors
 *   5. ensure Cell identity  — auto-provision on first install
 *   6. sign-if-needed        — read provenance, sign + write if absent
 *   7. classify source       — path + signers → genesis/cell-authored/etc.
 *   8. integrity verdict     — verify the provenance we just have
 *   9. upsertSkeinRow        — write the wp_skein row
 *   10. write wp_operations  — kind: 'spinner.install'
 *   11. write wp_audit       — type: 'wp.spinner.install' (present tense
 *       per existing canon; past-tense rename is a separate cosmetic
 *       batch)
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import {
  lintSpinnerBundle,
  computeBundleDigest,
  signBundleDigest,
  writeProvenance,
  readProvenance,
  verifyBundleDigest,
  type LintFinding,
  type SpinnerManifest,
  type SpinnerName,
} from '@webspinner-foundation/sdk';
import { ensureCellIdentity, loadCellKeypair, type CellIdentityPublic } from './identity.js';
import { nodeProvenanceIO } from './provenance-node.js';
import { ensureAuditCollection, writeAuditEvent } from './audit.js';
import {
  ensureSkeinCollection,
  upsertSkeinRow,
  classifySource,
  type IntegrityStatus,
  type SkeinSigner,
  type SkeinSource,
} from './skein.js';
import { writeOperation, operationActorToAuditActor, type OperationActor } from './operations.js';

export interface InstallOperationInput {
  readonly bundlePath: string;
  readonly actor: OperationActor;
  readonly fetch: typeof fetch;
  readonly pbToken: string;
  readonly masterKey: string;
  readonly now?: () => Date;
  /**
   * When true, the resulting wp_skein row is marked isDemo=true so it
   * won't pollute the default Skein view and will be swept by TTL.
   * Author defaults to true for test runs; UI installs default false.
   */
  readonly isDemo?: boolean;
}

export type InstallOperationError =
  | { readonly kind: 'path-not-allowed'; readonly path: string }
  | { readonly kind: 'bundle-not-found'; readonly path: string }
  | { readonly kind: 'manifest-invalid'; readonly detail: string }
  | {
      readonly kind: 'lint-failed';
      readonly errorCount: number;
      readonly findings: readonly LintFinding[];
    }
  | { readonly kind: 'identity-failed'; readonly detail: string }
  | { readonly kind: 'sign-failed'; readonly detail: string }
  | { readonly kind: 'provenance-failed'; readonly detail: string }
  | { readonly kind: 'skein-write-failed'; readonly detail: string };

export interface InstallOperationOutput {
  readonly opId: string;
  readonly spinnerName: SpinnerName;
  readonly slug: string;
  readonly digest: string;
  readonly integrityStatus: IntegrityStatus;
  readonly source: SkeinSource;
  readonly installedAt: string;
  readonly alreadySigned: boolean;
  readonly signerFingerprints: readonly string[];
  readonly filesWritten: readonly string[];
  readonly weaverReloaded: boolean;
}

export type InstallOperationResult =
  | { readonly ok: true; readonly value: InstallOperationOutput }
  | { readonly ok: false; readonly error: InstallOperationError; readonly opId?: string };

function allowedBundleRoots(): readonly string[] {
  return [resolve(homedir(), 'warp/spinners'), resolve(homedir(), 'Cells/spinners')];
}

function isPathAllowed(bundlePath: string): boolean {
  const abs = resolve(bundlePath);
  for (const root of allowedBundleRoots()) {
    if (abs === root) return false;
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

export async function installSpinnerBundle(
  input: InstallOperationInput,
): Promise<InstallOperationResult> {
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  let spinnerName: SpinnerName | undefined;
  let manifestSnapshot: SpinnerManifest | undefined;

  // 1. path allowlist
  if (!isPathAllowed(input.bundlePath)) {
    return finish({
      input,
      startedAt,
      result: { ok: false, error: { kind: 'path-not-allowed', path: input.bundlePath } },
      spinnerName,
      manifestSnapshot,
    });
  }

  // 2. bundle exists
  if (!(await bundleExists(input.bundlePath))) {
    return finish({
      input,
      startedAt,
      result: { ok: false, error: { kind: 'bundle-not-found', path: input.bundlePath } },
      spinnerName,
      manifestSnapshot,
    });
  }

  // 3. read manifest
  let manifest: SpinnerManifest;
  try {
    const raw = await readFile(resolve(input.bundlePath, 'manifest.json'), 'utf8');
    manifest = JSON.parse(raw) as SpinnerManifest;
    spinnerName = manifest.name;
    manifestSnapshot = manifest;
  } catch (e) {
    return finish({
      input,
      startedAt,
      result: {
        ok: false,
        error: { kind: 'manifest-invalid', detail: (e as Error).message },
      },
      spinnerName,
      manifestSnapshot,
    });
  }

  const io = nodeProvenanceIO(input.bundlePath);

  // 4. lint (errors gate)
  const lintResult = await lintSpinnerBundle(manifest, io.reader);
  if (!lintResult.ok) {
    const errors = lintResult.findings.filter((f) => f.severity === 'error');
    return finish({
      input,
      startedAt,
      result: {
        ok: false,
        error: {
          kind: 'lint-failed',
          errorCount: errors.length,
          findings: lintResult.findings,
        },
      },
      spinnerName,
      manifestSnapshot,
    });
  }

  // 5. ensure Cell identity
  const ensure = await ensureCellIdentity(input.fetch, input.pbToken, input.masterKey, now);
  if (!ensure.ok) {
    return finish({
      input,
      startedAt,
      result: {
        ok: false,
        error: { kind: 'identity-failed', detail: JSON.stringify(ensure.error) },
      },
      spinnerName,
      manifestSnapshot,
    });
  }
  const identity: CellIdentityPublic = ensure.value.identity;
  const cellFingerprint = identity.fingerprint;

  // 6. sign-if-needed
  let alreadySigned = false;
  let filesWritten: string[] = [];
  const existingProvenance = await readProvenance(io.reader);
  let provenanceSigners: SkeinSigner[];
  let recordedDigest: string;

  if (existingProvenance && existingProvenance.signersManifest.signers.length > 0) {
    alreadySigned = true;
    recordedDigest = existingProvenance.signersManifest.digest;
    provenanceSigners = existingProvenance.signersManifest.signers.map((s) => ({
      fingerprint: s.fingerprint,
      signerLabel: s.signer,
      signedAt: s.signedAt,
    }));
  } else {
    // Compute digest, load keypair, sign, write provenance.
    const digestResult = await computeBundleDigest(manifest, io.reader, now);
    if (!digestResult.ok) {
      return finish({
        input,
        startedAt,
        result: {
          ok: false,
          error: { kind: 'sign-failed', detail: `digest: ${digestResult.error.kind}` },
        },
        spinnerName,
        manifestSnapshot,
      });
    }

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
        manifestSnapshot,
      });
    }
    const keypair = keypairResult.value;

    const signature = signBundleDigest({
      digestRecord: digestResult.value,
      privateKeyHex: keypair.privateKeyHex,
      publicKeyHex: keypair.publicKeyHex,
      signer: 'cell-identity-key',
      now,
    });

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
        manifestSnapshot,
      });
    }

    const hex = digestResult.value.digest.split(':')[1] ?? '';
    filesWritten = [
      `provenance/${hex}.json`,
      `provenance/${hex}.${signature.signer}.sig`,
      `provenance/signers.json`,
    ];
    recordedDigest = digestResult.value.digest;
    provenanceSigners = [
      {
        fingerprint: signature.signer,
        signerLabel: 'cell-identity-key',
        signedAt: signature.signedAt,
      },
    ];
  }

  // 7. classify source
  const source = classifySource(input.bundlePath, provenanceSigners, cellFingerprint);

  // 8. integrity verdict — re-verify after signing so the recorded status
  //    matches reality. (If alreadySigned, verify each signer's signature
  //    against the recorded digest record.)
  let integrityStatus: IntegrityStatus = 'verified';
  if (alreadySigned && existingProvenance) {
    let allValid = true;
    for (const signer of existingProvenance.signersManifest.signers) {
      const sig = existingProvenance.signaturesBySigner[signer.fingerprint];
      if (!sig) {
        allValid = false;
        continue;
      }
      const v = verifyBundleDigest({
        digestRecord: existingProvenance.digestRecord,
        signature: sig,
        publicKeyHex: signer.publicKeyHex,
      });
      if (!v.ok) allValid = false;
    }
    integrityStatus = allValid ? 'verified' : 'signature-invalid';
  }

  // 9. upsert skein row
  const slug = basename(resolve(input.bundlePath));
  const installedAt = now().toISOString();
  const upsert = await upsertSkeinRow(input.fetch, input.pbToken, {
    name: manifest.name,
    slug,
    version: manifest.version,
    bundlePath: resolve(input.bundlePath),
    source,
    recordedDigest,
    signers: provenanceSigners,
    integrityStatus,
    lastIntegrityCheck: installedAt,
    installedAt,
    installedBy: input.actor.email ?? input.actor.id,
    ...(input.isDemo === true ? { isDemo: true } : {}),
  });
  if (!upsert.ok) {
    return finish({
      input,
      startedAt,
      result: {
        ok: false,
        error: {
          kind: 'skein-write-failed',
          detail: `HTTP ${upsert.status}: ${upsert.body.slice(0, 200)}`,
        },
      },
      spinnerName,
      manifestSnapshot,
    });
  }

  return finish({
    input,
    startedAt,
    result: {
      ok: true,
      value: {
        opId: '',
        spinnerName: manifest.name,
        slug,
        digest: recordedDigest,
        integrityStatus,
        source,
        installedAt,
        alreadySigned,
        signerFingerprints: provenanceSigners.map((s) => s.fingerprint),
        filesWritten,
        weaverReloaded: false,
      },
    },
    spinnerName,
    manifestSnapshot,
  });
}

async function finish(args: {
  input: InstallOperationInput;
  startedAt: string;
  result: InstallOperationResult;
  spinnerName?: SpinnerName;
  manifestSnapshot?: SpinnerManifest;
}): Promise<InstallOperationResult> {
  const endedAt = (args.input.now ?? (() => new Date()))().toISOString();

  const ensureSkein = await ensureSkeinCollection(args.input.fetch, args.input.pbToken);
  if (!ensureSkein.ok && args.result.ok) {
    // Couldn't ensure the collection — surface as failure even though
    // upstream got far enough to compute a result.
    args = {
      ...args,
      result: {
        ok: false,
        error: {
          kind: 'skein-write-failed',
          detail: `ensure-collection: HTTP ${ensureSkein.status}`,
        },
      },
    };
  }

  const write = await writeOperation(args.input.fetch, args.input.pbToken, {
    kind: 'spinner.install',
    status: args.result.ok ? 'ok' : 'failed',
    startedAt: args.startedAt,
    endedAt,
    actor: args.input.actor,
    input: { bundlePath: args.input.bundlePath },
    ...(args.result.ok
      ? {
          output: {
            spinnerName: args.result.value.spinnerName,
            slug: args.result.value.slug,
            digest: args.result.value.digest,
            integrityStatus: args.result.value.integrityStatus,
            source: args.result.value.source,
            installedAt: args.result.value.installedAt,
            alreadySigned: args.result.value.alreadySigned,
            signerFingerprints: args.result.value.signerFingerprints,
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
    console.error(
      `[spinner-install-op] failed to write wp_operations row: HTTP ${write.status} ${write.body}`,
    );
    return args.result;
  }
  const opId = write.row.opId;

  // Audit event only on successful install (the existing
  // `wp.spinner.install` data shape requires manifest + digest +
  // signers; failure cases don't have all three). Operation row
  // captures attempts in either case.
  if (args.result.ok && args.manifestSnapshot) {
    try {
      await emitInstallAuditEvent({
        input: args.input,
        result: args.result,
        manifest: args.manifestSnapshot,
        opId,
      });
    } catch (err) {
      console.error(`[spinner-install-op] audit write failed: ${(err as Error).message}`);
    }
  }

  if (args.result.ok) {
    return { ok: true, value: { ...args.result.value, opId } };
  }
  return { ...args.result, opId };
}

async function emitInstallAuditEvent(args: {
  input: InstallOperationInput;
  result: { readonly ok: true; readonly value: InstallOperationOutput };
  manifest: SpinnerManifest;
  opId: string;
}): Promise<void> {
  const ensured = await ensureAuditCollection(args.input.fetch, args.input.pbToken);
  if (!ensured.ok) {
    throw new Error(`audit ensure failed: HTTP ${ensured.status} ${ensured.body}`);
  }

  const source = `urn:webspinner:cell:${args.result.value.signerFingerprints[0] ?? 'unknown'}`;

  await writeAuditEvent(args.input.fetch, args.input.pbToken, {
    type: 'wp.spinner.install',
    source,
    subject: args.manifest.name,
    actor: operationActorToAuditActor(args.input.actor),
    result: 'success',
    reason: `Installed ${args.manifest.name} v${args.manifest.version} (${args.result.value.source}, ${args.result.value.integrityStatus})`,
    correlationId: args.opId,
    ocsfClass: 6003,
    data: {
      manifest: args.manifest,
      digest: args.result.value.digest,
      signers: args.result.value.signerFingerprints,
    },
  });
}
