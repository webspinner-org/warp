import { error } from '@sveltejs/kit';
import { loadSpinner, loadSpinnerDoc } from '$lib/server/spinners.js';
import { renderMarkdown } from '$lib/server/markdown.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import { getSession } from '$lib/server/session.js';
import { readSilkPattern, ensureSilkPatternCollection } from '$lib/server/silk-pattern.js';
import { spoolDisplayName } from '$lib/server/spools.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, cookies, fetch, parent }) => {
  const session = getSession(cookies);
  if (!session) throw error(401, 'Not authenticated.');

  // Inherit the user record from the admin layout.
  const layoutData = await parent();

  const result = await loadSpinner(params.name);
  if (!result.ok) {
    if (result.error.kind === 'not-found') {
      throw error(404, `No Spinner named "${params.name}" is registered.`);
    }
    if (result.error.kind === 'manifest-missing') {
      throw error(500, `Spinner "${params.name}" has no manifest.json on disk.`);
    }
    throw error(500, `Spinner "${params.name}" manifest invalid: ${result.error.detail}`);
  }

  const { manifest, bundleDir, integrity } = result.value;
  const howItWorksRaw = await loadSpinnerDoc(bundleDir, manifest.documentation.howItWorks);
  const readmeRaw = manifest.documentation.readme
    ? await loadSpinnerDoc(bundleDir, manifest.documentation.readme)
    : undefined;
  const missionLockRaw = await loadSpinnerDoc(bundleDir, 'mission-lock.md');

  // Silk Pattern read uses the Loom server's own PB identity, not the
  // user's session. Best-effort — empty placard on backend hiccup.
  let silkPattern = null;
  try {
    const pbToken = await loomPbToken(fetch);
    if (pbToken) {
      await ensureSilkPatternCollection(fetch, pbToken);
      silkPattern = await readSilkPattern(fetch, pbToken, manifest.name);
    }
  } catch {
    silkPattern = null;
  }

  const spoolDisplay = manifest.spools.map((ref) => ({
    name: ref.name,
    spool: ref.spool,
    spoolDisplayName: spoolDisplayName(ref.spool) ?? '(unknown)',
    required: ref.required,
  }));

  return {
    slug: result.value.slug,
    manifest,
    integrity,
    spoolDisplay,
    silkPattern,
    docs: {
      howItWorksHtml: howItWorksRaw ? renderMarkdown(howItWorksRaw) : undefined,
      readmeHtml: readmeRaw ? renderMarkdown(readmeRaw) : undefined,
      missionLockHtml: missionLockRaw ? renderMarkdown(missionLockRaw) : undefined,
    },
    actor: {
      email: layoutData.user.email,
      id: layoutData.user.id,
    },
  };
};
