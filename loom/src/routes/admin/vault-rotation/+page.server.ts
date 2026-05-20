/**
 * /admin/vault-rotation
 *
 * Wizard-only admin surface for two things the bootstrap Cell needs
 * eyes on:
 *   1. Vault master-key rotation — one-click rotation of
 *      WARP_VAULT_MASTER_KEY across operator PB + all three plists.
 *      Backs up to ~/.warp-key-rotation/<ts>/ before any write.
 *   2. Storage path status — read-only view of HUB_STORAGE_DIR
 *      configuration (covers task #43; full configurability via UI is
 *      a future enhancement, today this is honest visibility).
 */

import { fail, type Actions } from '@sveltejs/kit';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { getVaultStatus, rotateVaultKey } from '$lib/server/vault-rotation.js';
import type { PageServerLoad } from './$types.js';

const HOME = homedir();
const DEFAULT_HUB_STORAGE = path.join(HOME, 'webspinner-hub', 'storage');

interface StorageStatus {
  readonly resolvedPath: string;
  readonly source: 'env' | 'default';
  readonly exists: boolean;
  readonly entryCount: number | null;
}

async function getStorageStatus(): Promise<StorageStatus> {
  const env = process.env['HUB_STORAGE_DIR'];
  const resolved = env || DEFAULT_HUB_STORAGE;
  let exists = false;
  let entryCount: number | null = null;
  try {
    const entries = await fs.readdir(resolved);
    exists = true;
    entryCount = entries.filter((e) => !e.startsWith('.')).length;
  } catch {
    /* dir missing — not fatal */
  }
  return {
    resolvedPath: resolved,
    source: env ? 'env' : 'default',
    exists,
    entryCount,
  };
}

export const load: PageServerLoad = async ({ fetch }) => {
  const [vault, storage] = await Promise.all([getVaultStatus(fetch), getStorageStatus()]);
  return { vault, storage };
};

export const actions: Actions = {
  rotate: async ({ fetch }) => {
    const result = await rotateVaultKey(fetch);
    if (!result.ok) {
      return fail(500, { result });
    }
    return { result };
  },
};
