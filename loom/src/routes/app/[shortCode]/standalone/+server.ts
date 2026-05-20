/**
 * GET /app/[shortCode]/standalone?t=<installToken>
 *
 * Returns a self-contained .html download of the Webbase. The bundle
 * is already inlined by SvelteKit in /run/[shortCode]'s server-rendered
 * HTML; we re-use that output, rewrite the relative asset paths to
 * absolute Webspinner-CDN URLs, hard-code the SvelteKit base, and add
 * a small freshness-check + provenance footer.
 *
 * Trust model: same signed bundle as the live URL — recipient is
 * choosing how to consume, not what to trust. Per Wizard 2026-05-20:
 *   - downloads are NEVER throttled
 *   - every download is logged to wp_app_downloads for the Account
 *     Status tally + future abuse monitoring
 *   - max_installs is NOT decremented
 *
 * Caveats deliberately communicated to the patron, not patched in code:
 *   - The immutable assets the file references are Cloudflare-edge
 *     cached for a year. After that, a fresh re-download is needed.
 *   - file:// IndexedDB has browser-specific quirks; we tell the
 *     patron to host the file (or open from any HTTP/HTTPS origin)
 *     in the embedded provenance footer.
 *   - The bundle JSON inside is the long-term contract; even after
 *     the renderer changes or Webspinner goes away, the bundle is
 *     readable JSON that any future renderer can interpret.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getPackage } from '$lib/server/wsap-registry.js';
import { loomPbToken } from '$lib/server/pocketbase.js';
import { logDownload } from '$lib/server/app-downloads.js';

const PUBLIC_ORIGIN = process.env['WARP_PUBLIC_ORIGIN'] ?? 'https://app.webspinner.ai';

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

  // Fetch the SvelteKit-rendered /run page; the bundle is already
  // inlined and the screens are SSR'd. We just need to hardcode the
  // base for file:// + non-Webspinner-origin compatibility, rewrite
  // asset URLs to absolute, and add a freshness-check footer.
  const runUrl = `${PUBLIC_ORIGIN}/run/${encodeURIComponent(shortCode)}?t=${encodeURIComponent(installToken)}`;
  const runRes = await f(runUrl);
  if (!runRes.ok) {
    throw error(502, `failed to render /run for standalone: HTTP ${runRes.status}`);
  }
  let html = await runRes.text();

  // 1. Absolute asset URLs — patrons may host this anywhere, or open
  //    from file://; relative `../_app/...` won't resolve there.
  html = html.replace(/(["'(])\.\.\/_app\//g, `$1${PUBLIC_ORIGIN}/_app/`);

  // 2. Hard-code the SvelteKit base URL — the inline bootstrapper
  //    derives it from `location` by default, which breaks on
  //    file:// origins. Pinning it to the Webspinner origin keeps
  //    in-page navigation (links to /app/<code>, unlock fetch, etc.)
  //    working.
  html = html.replace(
    /__sveltekit_[a-z0-9]+\s*=\s*\{[^}]*base:\s*new URL\([^)]*\)\.pathname\.slice\([^)]*\)\s*\}/,
    (match) =>
      match.replace(
        /base:\s*new URL\([^)]*\)\.pathname\.slice\([^)]*\)/,
        `base: ${JSON.stringify(PUBLIC_ORIGIN)}`,
      ),
  );

  // 3. Embed freshness-check + provenance footer just before </body>.
  //    On open, the standalone checks the live version and lets the
  //    patron upgrade if newer is published. Same behaviour as hosted.
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
  const freshnessJs = `<script>
(function(){
  var META = ${JSON.stringify(meta)};
  window.__webbaseStandaloneMeta = META;
  function showBanner(latest) {
    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;background:#1a1410;color:#f0e6d4;padding:.6rem 1rem;font:14px system-ui,sans-serif;display:flex;align-items:center;justify-content:space-between;gap:1rem;border-top:1px solid #3d2f24;box-shadow:0 -4px 12px rgba(0,0,0,.4);z-index:99999;';
    bar.innerHTML = '<span>A newer version (v' + latest + ') is published. You\\'re running v' + META.version + '.</span>' +
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
</script>`;
  html = html.replace('</body>', freshnessJs + '\n</body>');

  // 4. Log this download. Fire-and-forget — never block the response
  //    on the log write. Even if PB is down, the patron gets the file.
  const ua = request.headers.get('user-agent') || '';
  // Hash the IP for a privacy-respecting per-source counter without
  // storing raw IPs. (Cloudflare's CF-Connecting-IP arrives if behind
  // the tunnel; fall back to peer addr.)
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

  // 5. Stream as attachment so the browser saves rather than navigates.
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

async function hashHex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}
