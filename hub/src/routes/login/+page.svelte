<script lang="ts">
  import type { PageData } from './$types.js';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Sign in · Webspinner Hub</title>
</svelte:head>

<div class="login-shell">
  <article class="login-card">
    <svg
      class="login-mark"
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 50 L32 18 L52 50 Z" opacity="0.35" />
      <path d="M18 50 L32 26 L46 50" />
      <path d="M32 50 V58" />
      <path d="M26 58 H38" />
    </svg>

    <p class="tagline">Webspinner ECO System</p>
    <h1>Webspinner <span class="accent">Hub</span></h1>
    <p class="lede">Where knowledge is gathered. Where innovation is built.</p>

    {#if data.oauthConfigured}
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a class="btn-google" href="/auth/google/start">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285f4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
          />
          <path
            fill="#34a853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
          />
          <path
            fill="#fbbc05"
            d="M5.84 14.1A6.6 6.6 0 0 1 5.48 12c0-.73.13-1.44.36-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.83Z"
          />
          <path
            fill="#ea4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38Z"
          />
        </svg>
        Sign in with Google
      </a>
    {:else}
      <div class="login-error">
        Google OAuth isn't configured yet on this server. Set
        <code>GOOGLE_OAUTH_CLIENT_ID</code>, <code>GOOGLE_OAUTH_CLIENT_SECRET</code>, and
        <code>GOOGLE_OAUTH_REDIRECT_URI</code> in the hub launchd plist and reload.
      </div>
    {/if}

    {#if data.error}
      <div class="login-error">Sign-in failed: {data.error}</div>
    {/if}

    <p class="login-foot">Source-code control · Registry · One protocol</p>
  </article>
</div>
