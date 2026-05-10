// Server-side Spinner loader for the Loom.
//
// Reads Spinner bundles from disk, computes integrity digests, and resolves
// documentation files for rendering. The full Weaver pipeline (vault
// resolution, WRAG retrieval, Anthropic invocation, audit emission) is
// not implemented here — this module is the read side of the Spinner
// surface for the bootstrap. See OPEN_QUESTIONS.md.

import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  IntegrityStatus,
  SpinnerDigest,
  SpinnerManifest,
} from '@webspinner-foundation/sdk';
import { formatSpinnerDigest } from '@webspinner-foundation/sdk';

const SPINNERS_DIR = resolve(
  process.env['WARP_SPINNERS_DIR'] ?? join(process.cwd(), '..', 'spinners'),
);

export interface LoadedSpinner {
  /** Slug name of the spinner directory under WARP_SPINNERS_DIR. */
  readonly slug: string;
  readonly manifest: SpinnerManifest;
  readonly bundleDir: string;
  readonly integrity: IntegrityStatus;
}

export type LoadError =
  | { readonly kind: 'not-found'; readonly slug: string }
  | { readonly kind: 'manifest-missing'; readonly slug: string }
  | { readonly kind: 'manifest-invalid'; readonly slug: string; readonly detail: string };

export type LoadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: LoadError };

/**
 * Canonicalise an object the way Spinner-bundle hashing expects:
 * sorted keys at every level, no insignificant whitespace, terminated
 * by a single LF. The exact spec is open work
 * (`OPEN_QUESTIONS.md` — *Spinner integrity — canonical bundle digest*);
 * this implementation is the bootstrap target.
 */
function canonicalJson(value: unknown): string {
  function sort(v: unknown): unknown {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(sort);
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = sort(obj[k]);
    return out;
  }
  return JSON.stringify(sort(value)) + '\n';
}

async function hashFile(absPath: string): Promise<string> {
  const buf = await readFile(absPath);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Compute the canonical digest of a Spinner bundle as-it-is-on-disk.
 * Order: canonical manifest, then each documentation file referenced by
 * the manifest hashed and prefixed with its relative path. The entrypoint
 * module's compiled bytes are NOT yet included — that lands when the
 * build pipeline does (open work).
 */
async function computeDigest(
  bundleDir: string,
  manifest: SpinnerManifest,
): Promise<SpinnerDigest> {
  const sha = createHash('sha256');
  sha.update(canonicalJson(manifest));

  const docFiles: string[] = [manifest.documentation.howItWorks, manifest.thumbnail];
  if (manifest.documentation.readme) docFiles.push(manifest.documentation.readme);
  if (manifest.documentation.examples) docFiles.push(manifest.documentation.examples);
  for (const extra of manifest.documentation.additional ?? []) {
    docFiles.push(extra.path);
  }

  for (const rel of docFiles) {
    const absPath = resolve(bundleDir, rel);
    try {
      const fileHash = await hashFile(absPath);
      sha.update(`${rel}:${fileHash}\n`);
    } catch {
      // Missing referenced file: hash the path with a sentinel so the digest
      // still differs from a bundle where the file is present. The Loom
      // surfaces this as a setup error elsewhere.
      sha.update(`${rel}:MISSING\n`);
    }
  }

  return formatSpinnerDigest('sha256', sha.digest('hex'));
}

/**
 * Resolve integrity status for a Spinner. With no install records yet
 * (Grimoire integration is open work), every Spinner reports
 * `pending-install` carrying its observed digest. Once the install
 * record lands, this function compares against it and returns `verified`,
 * `unsigned`, or `digest-mismatch`.
 */
async function resolveIntegrity(
  bundleDir: string,
  manifest: SpinnerManifest,
): Promise<IntegrityStatus> {
  const observed = await computeDigest(bundleDir, manifest);
  return { kind: 'pending-install', observedDigest: observed };
}

function validateManifest(raw: unknown): SpinnerManifest | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'manifest is not an object' };
  const m = raw as Record<string, unknown>;
  if (m['manifestVersion'] !== '1.0') {
    return { error: `unknown manifestVersion: ${JSON.stringify(m['manifestVersion'])}` };
  }
  if (typeof m['name'] !== 'string') return { error: 'name must be a string' };
  if (typeof m['displayName'] !== 'string') return { error: 'displayName must be a string' };
  if (typeof m['version'] !== 'string') return { error: 'version must be a string' };
  if (typeof m['description'] !== 'string') return { error: 'description must be a string' };
  if (typeof m['license'] !== 'string') return { error: 'license must be a string' };
  if (typeof m['entrypoint'] !== 'string') return { error: 'entrypoint must be a string' };
  if (typeof m['documentation'] !== 'object' || m['documentation'] === null) {
    return { error: 'documentation must be an object' };
  }
  const doc = m['documentation'] as Record<string, unknown>;
  if (typeof doc['howItWorks'] !== 'string') {
    return { error: 'documentation.howItWorks must be a string' };
  }
  if (typeof m['thumbnail'] !== 'string' || m['thumbnail'].length === 0) {
    return { error: 'thumbnail must be a non-empty string (relative path to SVG/raster)' };
  }
  if (!Array.isArray(m['capabilities'])) return { error: 'capabilities must be an array' };
  return raw as SpinnerManifest;
}

async function loadOne(slug: string): Promise<LoadResult<LoadedSpinner>> {
  const bundleDir = join(SPINNERS_DIR, slug);
  let info;
  try {
    info = await stat(bundleDir);
  } catch {
    return { ok: false, error: { kind: 'not-found', slug } };
  }
  if (!info.isDirectory()) return { ok: false, error: { kind: 'not-found', slug } };

  const manifestPath = join(bundleDir, 'manifest.json');
  let raw: unknown;
  try {
    const text = await readFile(manifestPath, 'utf8');
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: { kind: 'manifest-missing', slug } };
  }
  const validated = validateManifest(raw);
  if ('error' in validated) {
    return { ok: false, error: { kind: 'manifest-invalid', slug, detail: validated.error } };
  }
  const integrity = await resolveIntegrity(bundleDir, validated);
  return {
    ok: true,
    value: { slug, manifest: validated, bundleDir, integrity },
  };
}

export async function listSpinners(): Promise<readonly LoadedSpinner[]> {
  let entries: readonly string[];
  try {
    entries = await readdir(SPINNERS_DIR);
  } catch {
    return [];
  }
  const out: LoadedSpinner[] = [];
  for (const slug of entries) {
    if (slug.startsWith('.')) continue;
    const r = await loadOne(slug);
    if (r.ok) out.push(r.value);
  }
  out.sort((a, b) => a.manifest.displayName.localeCompare(b.manifest.displayName));
  return out;
}

export async function loadSpinner(slug: string): Promise<LoadResult<LoadedSpinner>> {
  return loadOne(slug);
}

export async function loadSpinnerDoc(
  bundleDir: string,
  relPath: string,
): Promise<string | undefined> {
  try {
    return await readFile(resolve(bundleDir, relPath), 'utf8');
  } catch {
    return undefined;
  }
}
