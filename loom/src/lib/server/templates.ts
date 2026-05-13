/**
 * Template registry + scaffolding helper. Templates live at
 * `~/warp/templates/<template-name>/` (override via
 * `WARP_TEMPLATES_DIR`). Each template is a directory of Spinner-
 * bundle files with `{{placeholder}}` substitution, plus a
 * `meta.json` that describes the template to the authoring UI.
 *
 * The Webspinner picks a template from the form, fills in
 * slug/name/description, clicks Save. The form's action calls
 * `scaffoldFromTemplate` to copy the template into
 * `~/Cells/spinners/<slug>/`, then hands the new bundle to
 * `installSpinnerBundle` for the lint→sign→register pipeline.
 */

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { homedir } from 'node:os';

export interface ScaffoldVariables {
  readonly slug: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly authorEmail: string;
  readonly cellFingerprint: string;
  readonly createdAt: string;
}

export interface TemplateMeta {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly version: string;
}

export type ScaffoldError =
  | { readonly kind: 'template-not-found'; readonly name: string }
  | { readonly kind: 'dest-already-exists'; readonly path: string }
  | { readonly kind: 'fs-error'; readonly detail: string };

export type ScaffoldResult =
  | { readonly ok: true; readonly filesWritten: readonly string[] }
  | { readonly ok: false; readonly error: ScaffoldError };

function templatesRoot(): string {
  return process.env['WARP_TEMPLATES_DIR'] ?? join(homedir(), 'warp/templates');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readMeta(templateDir: string): Promise<TemplateMeta | null> {
  try {
    const raw = await readFile(join(templateDir, 'meta.json'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed['name'] !== 'string' ||
      typeof parsed['displayName'] !== 'string' ||
      typeof parsed['description'] !== 'string' ||
      typeof parsed['version'] !== 'string'
    ) {
      return null;
    }
    return {
      name: parsed['name'],
      displayName: parsed['displayName'],
      description: parsed['description'],
      version: parsed['version'],
    };
  } catch {
    return null;
  }
}

export async function listTemplates(): Promise<readonly TemplateMeta[]> {
  const root = templatesRoot();
  if (!(await pathExists(root))) return [];
  let entries: readonly string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const metas: TemplateMeta[] = [];
  for (const entry of entries) {
    const dir = join(root, entry);
    try {
      if (!(await stat(dir)).isDirectory()) continue;
    } catch {
      continue;
    }
    const meta = await readMeta(dir);
    if (meta) metas.push(meta);
  }
  metas.sort((a, b) => a.name.localeCompare(b.name));
  return metas;
}

export async function getTemplate(name: string): Promise<TemplateMeta | null> {
  // Defensive: refuse names with path separators so callers can't
  // escape the templates root via `../`.
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    return null;
  }
  const dir = join(templatesRoot(), name);
  if (!(await pathExists(dir))) return null;
  return readMeta(dir);
}

async function walkDirectory(rootDir: string): Promise<readonly string[]> {
  // Returns relative paths to every file under rootDir.
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        out.push(relative(rootDir, full));
      }
    }
  }
  await walk(rootDir);
  return out;
}

function substitute(content: string, vars: ScaffoldVariables): string {
  // Simple `{{key}}` substitution. Plain string replace; no escaping
  // logic for the values (the form is responsible for sanitizing
  // user input before it reaches here).
  let out = content;
  out = out.replaceAll('{{slug}}', vars.slug);
  out = out.replaceAll('{{name}}', vars.name);
  out = out.replaceAll('{{displayName}}', vars.displayName);
  out = out.replaceAll('{{description}}', vars.description);
  out = out.replaceAll('{{authorEmail}}', vars.authorEmail);
  out = out.replaceAll('{{cellFingerprint}}', vars.cellFingerprint);
  out = out.replaceAll('{{createdAt}}', vars.createdAt);
  return out;
}

export async function scaffoldFromTemplate(opts: {
  readonly templateName: string;
  readonly destDir: string;
  readonly vars: ScaffoldVariables;
}): Promise<ScaffoldResult> {
  // Validate template exists.
  const meta = await getTemplate(opts.templateName);
  if (!meta) {
    return { ok: false, error: { kind: 'template-not-found', name: opts.templateName } };
  }

  const templateDir = join(templatesRoot(), opts.templateName);

  // Refuse to overwrite.
  if (await pathExists(opts.destDir)) {
    return { ok: false, error: { kind: 'dest-already-exists', path: opts.destDir } };
  }

  try {
    await mkdir(opts.destDir, { recursive: true });
    const files = await walkDirectory(templateDir);
    const filesWritten: string[] = [];
    for (const rel of files) {
      // meta.json is template metadata — NOT copied to the scaffolded bundle.
      if (rel === 'meta.json') continue;

      const sourcePath = join(templateDir, rel);
      const destPath = join(opts.destDir, rel);

      const raw = await readFile(sourcePath, 'utf8');
      const rendered = substitute(raw, opts.vars);

      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, rendered, 'utf8');
      filesWritten.push(rel);
    }
    filesWritten.sort();
    return { ok: true, filesWritten };
  } catch (e) {
    return {
      ok: false,
      error: { kind: 'fs-error', detail: (e as Error).message },
    };
  }
}

/**
 * Default placeholder thumbnail bytes if the template doesn't ship
 * its own. (Kept inline so the scaffold helper is single-file. The
 * hello-spinner template ships its own thumbnail, so this is unused
 * today; future barebones templates can omit a thumbnail and we'll
 * fall back here.)
 */
export const DEFAULT_THUMBNAIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" fill="#0a0a0a"/>
  <circle cx="32" cy="32" r="20" fill="none" stroke="#c9a96a" stroke-width="2"/>
</svg>
`;
