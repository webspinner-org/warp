/**
 * GET /app/[shortCode]/standalone?t=<installToken>
 *
 * Returns a truly self-contained .html download of the Webbase.
 *
 * V2 (this implementation, 2026-05-20):
 *   - Inlines the bundle JSON into the page as a <script type=
 *     "application/json" id="webbase-bundle">.
 *   - Inlines the standalone-runtime JS (webbase-runtime.js) and CSS
 *     (webbase-runtime.css), built by vite.standalone.config.ts.
 *   - Appends a freshness-check script that pings /version on open
 *     and offers a re-download if a newer version is published.
 *   - Zero runtime dependency on app.webspinner.ai. The file works
 *     from disk, from any HTTPS host, from a USB stick. The Webbase
 *     outlives Webspinner.
 *
 * Per Wizard 2026-05-20: downloads are never throttled; every
 * download logged to wp_app_downloads for the Account Status tally.
 * Lock-stripped: data.locked is always false in the inlined bundle.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { getPackage } from '$lib/server/wsap-registry.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import { logDownload } from '$lib/server/app-downloads.js';

const PUBLIC_ORIGIN = process.env['WARP_PUBLIC_ORIGIN'] ?? 'https://app.webspinner.ai';

// build/standalone/ lives next to build/server/ at runtime. We read
// it lazily and cache in module-scope — same file across requests
// until the loom restarts (which is what deploy-loom does after
// build:standalone). One read per process lifetime per file.
let cachedRuntimeJs: string | null = null;
let cachedRuntimeCss: string | null = null;

function resolveStandaloneDir(): string {
  // In dev: the server runs from loom/. In prod build:
  // build/server/chunks/... — walking up two parents lands at build/.
  // Resolve relative to import.meta.url for both cases.
  const here = new URL('.', import.meta.url).pathname;
  // Try ../../standalone first (prod: server/chunks → server → standalone),
  // then ./build/standalone (dev: server runs from loom).
  for (const candidate of [
    path.resolve(here, '../../standalone'),
    path.resolve(here, '../../../build/standalone'),
    path.resolve(process.cwd(), 'build/standalone'),
  ]) {
    return candidate;
  }
  return path.resolve(process.cwd(), 'build/standalone');
}

async function readRuntime(): Promise<{ js: string; css: string } | null> {
  if (cachedRuntimeJs !== null && cachedRuntimeCss !== null) {
    return { js: cachedRuntimeJs, css: cachedRuntimeCss };
  }
  const dir = resolveStandaloneDir();
  const candidates = [dir];
  // Also try walking up — production prod build is one parent up.
  candidates.push(path.resolve(dir, '..', 'standalone'));
  candidates.push(path.resolve(dir, '..', '..', 'standalone'));
  for (const c of candidates) {
    try {
      const js = await fs
        .readFile(path.join(c, 'webbase-runtime.iife.js'), 'utf8')
        .catch(() => fs.readFile(path.join(c, 'webbase-runtime.js'), 'utf8'));
      let css = '';
      try {
        css = await fs.readFile(path.join(c, 'webbase-runtime.css'), 'utf8');
      } catch {
        // CSS file may be named differently or absent; that's fine.
      }
      cachedRuntimeJs = js;
      cachedRuntimeCss = css;
      return { js, css };
    } catch {
      continue;
    }
  }
  return null;
}

export const GET: RequestHandler = async ({ params, url, fetch: f, request }) => {
  const shortCode = params.shortCode ?? '';
  const installToken = url.searchParams.get('t') ?? '';
  if (!shortCode) throw error(400, 'shortCode missing');
  if (!installToken) throw error(400, 'install token missing in URL (?t=…)');

  const pbToken = await loomPbToken(f);
  if (!pbToken) throw error(500, 'PB auth failed');

  const pkg = await getPackage({ shortCode, installToken, fetchFn: f, token: pbToken });
  if (!pkg.ok) {
    throw error(pkg.reason === 'not-found' ? 404 : 410, `Webbase: ${pkg.reason}`);
  }

  // Build the data shape the runtime expects — same fields as the
  // /run page's PageServerLoad. Lock-stripped: standalone copies are
  // ungated by design (the hosted URL is what passphrase gates).
  const bundle = pkg.row.bundle as Record<string, unknown>;
  const design = (bundle['design'] ?? {}) as Record<string, unknown>;
  const schema = (bundle['schema'] ?? {}) as Record<string, unknown>;
  const screensDraft = (design['screensDraft'] ?? {}) as Record<string, unknown>;
  const data = {
    shortCode: pkg.row.shortCode,
    installToken,
    version: pkg.row.version,
    locked: false,
    appName: pkg.row.appName || (screensDraft['appName'] as string) || '(unnamed)',
    domain: pkg.row.domain || (screensDraft['domain'] as string) || '',
    senderEmail: pkg.row.senderEmail,
    expiresAt: pkg.row.expiresAt,
    screensDraft,
    entities: (schema['entities'] ?? []) as readonly unknown[],
    branding: design['branding'] ?? null,
  };

  const runtime = await readRuntime();
  if (!runtime) {
    throw error(
      503,
      'standalone runtime not built. run `pnpm build:standalone` (deploy-loom does this).',
    );
  }

  // Freshness-check + provenance footer.
  const versionUrl = `${PUBLIC_ORIGIN}/app/${encodeURIComponent(shortCode)}/version?t=${encodeURIComponent(installToken)}`;
  const downloadUrl = `${PUBLIC_ORIGIN}/app/${encodeURIComponent(shortCode)}/standalone?t=${encodeURIComponent(installToken)}`;
  const meta = {
    shortCode: pkg.row.shortCode,
    version: pkg.row.version,
    appName: pkg.row.appName,
    downloadedAt: new Date().toISOString(),
    publishedOrigin: PUBLIC_ORIGIN,
    versionCheckUrl: versionUrl,
    redownloadUrl: downloadUrl,
  };

  const escapeJson = (s: string) => s.replace(/</g, '\\u003c');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(data.appName)}</title>
<style>${runtime.css}</style>
</head>
<body style="margin:0;background:#15151a;">
<div id="app"></div>
<script type="application/json" id="webbase-bundle">${escapeJson(JSON.stringify(data))}</script>
<script>${runtime.js}</script>
<script>
(function(){
  var META = ${JSON.stringify(meta)};
  window.__webbaseStandaloneMeta = META;
  function showBanner(latest) {
    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;background:#1a1410;color:#f0e6d4;padding:.6rem 1rem;font:14px system-ui,sans-serif;display:flex;align-items:center;justify-content:space-between;gap:1rem;border-top:1px solid #3d2f24;box-shadow:0 -4px 12px rgba(0,0,0,.4);z-index:99999;';
    bar.innerHTML = '<span>A newer version (v' + latest + ') is published. You are running v' + META.version + '.</span>' +
      '<span><a href="' + META.redownloadUrl + '" style="color:#d4a85a;font-weight:600;margin-right:1rem;">Download new version</a>' +
      '<button onclick="this.parentElement.parentElement.remove()" style="background:transparent;border:1px solid #3d2f24;color:#bba990;padding:.3rem .7rem;border-radius:6px;cursor:pointer;">Keep this one</button></span>';
    document.body.appendChild(bar);
  }
  setTimeout(function(){
    try {
      fetch(META.versionCheckUrl).then(function(r){return r.ok ? r.json() : null;}).then(function(b){
        if (b && typeof b.version === 'number' && b.version > META.version) showBanner(b.version);
      }).catch(function(){});
    } catch (_) {}
  }, 2500);
})();
</script>
</body>
</html>`;

  // Log download. Fire-and-forget.
  const ua = request.headers.get('user-agent') || '';
  const ipRaw =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '';
  const ipHash = ipRaw ? await hashHex(ipRaw) : '';
  void logDownload({
    shortCode: pkg.row.shortCode,
    installTokenPrefix: installToken.slice(0, 8),
    version: pkg.row.version,
    userAgent: ua.slice(0, 256),
    ipHash,
    fetchFn: f,
    token: pbToken,
  });

  const safeName =
    (pkg.row.appName || pkg.row.domain || 'webbase')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'webbase';
  const filename = `${safeName}-v${pkg.row.version}.html`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
};

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

async function hashHex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}
