/**
 * `spinner.verify` operation — the meta-runtime envelope around the
 * Tier 0 verification primitive. Steps:
 *
 *   1. Validate the bundle path is within the Cell's known Spinner
 *      sandboxes.
 *   2. Read + parse `<bundlePath>/manifest.json`.
 *   3. Recompute the canonical bundle digest from current bytes.
 *   4. Read recorded provenance (`provenance/<hex>.json` +
 *      `signers.json`).
 *   5. If no provenance: report `unsigned: true`.
 *   6. If recomputed digest differs from recorded: report
 *      `digest-mismatch`. The bundle has been tampered with since
 *      signing (or was modified without re-signing).
 *   7. Otherwise verify every signature against its declared public
 *      key; report per-signer results.
 *   8. Record one row in `wp_operations` capturing the full report.
 *
 * Unlike sign, verify needs no vault access — it reads only on-disk
 * state. The PB connection is needed to write the operations row.
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  computeBundleDigest,
  readProvenance,
  verifyBundleDigest,
  type SpinnerManifest,
} from '@webspinner-foundation/sdk';
import { nodeProvenanceIO } from './provenance-node.js';
import { writeOperation, type OperationActor } from './operations.js';

export interface VerifyOperationInput {
  readonly bundlePath: string;
  readonly actor: OperationActor;
  readonly fetch: typeof fetch;
  readonly pbToken: string;
  readonly now?: () => Date;
}

export type VerifyOperationError =
  | { readonly kind: 'path-not-allowed'; readonly path: string }
  | { readonly kind: 'bundle-not-found'; readonly path: string }
  | { readonly kind: 'manifest-invalid'; readonly detail: string }
  | { readonly kind: 'digest-failed'; readonly detail: string };

export interface PerSignerVerify {
  readonly fingerprint: string;
  readonly signer: 'cell-identity-key' | 'foundation-release-key';
  readonly valid: boolean;
  readonly reason?: 'signature-invalid' | 'algorithm-unsupported';
}

export interface VerifyOperationOutput {
  readonly opId: string;
  readonly unsigned: boolean;
  readonly digestMatches: boolean;
  readonly recordedDigest?: string;
  readonly observedDigest: string;
  readonly signers: readonly PerSignerVerify[];
  readonly allValid: boolean;
}

export type VerifyOperationResult =
  | { readonly ok: true; readonly value: VerifyOperationOutput }
  | { readonly ok: false; readonly error: VerifyOperationError; readonly opId?: string };

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

export async function verifySpinnerBundle(
  input: VerifyOperationInput,
): Promise<VerifyOperationResult> {
  const startedAt = (input.now ?? (() => new Date()))().toISOString();

  if (!isPathAllowed(input.bundlePath)) {
    return finish({
      input,
      startedAt,
      result: { ok: false, error: { kind: 'path-not-allowed', path: input.bundlePath } },
    });
  }

  if (!(await bundleExists(input.bundlePath))) {
    return finish({
      input,
      startedAt,
      result: { ok: false, error: { kind: 'bundle-not-found', path: input.bundlePath } },
    });
  }

  let manifest: SpinnerManifest;
  try {
    const raw = await readFile(resolve(input.bundlePath, 'manifest.json'), 'utf8');
    manifest = JSON.parse(raw) as SpinnerManifest;
  } catch (e) {
    return finish({
      input,
      startedAt,
      result: {
        ok: false,
        error: { kind: 'manifest-invalid', detail: (e as Error).message },
      },
    });
  }

  const io = nodeProvenanceIO(input.bundlePath);
  const digestResult = await computeBundleDigest(manifest, io.reader, input.now);
  if (!digestResult.ok) {
    return finish({
      input,
      startedAt,
      result: {
        ok: false,
        error: { kind: 'digest-failed', detail: digestResult.error.kind },
      },
    });
  }

  const provenance = await readProvenance(io.reader);
  if (provenance === null) {
    return finish({
      input,
      startedAt,
      result: {
        ok: true,
        value: {
          opId: '',
          unsigned: true,
          digestMatches: false,
          observedDigest: digestResult.value.digest,
          signers: [],
          allValid: false,
        },
      },
    });
  }

  const digestMatches = provenance.signersManifest.digest === digestResult.value.digest;
  if (!digestMatches) {
    return finish({
      input,
      startedAt,
      result: {
        ok: true,
        value: {
          opId: '',
          unsigned: false,
          digestMatches: false,
          recordedDigest: provenance.signersManifest.digest,
          observedDigest: digestResult.value.digest,
          signers: [],
          allValid: false,
        },
      },
    });
  }

  const perSigner: PerSignerVerify[] = [];
  for (const signer of provenance.signersManifest.signers) {
    const sig = provenance.signaturesBySigner[signer.fingerprint];
    if (!sig) {
      perSigner.push({
        fingerprint: signer.fingerprint,
        signer: signer.signer,
        valid: false,
        reason: 'signature-invalid',
      });
      continue;
    }
    const v = verifyBundleDigest({
      digestRecord: provenance.digestRecord,
      signature: sig,
      publicKeyHex: signer.publicKeyHex,
    });
    if (v.ok) {
      perSigner.push({ fingerprint: signer.fingerprint, signer: signer.signer, valid: true });
    } else {
      perSigner.push({
        fingerprint: signer.fingerprint,
        signer: signer.signer,
        valid: false,
        reason: v.reason,
      });
    }
  }
  const allValid = perSigner.every((s) => s.valid);

  return finish({
    input,
    startedAt,
    result: {
      ok: true,
      value: {
        opId: '',
        unsigned: false,
        digestMatches: true,
        recordedDigest: provenance.signersManifest.digest,
        observedDigest: digestResult.value.digest,
        signers: perSigner,
        allValid,
      },
    },
  });
}

async function finish(args: {
  input: VerifyOperationInput;
  startedAt: string;
  result: VerifyOperationResult;
}): Promise<VerifyOperationResult> {
  const endedAt = (args.input.now ?? (() => new Date()))().toISOString();

  // Pick a status. `ok` outputs can still report a failed verification
  // — that's a `partial` status (the operation ran, the bundle didn't
  // pass).
  let status: 'ok' | 'failed' | 'partial';
  if (!args.result.ok) {
    status = 'failed';
  } else if (args.result.value.unsigned) {
    status = 'partial';
  } else if (!args.result.value.digestMatches || !args.result.value.allValid) {
    status = 'partial';
  } else {
    status = 'ok';
  }

  const write = await writeOperation(args.input.fetch, args.input.pbToken, {
    kind: 'spinner.verify',
    status,
    startedAt: args.startedAt,
    endedAt,
    actor: args.input.actor,
    input: { bundlePath: args.input.bundlePath },
    ...(args.result.ok
      ? { output: args.result.value as unknown as Record<string, unknown> }
      : {
          error: {
            kind: args.result.error.kind,
            message: JSON.stringify(args.result.error),
          },
        }),
  });

  if (!write.ok) {
    console.error(
      `[spinner-verify-op] failed to write wp_operations row: HTTP ${write.status} ${write.body}`,
    );
    return args.result;
  }

  if (args.result.ok) {
    return { ok: true, value: { ...args.result.value, opId: write.row.opId } };
  }
  return { ...args.result, opId: write.row.opId };
}
