<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';

  let { children } = $props();
  let theme = $state<'light' | 'dark'>('dark');

  function applyTheme(next: 'light' | 'dark') {
    theme = next;
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', next);
    }
  }

  onMount(() => {
    let saved: 'light' | 'dark' | null = null;
    try {
      const v = localStorage.getItem('webspinner-hub-theme');
      if (v === 'light' || v === 'dark') saved = v;
    } catch {
      /* localStorage unavailable */
    }
    const initial: 'light' | 'dark' =
      saved ??
      (typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark');
    applyTheme(initial);
  });

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem('webspinner-hub-theme', next);
    } catch {
      /* ignore */
    }
  }

  // Expose toggle + current theme to descendants via context-free
  // global; child pages render their own theme button using these.
  $effect(() => {
    if (typeof window !== 'undefined') {
      (window as unknown as { __hubTheme?: { theme: string; toggle: () => void } }).__hubTheme = {
        theme,
        toggle,
      };
    }
  });
</script>

<svelte:head>
  <meta name="color-scheme" content="light dark" />
</svelte:head>

{@render children()}
