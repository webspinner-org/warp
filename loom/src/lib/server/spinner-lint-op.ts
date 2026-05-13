/**
 * `spinner.lint` operation — the meta-runtime envelope around the
 * Tier 0 lint primitive. Steps:
 *
 *   1. Validate the bundle path is within the Cell's known Spinner
 *      sandboxes (`$HOME/warp/spinners/` or `$HOME/Cells/spinners/`).
 *   2. Read + parse `<bundlePath>/manifest.json`.
 *   3. Run `lintSpinnerBundle` against the parsed manifest + on-disk
 *      bundle.
 *   4. Record one row in `wp_operations` with structured input/output.
 *   5. Emit one `wp.spinner.linted` audit event correlated to the op.
 *
 * Lint findings live on the operation's output for the Webspinner/operator
 * to inspect at `/admin/operations/<opId>`; the audit event carries
 * the summary counts (errorCount, warningCount, ok) for compliance
 * filtering.
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  lintSpinnerBundle,
  type AuditEventData,
  type AuditResult,
  type LintResult,
  type SpinnerManifest,
  type SpinnerName,
} from '@webspinner-foundation/sdk';
import { getCellIdentity } from './identity.js';
import { nodeProvenanceIO } from './provenance-node.js';
import { ensureAuditCollection, writeAuditEvent } from './audit.js';
import { writeOperation, operationActorToAuditActor, type OperationActor } from './operations.js';

export interface LintOperationInput {
  readonly bundlePath: string;
  readonly actor: OperationActor;
  readonly fetch: typeof fetch;
  readonly pbToken: string;
  readonly now?: () => Date;
}

export type LintOperationError =
  | { readonly kind: 'path-not-allowed'; readonly path: string }
  | { readonly kind: 'bundle-not-found'; readonly path: string }
  | { readonly kind: 'manifest-invalid'; readonly detail: string };

export interface LintOperationOutput {
  readonly opId: string;
  readonly digest?: string;
  readonly ok: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly findings: LintResult['findings'];
  readonly bundleStats: LintResult['bundleStats'];
}

export type LintOperationResult =
  | { readonly ok: true; readonly value: LintOperationOutput }
  | { readonly ok: false; readonly error: LintOperationError; readonly opId?: string };

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

export async function lintSpinnerBundleOp(input: LintOperationInput): Promise<LintOperationResult> {
  const startedAt = (input.now ?? (() => new Date()))().toISOString();
  let spinnerName: SpinnerName | undefined;

  if (!isPathAllowed(input.bundlePath)) {
    return finish({
      input,
      startedAt,
      result: { ok: false, error: { kind: 'path-not-allowed', path: input.bundlePath } },
      spinnerName,
    });
  }

  if (!(await bundleExists(input.bundlePath))) {
    return finish({
      input,
      startedAt,
      result: { ok: false, error: { kind: 'bundle-not-found', path: input.bundlePath } },
      spinnerName,
    });
  }

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
    });
  }

  const io = nodeProvenanceIO(input.bundlePath);
  const lintResult = await lintSpinnerBundle(manifest, io.reader);

  const errorCount = lintResult.findings.filter((f) => f.severity === 'error').length;
  const warningCount = lintResult.findings.filter((f) => f.severity === 'warning').length;

  return finish({
    input,
    startedAt,
    result: {
      ok: true,
      value: {
        opId: '',
        ...(lintResult.digest !== undefined ? { digest: lintResult.digest } : {}),
        ok: lintResult.ok,
        errorCount,
        warningCount,
        findings: lintResult.findings,
        bundleStats: lintResult.bundleStats,
      },
    },
    spinnerName,
  });
}

async function finish(args: {
  input: LintOperationInput;
  startedAt: string;
  result: LintOperationResult;
  spinnerName?: SpinnerName;
}): Promise<LintOperationResult> {
  const endedAt = (args.input.now ?? (() => new Date()))().toISOString();

  // Map operation outcome to operations.status.
  let status: 'ok' | 'failed' | 'partial';
  if (!args.result.ok) {
    status = 'failed';
  } else if (!args.result.value.ok) {
    // Lint ran but reported errors — partial: we got a clean answer
    // (the bundle is invalid), the op itself didn't fail.
    status = 'partial';
  } else if (args.result.value.warningCount > 0) {
    status = 'partial'; // warnings advised; lint passed
  } else {
    status = 'ok';
  }

  const write = await writeOperation(args.input.fetch, args.input.pbToken, {
    kind: 'spinner.lint',
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
      `[spinner-lint-op] failed to write wp_operations row: HTTP ${write.status} ${write.body}`,
    );
    return args.result;
  }
  const opId = write.row.opId;

  try {
    await emitLintAuditEvent({ ...args, opId });
  } catch (err) {
    console.error(`[spinner-lint-op] audit write failed: ${(err as Error).message}`);
  }

  if (args.result.ok) {
    return { ok: true, value: { ...args.result.value, opId } };
  }
  return { ...args.result, opId };
}

async function emitLintAuditEvent(args: {
  input: LintOperationInput;
  result: LintOperationResult;
  spinnerName?: SpinnerName;
  opId: string;
}): Promise<void> {
  const ensured = await ensureAuditCollection(args.input.fetch, args.input.pbToken);
  if (!ensured.ok) {
    throw new Error(`audit ensure failed: HTTP ${ensured.status} ${ensured.body}`);
  }

  let cellFingerprint = 'unknown';
  try {
    const id = await getCellIdentity(args.input.fetch, args.input.pbToken);
    if (id) cellFingerprint = id.fingerprint;
  } catch {
    // best-effort
  }
  const source = `urn:webspinner:cell:${cellFingerprint}`;

  let auditResult: AuditResult;
  let reason: string;
  if (!args.result.ok) {
    if (args.result.error.kind === 'path-not-allowed') {
      auditResult = 'denied';
      reason = `Bundle path refused by sandbox: ${args.result.error.path}`;
    } else {
      auditResult = 'error';
      reason = `Lint failed: ${args.result.error.kind}`;
    }
  } else if (!args.result.value.ok) {
    auditResult = 'error';
    reason = `Bundle lint failed: ${args.result.value.errorCount} error(s)`;
  } else if (args.result.value.warningCount > 0) {
    auditResult = 'success';
    reason = `Bundle lint passed with ${args.result.value.warningCount} warning(s)`;
  } else {
    auditResult = 'success';
    reason = `Bundle lint clean${args.spinnerName ? ` (${args.spinnerName})` : ''}`;
  }

  const successFields: Partial<AuditEventData['wp.spinner.linted']> = args.result.ok
    ? {
        ok: args.result.value.ok,
        errorCount: args.result.value.errorCount,
        warningCount: args.result.value.warningCount,
        ...(args.result.value.digest !== undefined ? { digest: args.result.value.digest } : {}),
      }
    : { errorKind: args.result.error.kind };

  const data: AuditEventData['wp.spinner.linted'] = {
    bundlePath: args.input.bundlePath,
    ...(args.spinnerName !== undefined ? { spinnerName: args.spinnerName } : {}),
    ...successFields,
  };

  await writeAuditEvent(args.input.fetch, args.input.pbToken, {
    type: 'wp.spinner.linted',
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
