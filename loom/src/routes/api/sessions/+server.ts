/**
 * GET /api/sessions
 *
 * Returns ALL the work that belongs to the authed patron — for the
 * try.webspinner.ai picker, which is the patron's entire surface
 * (hub is a Wizard-only admin tool; patrons live in try). One row
 * per artifact, the patron picks what to act on.
 *
 * Three kinds in the response, distinguishable by `kind`:
 *   - 'built'       — wp_database_applications: schema + screens, can
 *                     be resumed for editing or published
 *   - 'in-progress' — wp_spinner_sessions in propose/refine/ready,
 *                     can be resumed to complete the build
 *   - 'published'   — wp_app_packages: signed bundle behind a stable
 *                     short_code URL, can be opened, shared, deleted
 *
 * The bridge for built+in-progress is `session_id`; for published it's
 * `sender_email`. Both filter on the patron's identity (warp_hub
 * cookie). Anonymous rows are intentionally not returned.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getHubSession } from '$lib/server/hub-session.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import { listPackagesBySender } from '$lib/server/wsap-registry.js';
import { countDownloadsByShortCode } from '$lib/server/app-downloads.js';

const PB_URL = process.env['WARP_PB_URL'] ?? 'http://localhost:8090';

interface PBSpinnerSessionRow {
  readonly id: string;
  readonly spinner_id: string;
  readonly session_id: string;
  readonly actor_email?: string;
  readonly phase: string;
  readonly state: Record<string, unknown> | null;
  readonly status: string;
  readonly updated_at: string;
}

interface PBDatabaseApplicationRow {
  readonly id: string;
  readonly session_id: string;
  readonly domain: string;
  readonly schema_draft: { appName?: string } | null;
  readonly built_at: string;
  readonly status: string;
  readonly updated: string;
}

interface PickerEntry {
  readonly sessionId: string | null;
  readonly appName: string;
  readonly domain: string | null;
  readonly kind: 'built' | 'in-progress' | 'published';
  readonly status: string;
  readonly updatedAt: string;
  readonly builtAt: string | null;
  // Populated only when kind === 'published'.
  readonly shortCode?: string;
  readonly installToken?: string;
  readonly version?: number;
  readonly openUrl?: string;
  readonly downloadUrl?: string;
  readonly hasPassphrase?: boolean;
  readonly installCount?: number;
  readonly maxInstalls?: number;
  readonly downloadCount?: number;
  readonly expiresAt?: string;
}

interface AccountStatus {
  readonly publishedCount: number;
  readonly totalInstalls: number;
  readonly totalDownloads: number;
  readonly threshold: number;
  readonly aboveThreshold: boolean;
}

function pickInProgressAppName(row: PBSpinnerSessionRow): {
  appName: string;
  domain: string | null;
} {
  const state = row.state;
  if (!state) return { appName: '(untitled)', domain: null };
  const screensDraft = (state['screensDraft'] ?? null) as { appName?: unknown } | null;
  const fromScreens =
    screensDraft && typeof screensDraft === 'object' && typeof screensDraft.appName === 'string'
      ? screensDraft.appName
      : null;
  const domain = typeof state['domain'] === 'string' ? (state['domain'] as string) : null;
  return { appName: fromScreens || domain || '(untitled)', domain };
}

export const GET: RequestHandler = async ({ cookies, fetch: f }) => {
  const hub = getHubSession(cookies);
  if (!hub) return json({ authed: false, sessions: [] });

  const token = await loomPbToken(f);
  if (!token) return json({ authed: true, email: hub.email, sessions: [], reason: 'pb-auth' });

  // 1. The patron's spinner sessions. This filter is the *trust* point —
  //    only rows tagged with the patron's email are visible to them.
  const sessionFilter = encodeURIComponent(
    `actor_email = ${JSON.stringify(hub.email)} && status != "aborted"`,
  );
  const sessionsUrl = `${PB_URL}/api/collections/wp_spinner_sessions/records?perPage=200&sort=-updated_at&filter=${sessionFilter}`;
  const sessionsRes = await f(sessionsUrl, { headers: { Authorization: token } });
  if (!sessionsRes.ok) {
    return json({
      authed: true,
      email: hub.email,
      sessions: [],
      reason: `pb-sessions-${sessionsRes.status}`,
    });
  }
  const sessionsBody = (await sessionsRes.json()) as { items?: readonly PBSpinnerSessionRow[] };
  const spinnerSessions = sessionsBody.items ?? [];

  // 2. Built apps backing those sessions. Single filter with `||` OR
  //    matches PocketBase's filter dialect; cheaper than N round-trips.
  const builtBySessionId = new Map<string, PBDatabaseApplicationRow>();
  if (spinnerSessions.length > 0) {
    const orClauses = spinnerSessions
      .map((s) => `session_id = ${JSON.stringify(s.session_id)}`)
      .join(' || ');
    const appsUrl = `${PB_URL}/api/collections/wp_database_applications/records?perPage=200&filter=${encodeURIComponent(orClauses)}`;
    const appsRes = await f(appsUrl, { headers: { Authorization: token } });
    if (appsRes.ok) {
      const appsBody = (await appsRes.json()) as { items?: readonly PBDatabaseApplicationRow[] };
      for (const row of appsBody.items ?? []) {
        builtBySessionId.set(row.session_id, row);
      }
    }
    // Soft-fail on app lookup — patron still sees in-progress entries.
  }

  // 3. Merge. Each spinner session becomes one entry. The rich
  //    patron-blessed appName lives in wp_spinner_sessions.state.
  //    screensDraft.appName — that's what hub shows in its catalog,
  //    and that's the canonical display name. Fall back to the built
  //    app's derived schema name (often lowercased) and then domain.
  const entries: PickerEntry[] = spinnerSessions.map((s) => {
    const { appName: sessionAppName, domain: sessionDomain } = pickInProgressAppName(s);
    const built = builtBySessionId.get(s.session_id);
    if (built) {
      const richName =
        (sessionAppName && sessionAppName !== '(untitled)' ? sessionAppName : null) ||
        built.schema_draft?.appName ||
        built.domain ||
        '(untitled)';
      return {
        sessionId: s.session_id,
        appName: richName,
        domain: built.domain ?? sessionDomain ?? null,
        kind: 'built',
        status: 'built',
        updatedAt: built.updated || s.updated_at,
        builtAt: built.built_at,
      };
    }
    return {
      sessionId: s.session_id,
      appName: sessionAppName,
      domain: sessionDomain,
      kind: 'in-progress',
      status: s.phase || s.status,
      updatedAt: s.updated_at,
      builtAt: null,
    };
  });

  // 4. Published Webbases authored by this patron — wp_app_packages.
  //    Each row is one version; the patron may have several. Open URL
  //    is the stable short_code path served by the demo Loom.
  const published = await listPackagesBySender({
    senderEmail: hub.email,
    fetchFn: f,
    token,
  });
  let totalInstalls = 0;
  let totalDownloads = 0;
  if (published.ok) {
    const origin = process.env['WARP_PUBLIC_ORIGIN'] ?? 'https://app.webspinner.ai';
    const codes = published.items.map((p) => p.shortCode);
    const downloadCounts = await countDownloadsByShortCode(f, token, codes);
    for (const pkg of published.items) {
      const appName =
        (pkg.appName && pkg.appName.trim().length > 0 ? pkg.appName : null) ||
        (pkg.domain && pkg.domain.trim().length > 0 ? pkg.domain : null) ||
        (pkg.patronSentence && pkg.patronSentence.length > 0
          ? pkg.patronSentence.slice(0, 60)
          : null) ||
        '(untitled)';
      const dlCount = downloadCounts[pkg.shortCode] ?? 0;
      totalInstalls += pkg.installCount ?? 0;
      totalDownloads += dlCount;
      entries.push({
        sessionId: null,
        appName,
        domain: pkg.domain || null,
        kind: 'published',
        status: 'published',
        updatedAt: pkg.updatedAt,
        builtAt: null,
        shortCode: pkg.shortCode,
        installToken: pkg.installToken,
        version: pkg.version,
        openUrl: `${origin}/app/${pkg.shortCode}?t=${pkg.installToken}`,
        downloadUrl: `${origin}/app/${pkg.shortCode}/standalone?t=${pkg.installToken}`,
        hasPassphrase: pkg.hasPassphrase,
        installCount: pkg.installCount,
        maxInstalls: pkg.maxInstalls,
        downloadCount: dlCount,
        expiresAt: pkg.expiresAt,
      });
    }
  }

  // 5. Sort by recency (most recent first). Built rows use built_at;
  //    others use updatedAt — both already populated.
  entries.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));

  // 6. Account Status. Soft threshold for "your use is generous";
  //    above it we surface a future-monetization hint without ever
  //    throttling. Threshold is env-tunable; default sized for the
  //    bootstrap solo-patron Cell — bump for federation later.
  const threshold = Number(process.env['WARP_ACCOUNT_HINT_THRESHOLD'] ?? 100);
  const publishedCount = entries.filter((e) => e.kind === 'published').length;
  const totalUse = totalInstalls + totalDownloads;
  const accountStatus: AccountStatus = {
    publishedCount,
    totalInstalls,
    totalDownloads,
    threshold,
    aboveThreshold: totalUse >= threshold,
  };

  return json({ authed: true, email: hub.email, sessions: entries, accountStatus });
};
