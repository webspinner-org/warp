/**
 * Spinner bundle linter — validates that a bundle is well-formed enough
 * to sign + install. Called by `tools/spinner-lint` (Loom-mediated),
 * by `tools/ship` when a Spinner directory changes, and (eventually)
 * by the meta-runtime's `spinner.install` op as a pre-flight gate.
 *
 * Three tiers of findings:
 *   - ERRORS gate sign + install: malformed manifest, missing required
 *     files, name/version pattern violations, undignable bundle.
 *   - WARNINGS advise but don't gate: short docs, missing capability
 *     schemas, empty license.
 *   - INFO is recorded for the operator's view: capability count,
 *     bundle size, computed digest.
 *
 * Pablo (UX review) and Bootstrap (canon-drift review) are deliberately
 * separate — they review prose + UI surfaces; lint validates structure.
 */

import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js';
import { spinnerManifestSchema } from './spinner-manifest-schema.js';
import { computeBundleDigest, type BundleReader } from './digest.js';
import type { SpinnerDigest } from './integrity.js';
import type { SpinnerManifest } from './manifest.js';

export interface LintFinding {
  readonly severity: 'error' | 'warning' | 'info';
  readonly rule: string;
  readonly message: string;
  /** JSON Pointer into the manifest, when applicable. */
  readonly field?: string;
}

export interface LintBundleStats {
  readonly capabilityCount: number;
  readonly declaredDocCount: number;
  readonly bundleSizeBytes: number;
}

export interface LintResult {
  readonly ok: boolean;
  readonly digest?: SpinnerDigest;
  readonly findings: readonly LintFinding[];
  readonly bundleStats: LintBundleStats;
}

const MIN_DOC_LENGTH = 200;

const KNOWN_SPDX_LICENSES = new Set([
  'Apache-2.0',
  'MIT',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BSD-4-Clause',
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'MPL-2.0',
  'ISC',
  'CC0-1.0',
  'Unlicense',
  'Foundation-Proprietary', // Webspinner Foundation private Spinners
]);

let cachedValidator: ReturnType<typeof buildValidator> | null = null;

function buildValidator() {
  // Ajv2020 ships with allErrors:false by default; we want all errors
  // for findings. Format validation (e.g. 'uri') is intentionally NOT
  // wired here — ajv-formats has CommonJS-interop friction with our
  // verbatimModuleSyntax. Where format checks matter we use `pattern`
  // (regex) directly on the schema property.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ajv = new (Ajv2020 as any)({ allErrors: true, strict: false });
  return ajv.compile(spinnerManifestSchema);
}

function validator() {
  if (cachedValidator === null) cachedValidator = buildValidator();
  return cachedValidator;
}

function ajvErrorToFinding(err: ErrorObject): LintFinding {
  const field = err.instancePath || undefined;
  return {
    severity: 'error',
    rule: 'manifest-schema',
    message: `${err.keyword}: ${err.message ?? 'unknown'}${err.params ? ' (' + JSON.stringify(err.params) + ')' : ''}`,
    ...(field !== undefined ? { field } : {}),
  };
}

function isSpinnerManifest(value: unknown): value is SpinnerManifest {
  return typeof value === 'object' && value !== null;
}

async function fileBytes(reader: BundleReader, path: string): Promise<Uint8Array | null> {
  return reader.readFile(path);
}

async function fileSize(reader: BundleReader, path: string): Promise<number> {
  const b = await reader.readFile(path);
  return b?.byteLength ?? 0;
}

function manifestDocPaths(manifest: SpinnerManifest): readonly string[] {
  const out: string[] = [manifest.documentation.howItWorks];
  if (manifest.documentation.readme !== undefined) out.push(manifest.documentation.readme);
  if (manifest.documentation.examples !== undefined) out.push(manifest.documentation.examples);
  if (manifest.documentation.additional !== undefined) {
    for (const a of manifest.documentation.additional) out.push(a.path);
  }
  return out;
}

/**
 * Lint a Spinner bundle. The manifest is taken as already-parsed input
 * so the caller (which has the raw bytes) can surface a parse error
 * cleanly without re-parsing inside this function.
 */
