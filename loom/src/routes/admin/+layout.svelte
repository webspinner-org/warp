<script lang="ts">
  import { page } from '$app/state';

  interface NavItem {
    readonly href: string;
    readonly label: string;
  }

  interface NavGroup {
    readonly title: string;
    readonly items: readonly NavItem[];
  }

  const groups: readonly NavGroup[] = [
    {
      title: 'Cell',
      items: [
        { href: '/admin', label: 'Status' },
        { href: '/admin/vault', label: 'Vault' },
        { href: '/admin/audit', label: 'Audit log' },
      ],
    },
    {
      title: 'Spinners',
      items: [
        { href: '/admin/spinners', label: 'Installed' },
        { href: '/admin/skein', label: 'Skein' },
        { href: '/admin/spools', label: 'Spools' },
        { href: '/admin/threads', label: 'Warp Threads' },
      ],
    },
    {
      title: 'Wizard',
      items: [{ href: '/admin/profile', label: 'Profile' }],
    },
  ];

  let { data, children } = $props();

  function isActive(href: string): boolean {
    if (href === '/admin') return page.url.pathname === '/admin';
    return page.url.pathname.startsWith(href);
  }
</script>

<svelte:head>
  <title>Loom · Warp</title>
</svelte:head>

<div class="shell">
  <header class="ribbon">
    <a class="ribbon-brand" href="/admin" aria-label="Warp — Webspinner Foundation Cell">
      <img class="wordmark" src="/brand/warp-wordmark.svg" alt="WARP" />
      <span class="sub">Webspinner Foundation Cell</span>
    </a>
    <div class="ribbon-meta">
      <span class="email">{data.user.email}</span>
      <form method="POST" action="/logout">
        <button type="submit" aria-label="Sign out">Sign out</button>
      </form>
    </div>
  </header>

  <aside class="nav">
    {#each groups as g (g.title)}
      <section>
        <h2>{g.title}</h2>
        <ul>
          {#each g.items as item (item.href)}
            <li>
              <a href={item.href} class:active={isActive(item.href)}>{item.label}</a>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </aside>

  <main>
    {@render children()}
  </main>
</div>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: #0a0a0a;
    color: #f0f0f0;
    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      sans-serif;
  }

  .shell {
    display: grid;
    grid-template-columns: 220px 1fr;
    grid-template-rows: 72px 1fr;
    grid-template-areas:
      'ribbon ribbon'
      'nav main';
    min-height: 100vh;
  }

  .ribbon {
    grid-area: ribbon;
    background-color: #000;
    border-bottom: 1px solid #1a1a1a;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1.25rem;
  }

  .ribbon-brand {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    text-decoration: none;
    color: inherit;
    transition: opacity 0.2s ease;
  }

  .ribbon-brand:hover {
    opacity: 0.85;
  }

  .ribbon-brand .wordmark {
    display: block;
    height: 36px;
    width: auto;
  }

  .ribbon-brand .sub {
    color: var(--text-mute);
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border-left: 1px solid #2a2418;
    padding-left: 0.85rem;
  }

  .ribbon-meta {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: 0.85rem;
    color: var(--gold);
  }

  .email {
    color: var(--gold);
  }

  .ribbon-meta button {
    background: transparent;
    color: var(--gold);
    border: 1px solid var(--gold-dim);
    padding: 0.3rem 0.7rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8rem;
  }

  .ribbon-meta button:hover {
    color: var(--gold-bright);
    border-color: var(--gold);
  }

  .nav {
    grid-area: nav;
    background: #060606;
    border-right: 1px solid #1a1a1a;
    padding: 1.5rem 0;
    overflow-y: auto;
  }

  .nav section + section {
    margin-top: 1.5rem;
  }

  .nav h2 {
    margin: 0 1.25rem 0.5rem;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--gold-dim);
  }

  .nav ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .nav a {
    display: block;
    padding: 0.5rem 1.25rem;
    color: var(--text-dim);
    text-decoration: none;
    font-size: 0.9rem;
    border-left: 2px solid transparent;
  }

  .nav a:hover {
    color: #fff;
    background: #0d0d0d;
  }

  .nav a.active {
    color: var(--cyan);
    background: #0d1416;
    border-left-color: var(--cyan);
  }

  main {
    grid-area: main;
    padding: 2rem;
    overflow-y: auto;
  }
</style>
