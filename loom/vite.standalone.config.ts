// Separate Vite config that builds the Webbase Standalone Runtime as
// a self-contained IIFE bundle. The output (build/standalone/
// webbase-runtime.js + webbase-runtime.css) is what /app/<code>/
// standalone inlines into the downloaded .html so the file has NO
// runtime dependency on the Webspinner CDN.
//
// Run via `pnpm build:standalone` or as part of deploy-loom.
//
// Why a separate config (not part of SvelteKit's build): SvelteKit
// emits per-route content-hashed chunks, with absolute imports
// resolved against `app.webspinner.ai`. We can't inline those into
// a portable file without re-bundling. This config goes direct to
// vite-plugin-svelte + Rollup, produces one self-contained .js and
// one .css, and never touches SvelteKit's manifest.

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import * as path from 'node:path';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      $lib: path.resolve('./src/lib'),
    },
  },
  build: {
    outDir: 'build/standalone',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/lib/runtime/standalone-entry.ts',
      formats: ['iife'],
      name: 'WebbaseRuntime',
      fileName: () => 'webbase-runtime.js',
      cssFileName: 'webbase-runtime',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
