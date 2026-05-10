import { listSpinners } from '$lib/server/spinners.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async () => {
  const spinners = await listSpinners();
  return {
    spinners: spinners.map((s) => ({
      slug: s.slug,
      name: s.manifest.name,
      displayName: s.manifest.displayName,
      version: s.manifest.version,
      description: s.manifest.description,
      capabilityCount: s.manifest.capabilities.length,
      threadable: s.manifest.threadable,
      integrity: s.integrity,
    })),
  };
};
