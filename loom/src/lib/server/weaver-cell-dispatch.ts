/**
 * Weaver dispatch for Cell-authored Spinners — the fall-through path
 * when a Spinner's slug is not in the hard-coded Genesis DISPATCH map.
 *
 * Approach: dynamic `import()` of the manifest's `entrypoint`. Node
 * ≥ 23.6 supports `import()` of `.ts` files natively (strip-types is
 * default-enabled). The Loom's `engines.node` is `>=24`, so this is
 * supported in production. Capability handlers are resolved from the
 * imported module — `module.default[capability]` first, then
 * `module[capability]` — and called with the input. Audit + Silk
 * Pattern wrapping is performed by the caller in `weaver.ts`.
 *
 * Constraints (called out in DECISIONS.md):
 *   - No external imports in the Spinner's entrypoint until
 *     ~/Cells/spinners/* is added to the pnpm workspace OR install
 *     runs pnpm install in the bundle directory.
 *   - In-process execution; no isolation per RUNNERS.md. Future
 *     work to dispatch via Firecracker microVMs.
 *   - Node strip-types limits: no const enums, no parameter
 *     properties, no namespaces, no decorators. All already banned
 *     by the base tsconfig.
 */

import { readFile } from 'node:fs/promises';
import { resolve, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import type { SpinnerManifest } from '@webspinner-foundation/sdk';

/**
 * The production importer. Uses `new Function` so the bundler
 * (Vite/vitest) can't see the `import()` and try to pre-resolve the
 * URL through its own module graph. Node ≥ 23.6 strip-types is
 * default-enabled, so this loads `.ts` files natively.
 */
export const nativeDynamicImporter: DynamicImporter = new Function(
  'url',
  'return import(url)',
) as DynamicImporter;

export interface CellDispatchInput {
  readonly bundlePath: string;
  readonly capability: string;
  readonly input: unknown;
  /**
   * Optional dynamic-import override. Production uses the native
   * Node `import()` (default). Tests inject a synthetic importer
   * because vitest's vmContext sandbox blocks runtime dynamic
   * imports of arbitrary filesystem paths.
   */
  readonly importer?: DynamicImporter;
}

export type DynamicImporter = (url: string) => Promise<Record<string, unknown>>;

export type CellDispatchError =
  | { readonly kind: 'manifest-missing' }
  | { readonly kind: 'manifest-invalid'; readonly detail: string }
  | { readonly kind: 'capability-unknown'; readonly capability: string }
  | { readonly kind: 'entrypoint-not-found'; readonly path: string }
  | { readonly kind: 'entrypoint-import-failed'; readonly detail: string }
  | { readonly kind: 'capability-not-exported'; readonly capability: string }
  | { readonly kind: 'handler-threw'; readonly detail: string };

export interface CellDispatchOutput {
  readonly output: unknown;
  readonly durationMs: number;
}

export type CellDispatchResult =
  | { readonly ok: true; readonly value: CellDispatchOutput }
  | { readonly ok: false; readonly error: CellDispatchError };

function resolveEntrypoint(bundlePath: string, entrypoint: string): string {
  const cleaned = entrypoint.replace(/^\.\//, '');
  if (isAbsolute(cleaned)) return cleaned;
  return resolve(bundlePath, cleaned);
}

/**
 * Dispatch a capability against a Cell-authored Spinner. Loads the
 * manifest, validates the capability is declared, dynamically imports
 * the entrypoint, finds the handler, and calls it with the input.
 * Returns the raw handler output plus the dispatch duration; the
 * caller wraps audit + Silk Pattern.
 */
export async function dispatchCellAuthored(input: CellDispatchInput): Promise<CellDispatchResult> {
  // 1. Read manifest.
  let manifest: SpinnerManifest;
  try {
    const raw = await readFile(join(input.bundlePath, 'manifest.json'), 'utf8');
    manifest = JSON.parse(raw) as SpinnerManifest;
  } catch (e) {
    const detail =
      (e as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'manifest.json not found'
        : (e as Error).message;
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, error: { kind: 'manifest-missing' } };
    }
    return { ok: false, error: { kind: 'manifest-invalid', detail } };
  }

  // 2. Validate capability is declared.
  const declared = manifest.capabilities.find((c) => c.name === input.capability);
  if (!declared) {
    return {
      ok: false,
      error: { kind: 'capability-unknown', capability: input.capability },
    };
  }

  // 3. Resolve + import entrypoint.
  const entrypointPath = resolveEntrypoint(input.bundlePath, manifest.entrypoint);

  try {
    await readFile(entrypointPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, error: { kind: 'entrypoint-not-found', path: entrypointPath } };
    }
    return { ok: false, error: { kind: 'entrypoint-import-failed', detail: (e as Error).message } };
  }

  // Module cache: Node caches dynamic imports by URL. Subsequent
  // invocations of the same Spinner hit the cache and avoid re-parse.
  // This means edits to a Spinner's entrypoint won't take effect until
  // the Loom restarts — documented limitation.
  //
  // The Function-constructor wrapper around `import()` is deliberate:
  // it bypasses bundler / test-runner static analysis (Vite tries to
  // resolve filesystem paths through its own module graph otherwise,
  // which fails for paths outside the workspace — e.g., tmpdir test
  // scaffolds). The wrapped `import()` is the runtime ESM import the
  // host Node provides — which on Node ≥ 23.6 strips types from .ts
  // sources natively.
  //
  // Tests inject `input.importer` to bypass this entirely: vitest's
  // vmContext sandbox refuses Function-constructor + native dynamic
  // import combinations, so the production importer can't run under
  // vitest. The synthetic importer in tests returns a predetermined
  // module shape.
  const importer = input.importer ?? nativeDynamicImporter;

  let mod: Record<string, unknown>;
  try {
    const fileUrl = pathToFileURL(entrypointPath).href;
    mod = await importer(fileUrl);
  } catch (e) {
    return {
      ok: false,
      error: { kind: 'entrypoint-import-failed', detail: (e as Error).message },
    };
  }

  // 4. Find the handler.
  //    Try `module.default[capability]` first (matches the
  //    hello-spinner template's `export default { greet }` pattern);
  //    fall back to `module[capability]` for top-level exports.
  const fromDefault = (mod['default'] as Record<string, unknown> | undefined)?.[input.capability];
  const fromTopLevel = mod[input.capability];
  const handler =
    typeof fromDefault === 'function'
      ? fromDefault
      : typeof fromTopLevel === 'function'
        ? fromTopLevel
        : null;
  if (handler === null) {
    return {
      ok: false,
      error: { kind: 'capability-not-exported', capability: input.capability },
    };
  }

  // 5. Call the handler. Time it.
  const t0 = performance.now();
  let output: unknown;
  try {
    const fn = handler as (i: unknown) => unknown | Promise<unknown>;
    output = await fn(input.input);
  } catch (e) {
    const stack =
      e instanceof Error && e.stack ? e.stack.split('\n').slice(0, 8).join('\n') : String(e);
    return { ok: false, error: { kind: 'handler-threw', detail: stack } };
  }
  const durationMs = performance.now() - t0;

  return { ok: true, value: { output, durationMs } };
}
