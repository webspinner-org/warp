import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSpinner } from '$lib/server/spinners.js';
import type { RequestHandler } from './$types.js';

const TYPE_BY_EXT: Readonly<Record<string, string>> = {
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.avif': 'image/avif',
};

function contentTypeFor(path: string): string {
  for (const ext in TYPE_BY_EXT) {
    if (path.toLowerCase().endsWith(ext)) return TYPE_BY_EXT[ext];
  }
  return 'application/octet-stream';
}

export const GET: RequestHandler = async ({ params, setHeaders }) => {
  const result = await loadSpinner(params.name);
  if (!result.ok) {
    if (result.error.kind === 'not-found') {
      throw error(404, `No Spinner "${params.name}".`);
    }
    throw error(500, `Spinner "${params.name}" cannot be loaded.`);
  }

  const { manifest, bundleDir } = result.value;
  const absPath = resolve(bundleDir, manifest.thumbnail);
  let buf: Buffer;
  try {
    buf = await readFile(absPath);
  } catch {
    throw error(404, `Spinner "${params.name}" thumbnail (${manifest.thumbnail}) not on disk.`);
  }

  setHeaders({
    'content-type': contentTypeFor(manifest.thumbnail),
    'cache-control': 'public, max-age=300, must-revalidate',
  });
  return new Response(new Uint8Array(buf));
};
