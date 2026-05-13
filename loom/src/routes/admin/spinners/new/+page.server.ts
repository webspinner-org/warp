import { fail, redirect, error } from '@sveltejs/kit';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { getSession } from '$lib/server/session.js';
import { refreshSuperuser, loomPbToken } from '$lib/server/pocketbase.js';
import { refreshUser } from '$lib/server/users.js';
import {
  listTemplates,
  scaffoldFromTemplate,
  type ScaffoldVariables,
} from '$lib/server/templates.js';
import { installSpinnerBundle } from '$lib/server/spinner-install-op.js';
import { getSkein, ensureSkeinCollection } from '$lib/server/skein.js';
import { getCellIdentity } from '$lib/server/identity.js';
import type { OperationActor } from '$lib/server/operations.js';
import type { Actions, PageServerLoad } from './$types.js';

const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const SCOPE_PATTERN = /^@[a-z0-9-]+$/;
const DEFAULT_SCOPE = '@local';

export const load: PageServerLoad = async ({ parent }) => {
  const layoutData = await parent();
  const templates = await listTemplates();
  return {
    user: layoutData.user,
    templates: templates.map((t) => ({
      name: t.name,
      displayName: t.displayName,
      description: t.description,
      version: t.version,
    })),
    defaults: {
      scope: DEFAULT_SCOPE,
    },
  };
};

interface FieldErrors {
  template?: string;
  slug?: string;
  displayName?: string;
  description?: string;
  scope?: string;
}

