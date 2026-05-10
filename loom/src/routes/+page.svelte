<script lang="ts">
  import { resolve } from '$app/paths';
</script>

<svelte:head>
  <title>Warp</title>
</svelte:head>

<a class="splash" href={resolve('/login')} aria-label="Click anywhere to authenticate your identity"
></a>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: #000;
    overflow: hidden;
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
