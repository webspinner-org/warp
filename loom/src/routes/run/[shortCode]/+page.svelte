<script lang="ts">
  // Thin wrapper around WebbaseRuntime. The component lives in
  // $lib/runtime/ so it can also be bundled standalone (vite.standalone
  // .config.ts) for the downloaded .html artifact. Same Svelte source
  // serves both hosted and standalone modes.
  import WebbaseRuntime from '$lib/runtime/WebbaseRuntime.svelte';
  import type { PageData } from './$types.js';
  let { data }: { data: PageData } = $props();
</script>

<WebbaseRuntime {data} />