export const actions: Actions = {
  // Slug uniqueness check — invoked from the form's blur handler.
  // Returns the current state (available | taken) so the UI can mark
  // the field. Single-flight; not idempotent or audited.
  checkSlug: async ({ request, fetch }) => {
    const formData = await request.formData();
    const slug = String(formData.get('slug') ?? '').trim();
    if (!SLUG_PATTERN.test(slug)) {
      return { check: 'invalid' as const, slug };
    }
    const pbToken = await loomPbToken(fetch);
    if (!pbToken) return { check: 'unknown' as const, slug };
    const ensured = await ensureSkeinCollection(fetch, pbToken);
    if (!ensured.ok) return { check: 'unknown' as const, slug };
    const existing = await getSkein(fetch, pbToken, slug);
    if (!existing.ok) return { check: 'unknown' as const, slug };
    return { check: existing.row ? ('taken' as const) : ('available' as const), slug };
  },

  // The main authoring action: scaffold + install + redirect.
  author: async ({ request, fetch, cookies }) => {
    const session = getSession(cookies);
    if (!session) {
      throw error(401, 'Not authenticated.');
    }

    // Derive actor from session.
    let actorEmail: string;
    let actorId: string;
    let actorKind: OperationActor['kind'];
    if (session.collection === 'users') {
      const r = await refreshUser(fetch, session.token);
      if (!r.ok) throw error(401, 'Session expired.');
      actorEmail = r.value.record.email;
      actorId = r.value.record.id;
      actorKind = 'webspinner';
    } else {
      const r = await refreshSuperuser(fetch, session.token);
      if (!r.ok) throw error(401, 'Session expired.');
      actorEmail = r.auth.record.email;
      actorId = r.auth.record.id;
      actorKind = 'wizard';
    }

    const formData = await request.formData();
    const templateName = String(formData.get('template') ?? '').trim();
    const slugRaw = String(formData.get('slug') ?? '').trim();
    const displayNameRaw = String(formData.get('displayName') ?? '').trim();
    const descriptionRaw = String(formData.get('description') ?? '').trim();
    const scopeRaw = String(formData.get('scope') ?? DEFAULT_SCOPE).trim();

    // ── Field-level validation ────────────────────────────────────
    const errors: FieldErrors = {};
    if (!templateName) {
      errors.template = 'Pick a template.';
    } else {
      const available = await listTemplates();
      if (!available.some((t) => t.name === templateName)) {
        errors.template = `Template "${templateName}" not found.`;
      }
    }
    if (!slugRaw) {
      errors.slug = 'Slug is required.';
    } else if (!SLUG_PATTERN.test(slugRaw)) {
      errors.slug =
        'Slug must start with a lowercase letter and contain only lowercase letters, digits, and hyphens (max 63 chars).';
    }
    if (!displayNameRaw) {
      errors.displayName = 'Display name is required.';
    } else if (displayNameRaw.length > 64) {
      errors.displayName = 'Display name must be 64 characters or fewer.';
    }
    if (!descriptionRaw) {
      errors.description = 'Description is required.';
    } else if (descriptionRaw.length > 2048) {
      errors.description = 'Description must be 2048 characters or fewer.';
    }
    if (!SCOPE_PATTERN.test(scopeRaw)) {
      errors.scope =
        'Scope must start with @ and contain only lowercase letters, digits, and hyphens.';
    }
    if (Object.keys(errors).length > 0) {
      return fail(400, {
        errors,
        fields: {
          template: templateName,
          slug: slugRaw,
          displayName: displayNameRaw,
          description: descriptionRaw,
          scope: scopeRaw,
        },
      });
    }

    // ── Slug uniqueness against wp_skein ──────────────────────────
    const pbToken = await loomPbToken(fetch);
    if (!pbToken) {
      return fail(500, {
        topLevelError: {
          kind: 'no-pb-token',
          detail: 'PocketBase superuser credentials missing on the Loom; cannot reach the Skein.',
        },
      });
    }
    await ensureSkeinCollection(fetch, pbToken);
    const existing = await getSkein(fetch, pbToken, slugRaw);
    if (!existing.ok) {
      return fail(500, {
        topLevelError: {
          kind: 'skein-read-failed',
          detail: `Failed to read wp_skein (HTTP ${existing.status}).`,
        },
      });
    }
    if (existing.row) {
      const slugInUse: FieldErrors = {
        slug: `Slug "${slugRaw}" is already installed in this Cell.`,
      };
      return fail(400, {
        errors: slugInUse,
        fields: {
          template: templateName,
          slug: slugRaw,
          displayName: displayNameRaw,
          description: descriptionRaw,
          scope: scopeRaw,
        },
      });
    }

    // ── Cell identity for cellFingerprint ─────────────────────────
    let cellFingerprint = 'unknown';
    try {
      const id = await getCellIdentity(fetch, pbToken);
      if (id) cellFingerprint = id.fingerprint;
    } catch {
      // identity will get provisioned during install if missing
    }

    // ── Scaffold ──────────────────────────────────────────────────
    const destDir = resolve(homedir(), `Cells/spinners/${slugRaw}`);
    const vars: ScaffoldVariables = {
      slug: slugRaw,
      name: `${scopeRaw}/${slugRaw}`,
      displayName: displayNameRaw,
      description: descriptionRaw,
      authorEmail: actorEmail,
      cellFingerprint,
      createdAt: new Date().toISOString(),
    };
    const scaffold = await scaffoldFromTemplate({
      templateName,
      destDir,
      vars,
    });
    if (!scaffold.ok) {
      return fail(400, {
        topLevelError: {
          kind: scaffold.error.kind,
          detail: 'detail' in scaffold.error ? scaffold.error.detail : '',
        },
        fields: {
          template: templateName,
          slug: slugRaw,
          displayName: displayNameRaw,
          description: descriptionRaw,
          scope: scopeRaw,
        },
      });
    }

    // ── Install ───────────────────────────────────────────────────
    const masterKey = process.env['WARP_VAULT_MASTER_KEY'];
    if (!masterKey) {
      // Clean up the scaffolded directory — can't recover.
      try {
        const { rm } = await import('node:fs/promises');
        await rm(destDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
      return fail(500, {
        topLevelError: {
          kind: 'no-master-key',
          detail: 'WARP_VAULT_MASTER_KEY missing on the Loom; cannot sign.',
        },
      });
    }

    const installResult = await installSpinnerBundle({
      bundlePath: destDir,
      actor: { kind: actorKind, id: actorId, email: actorEmail },
      fetch,
      pbToken: session.token,
      masterKey,
    });
    if (!installResult.ok) {
      // Roll back the scaffolded directory — keeps disk + wp_skein in sync.
      try {
        const { rm } = await import('node:fs/promises');
        await rm(destDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
      return fail(500, {
        topLevelError: {
          kind: installResult.error.kind,
          detail: 'detail' in installResult.error ? installResult.error.detail : '',
        },
        fields: {
          template: templateName,
          slug: slugRaw,
          displayName: displayNameRaw,
          description: descriptionRaw,
          scope: scopeRaw,
        },
      });
    }

    // Success — redirect to the new Spinner's detail page.
    throw redirect(303, `/admin/spinners/${slugRaw}`);
  },
};