export async function lintSpinnerBundle(
  manifest: unknown,
  reader: BundleReader,
): Promise<LintResult> {
  const findings: LintFinding[] = [];

  // ── schema validation ────────────────────────────────────────────
  const validate = validator();
  if (!validate(manifest)) {
    for (const err of validate.errors ?? []) {
      findings.push(ajvErrorToFinding(err));
    }
    return {
      ok: false,
      findings,
      bundleStats: { capabilityCount: 0, declaredDocCount: 0, bundleSizeBytes: 0 },
    };
  }

  // Past the schema gate, we can safely narrow.
  if (!isSpinnerManifest(manifest)) {
    return {
      ok: false,
      findings: [
        {
          severity: 'error',
          rule: 'manifest-shape',
          message: 'manifest is not an object after schema validation (defensive)',
        },
      ],
      bundleStats: { capabilityCount: 0, declaredDocCount: 0, bundleSizeBytes: 0 },
    };
  }
  const m = manifest;

  // ── required files (digest is the canonical "all required present" check) ──
  let digest: SpinnerDigest | undefined;
  const digestResult = await computeBundleDigest(m, reader);
  if (!digestResult.ok) {
    findings.push({
      severity: 'error',
      rule: 'required-files',
      message: `digest could not be computed: ${digestResult.error.kind}${'path' in digestResult.error ? ` (${digestResult.error.path})` : ''}`,
    });
  } else {
    digest = digestResult.value.digest;
  }

  // ── documentation content ────────────────────────────────────────
  const howItWorksBytes = await fileBytes(reader, m.documentation.howItWorks);
  if (howItWorksBytes !== null && howItWorksBytes.byteLength < MIN_DOC_LENGTH) {
    findings.push({
      severity: 'warning',
      rule: 'doc-content',
      message: `how-it-works is ${howItWorksBytes.byteLength} bytes; the patron-facing bar is ≥${MIN_DOC_LENGTH} bytes`,
      field: '/documentation/howItWorks',
    });
  }
  const missionLockBytes = await fileBytes(reader, 'mission-lock.md');
  if (missionLockBytes !== null && missionLockBytes.byteLength < MIN_DOC_LENGTH) {
    findings.push({
      severity: 'warning',
      rule: 'doc-content',
      message: `mission-lock is ${missionLockBytes.byteLength} bytes; the operative contract should be substantive (≥${MIN_DOC_LENGTH} bytes)`,
    });
  }

  // ── capability schemas (warning when missing) ────────────────────
  for (let i = 0; i < m.capabilities.length; i++) {
    const cap = m.capabilities[i]!;
    if (cap.inputSchema === undefined) {
      findings.push({
        severity: 'warning',
        rule: 'capability-schema',
        message: `capability \`${cap.name}\` declares no inputSchema; runtime cannot enforce typed inputs`,
        field: `/capabilities/${i}/inputSchema`,
      });
    }
    if (cap.outputSchema === undefined) {
      findings.push({
        severity: 'warning',
        rule: 'capability-schema',
        message: `capability \`${cap.name}\` declares no outputSchema; runtime cannot enforce typed returns`,
        field: `/capabilities/${i}/outputSchema`,
      });
    }
  }

  // ── license sanity ──────────────────────────────────────────────
  if (!KNOWN_SPDX_LICENSES.has(m.license)) {
    findings.push({
      severity: 'warning',
      rule: 'license-recognized',
      message: `license \`${m.license}\` is not a recognized SPDX identifier or Foundation-Proprietary; pick from the canonical set when possible`,
      field: '/license',
    });
  }

  // ── bundle stats (info) ─────────────────────────────────────────
  let bundleSizeBytes = 0;
  bundleSizeBytes += howItWorksBytes?.byteLength ?? 0;
  bundleSizeBytes += missionLockBytes?.byteLength ?? 0;
  bundleSizeBytes += await fileSize(reader, m.thumbnail);
  bundleSizeBytes += await fileSize(reader, m.entrypoint);
  for (const path of manifestDocPaths(m)) {
    if (path === m.documentation.howItWorks) continue;
    bundleSizeBytes += await fileSize(reader, path);
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length;

  return {
    ok: errorCount === 0,
    ...(digest !== undefined ? { digest } : {}),
    findings,
    bundleStats: {
      capabilityCount: m.capabilities.length,
      declaredDocCount: manifestDocPaths(m).length,
      bundleSizeBytes,
    },
  };
}
