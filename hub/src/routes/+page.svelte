<script lang="ts">
  import type { PageData } from './$types.js';
  let { data }: { data: PageData } = $props();

  let theme = $state<'light' | 'dark'>('dark');
  // Pick up the layout's exposed theme once mounted so the toggle
  // label matches the active state immediately.
  $effect(() => {
    if (typeof window !== 'undefined') {
      const t = (window as unknown as { __hubTheme?: { theme: 'light' | 'dark' } }).__hubTheme;
      if (t) theme = t.theme;
    }
  });

  function toggleTheme() {
    const t = (
      window as unknown as { __hubTheme?: { toggle: () => void; theme: 'light' | 'dark' } }
    ).__hubTheme;
    if (t) {
      t.toggle();
      theme = t.theme === 'dark' ? 'light' : 'dark';
    }
  }
</script>

<svelte:head>
  <title>Webspinner Hub</title>
</svelte:head>

<div class="hub-shell">
  <header class="hub-bar">
    <div class="hub-bar-l">
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a class="hub-brand" href="/">
        <span class="word-w">Webspinner</span><span class="word-h">Hub</span>
        <span class="sub">root</span>
      </a>
    </div>
    <div class="hub-bar-r">
      <button class="theme-toggle" type="button" onclick={toggleTheme} aria-label="Toggle theme">
        {#if theme === 'dark'}
          <!-- sun icon: switch to light -->
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4" />
            <path
              d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
            />
          </svg>
          <span>Light</span>
        {:else}
          <!-- moon icon: switch to dark -->
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
          </svg>
          <span>Dark</span>
        {/if}
      </button>
      <div class="hub-user">
        {#if data.user.picture}
          <img class="avatar" src={data.user.picture} alt="" referrerpolicy="no-referrer" />
        {/if}
        <span>{data.user.name || data.user.email}</span>
        {#if data.user.isWizard}
          <span class="wizard-tag">wizard</span>
        {/if}
        <form action="/auth/logout" method="POST">
          <button
            type="submit"
            class="signout"
            style="background:transparent;border:0;cursor:pointer;color:inherit;font:inherit"
            >sign out</button
          >
        </form>
      </div>
    </div>
  </header>

  <main class="hub-main">
    <div class="hub-content">
      <nav class="crumbs" aria-label="Breadcrumb">
        <span class="crumb active">/</span>
      </nav>

      <section class="empty-archive">
        <svg
          class="empty-mark"
          viewBox="0 0 64 64"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <!-- Stylized canopy + path: matches the splash -->
          <path d="M12 50 L32 18 L52 50 Z" opacity="0.35" />
          <path d="M18 50 L32 26 L46 50" />
          <path d="M32 50 V58" />
          <path d="M26 58 H38" />
        </svg>
        <h1>The Hub is empty.</h1>
        <p>
          Nothing is stored at the root yet. Source code, Spinners, manuscripts, and other artifacts
          will appear here as they're pushed.
        </p>
        <div class="hint mono">root · {data.user.email}</div>
      </section>
    </div>
  </main>
</div>
