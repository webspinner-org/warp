<script lang="ts">
  import { resolve } from '$app/paths';
  import type { PageData } from './$types.js';
  import AuthorDashboard from '$lib/components/AuthorDashboard.svelte';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>{data.mode === 'dashboard' ? 'Your published Webbases' : 'Warp'}</title>
</svelte:head>

{#if data.mode === 'dashboard'}
  <AuthorDashboard {data} />
{:else}
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a
    class="splash"
    href={resolve('/login')}
    aria-label="Click anywhere to authenticate your identity"
  ></a>
{/if}

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
  }
  .splash {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    display: block;
    cursor: pointer;
    background-color: #000;
    background-image: url('/splash.png');
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
  }
  .splash:focus {
    outline: 2px solid #4af;
    outline-offset: -4px;
  }
</style>
