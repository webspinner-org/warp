/**
 * Catch-all for any non-root path under the hub. Drives tree
 * navigation; segments are slug-joined.
 *
 *   /try-webspinner-projects
 *   /try-webspinner-projects/webbase-apps
 *   /try-webspinner-projects/webbase-apps/<sessionId>
 *
 * The project leaf renders project detail (status, source, resume
 * URL); everything else lists children.
 */

import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';
import {
  getProjectMeta,
  getPublishedWebbaseMeta,
  listTreeAt,
  readProjectSource,
  type ProjectMeta,
  type ProjectSource,
  type PublishedWebbaseMeta,
  type TreeNode,
} from '$lib/server/hub-storage.js';

interface FolderResult {
  readonly kind: 'folder';
  readonly segments: readonly string[];
  readonly breadcrumbs: readonly { slug: string; displayName: string; href: string }[];
  readonly children: readonly TreeNode[];
}

interface ProjectResult {
  readonly kind: 'project';
  readonly segments: readonly string[];
  readonly breadcrumbs: readonly { slug: string; displayName: string; href: string }[];
  readonly meta: ProjectMeta;
  readonly source: ProjectSource | null;
}

interface PublishedResult {
  readonly kind: 'published-webbase';
  readonly segments: readonly string[];
  readonly breadcrumbs: readonly { slug: string; displayName: string; href: string }[];
  readonly meta: PublishedWebbaseMeta;
}

export type CatchAllData =
  | { user: App.Locals['user']; authed: boolean; result: FolderResult }
  | { user: App.Locals['user']; authed: boolean; result: ProjectResult }
  | { user: App.Locals['user']; authed: boolean; result: PublishedResult };

const DISPLAY_NAMES: Record<string, string> = {
  'try-webspinner-projects': 'Try Webspinner Projects',
  'published-work': 'Published Work',
  'webbase-app': 'Webbase App',
};

function breadcrumbsFor(
  segments: readonly string[],
  leafDisplay?: string,
): { slug: string; displayName: string; href: string }[] {
  const out = [{ slug: '/', displayName: '/', href: '/' }];
  let href = '';
  segments.forEach((s, i) => {
    href += '/' + s;
    const isLast = i === segments.length - 1;
    const display = isLast && leafDisplay ? leafDisplay : (DISPLAY_NAMES[s] ?? s);
    out.push({ slug: s, displayName: display, href });
  });
  return out;
}

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(302, '/');
  const pathParam = (params.path ?? '').replace(/^\/+|\/+$/g, '');
  const segments = pathParam.length > 0 ? pathParam.split('/') : [];

  if (
    segments.length === 3 &&
    segments[0] === 'try-webspinner-projects' &&
    segments[1] === 'webbase-app'
  ) {
    const meta = await getProjectMeta(segments[2]!);
    if (!meta) throw error(404, 'Project not found in the hub.');
    const source = await readProjectSource(segments[2]!);
    return {
      user: locals.user,
      authed: true,
      result: {
        kind: 'project' as const,
        segments,
        breadcrumbs: breadcrumbsFor(segments, meta.appName),
        meta,
        source,
      },
    };
  }

  if (segments.length === 3 && segments[0] === 'published-work' && segments[1] === 'webbase-app') {
    const meta = await getPublishedWebbaseMeta(segments[2]!);
    if (!meta) throw error(404, 'Published Webbase not found in the hub.');
    return {
      user: locals.user,
      authed: true,
      result: {
        kind: 'published-webbase' as const,
        segments,
        breadcrumbs: breadcrumbsFor(segments, meta.appName || segments[2]!),
        meta,
      },
    };
  }

  const children = await listTreeAt(segments);
  return {
    user: locals.user,
    authed: true,
    result: {
      kind: 'folder' as const,
      segments,
      breadcrumbs: breadcrumbsFor(segments),
      children,
    },
  };
};
