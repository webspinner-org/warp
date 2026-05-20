// Standalone-bundle entry. Compiled by vite.standalone.config.ts into a
// single IIFE that mounts WebbaseRuntime against #app, reading bundle
// data from an inlined `<script type="application/json" id="webbase-bundle">`
// tag the /standalone endpoint puts in the page.
//
// This file is the patron-sovereignty path. Once inlined into the
// downloaded .html, the Webbase has NO runtime dependency on the
// Webspinner CDN, on `app.webspinner.ai`, or on any specific origin.
// Open the file from disk, from any HTTPS host, from a USB stick.

import { mount } from 'svelte';
import WebbaseRuntime from './WebbaseRuntime.svelte';

declare global {
  interface Window {
    __webbaseStandaloneMeta?: {
      readonly shortCode: string;
      readonly version: number;
      readonly appName?: string;
      readonly downloadedAt: string;
      readonly publishedOrigin: string;
      readonly versionCheckUrl: string;
      readonly redownloadUrl: string;
    };
  }
}

function readInlinedBundle(): unknown | null {
  const el = document.getElementById('webbase-bundle');
  if (!el) return null;
  try {
    return JSON.parse(el.textContent ?? 'null');
  } catch {
    return null;
  }
}

function showError(msg: string) {
  const root = document.getElementById('app') || document.body;
  const div = document.createElement('div');
  div.style.cssText =
    'padding:2rem;font-family:system-ui,sans-serif;background:#1a1410;color:#f0e6d4;min-height:100vh;';
  div.innerHTML =
    '<h1 style="color:#d4a85a;font-family:serif;">Webbase could not load</h1>' +
    '<p style="color:#bba990;">' +
    msg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
    '</p>';
  root.appendChild(div);
}

function bootstrap() {
  const data = readInlinedBundle();
  if (!data || typeof data !== 'object') {
    showError('Inlined bundle missing or malformed. The file may be truncated or corrupted.');
    return;
  }
  const root = document.getElementById('app');
  if (!root) {
    showError('Mount point #app not found in the document.');
    return;
  }
  // Standalone copies are always pre-unlocked at /standalone-build
  // time. Be defensive in case an older download is opened: force
  // locked=false rather than blocking the patron behind a form that
  // POSTs to a Cell URL that may no longer exist.
  const bundle = data as Record<string, unknown>;
  bundle['locked'] = false;
  mount(WebbaseRuntime, {
    target: root,
    props: { data: bundle as Parameters<typeof mount>[1]['props'] extends infer P ? P : never },
  });
}

// Run on DOMContentLoaded (or immediately if already loaded). The
// freshness-check script the /standalone endpoint appends to <body>
// runs in parallel; both are safe to start as soon as the DOM exists.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
