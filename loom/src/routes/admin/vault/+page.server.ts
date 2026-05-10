import { fail } from '@sveltejs/kit';
import {
  addSecret,
  deleteSecret,
  ensureCollection,
  listSecrets,
  type SecretError,
} from '$lib/server/secrets.js';
import { getSession } from '$lib/server/session.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import type { Actions, PageServerLoad } from './$types.js';

function errorMessage(e: SecretError): string {
  switch (e.kind) {
    case 'duplicate-name':
      return 'A secret with that name already exists.';
    case 'invalid-name':
      return 'Name must be 1–64 chars: letters, digits, _, -, /, .';
    case 'auth':
      return 'Loom server identity rejected by PocketBase.';
    case 'backend':
      return `Backend error (${e.status}). See server logs.`;
  }
}

export const load: PageServerLoad = async ({ cookies, fetch }) => {
  if (!getSession(cookies)) return { secrets: [], setupError: 'Not authenticated.' };

  // Loom server identity does the PB op, not the user's session token.
  // The user's session is the auth gate (above); the Loom is the actor.
  const pbToken = await loomPbToken(fetch);
  if (!pbToken) {
    return { secrets: [], setupError: 'Loom server credentials missing (WARP_PB_EMAIL / WARP_PB_PASSWORD).' };
  }

  // Never throw — render the page with an inline error instead of a 500.
  try {
    const ensured = await ensureCollection(fetch, pbToken);
    if (!ensured.ok) {
      return { secrets: [], setupError: errorMessage(ensured.error) };
    }

    const list = await listSecrets(fetch, pbToken);
    if (!list.ok) {
      return { secrets: [], setupError: errorMessage(list.error) };
    }

    return { secrets: list.value };
  } catch (e) {
    return {
      secrets: [],
      setupError: `Vault unreachable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
};

export const actions: Actions = {
  add: async ({ request, cookies, fetch }) => {
    if (!getSession(cookies)) return fail(401, { action: 'add', error: 'Not authenticated.' });

    const masterKey = process.env['WARP_VAULT_MASTER_KEY'];
    if (!masterKey) {
      return fail(500, {
        action: 'add',
        error: 'Vault not configured: WARP_VAULT_MASTER_KEY env var missing.',
      });
    }

    const pbToken = await loomPbToken(fetch);
    if (!pbToken) {
      return fail(500, { action: 'add', error: 'Loom server credentials missing.' });
    }

    const data = await request.formData();
    const name = data.get('name')?.toString().trim() ?? '';
    const value = data.get('value')?.toString() ?? '';
    const description = data.get('description')?.toString().trim() ?? '';

    if (!name || !value) {
      return fail(400, { action: 'add', error: 'Name and value are both required.' });
    }

    const result = await addSecret(fetch, pbToken, masterKey, name, value, description);
    if (!result.ok) {
      return fail(result.error.kind === 'invalid-name' ? 400 : 500, {
        action: 'add',
        error: errorMessage(result.error),
      });
    }

    return { action: 'add', added: result.value.name };
  },

  delete: async ({ request, cookies, fetch }) => {
    if (!getSession(cookies)) return fail(401, { action: 'delete', error: 'Not authenticated.' });

    const pbToken = await loomPbToken(fetch);
    if (!pbToken) {
      return fail(500, { action: 'delete', error: 'Loom server credentials missing.' });
    }

    const data = await request.formData();
    const id = data.get('id')?.toString();
    const name = data.get('name')?.toString();
    if (!id) return fail(400, { action: 'delete', error: 'Missing id.' });

    const result = await deleteSecret(fetch, pbToken, id);
    if (!result.ok) {
      return fail(500, { action: 'delete', error: errorMessage(result.error) });
    }

    return { action: 'delete', deleted: name ?? id };
  },
};
