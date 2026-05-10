<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';

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

  // ── Pablo review panel ────────────────────────────────────────────
  // A single click sends the current page's outerHTML to Pablo and
  // renders findings inline. Keyboard shortcut: ⌘⇧P (Ctrl+Shift+P).

  let pabloOpen = $state(false);
  let pabloInvoking = $state(false);
  let pabloResult = $state<any>(null);
  let pabloError = $state<string | null>(null);

  async function askPablo() {
    if (pabloInvoking) return;
    pabloOpen = true;
    pabloInvoking = true;
    pabloError = null;
    pabloResult = null;
    const html = document.documentElement.outerHTML;
    const titleEl = document.querySelector('h1');
    const label = titleEl?.textContent?.trim() || page.url.pathname;
    const topic = `Walk this admin surface (${page.url.pathname}) and tell me what is wrong.`;
    try {
      const res = await fetch('/admin/spinners/pablo/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability: 'review', input: { html, label, topic } }),
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        pabloError = body.message ?? `Pablo invocation failed (${res.status}).`;
        pabloResult = body;
      } else {
        pabloResult = body;
      }
    } catch (e) {
      pabloError = e instanceof Error ? e.message : String(e);
    } finally {
      pabloInvoking = false;
    }
  }

  function closePablo() {
    pabloOpen = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && pabloOpen) {
      closePablo();
      e.preventDefault();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
      askPablo();
      e.preventDefault();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
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
      <button
        type="button"
        class="pablo-trigger"
        onclick={askPablo}
        disabled={pabloInvoking}
        title="Have Pablo review this page  (⌘⇧P)"
        aria-label="Have Pablo review this page"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="3" fill="currentColor"/>
        </svg>
        <span>{pabloInvoking ? 'Pablo is looking…' : 'Pablo'}</span>
      </button>
      <span class="email">{data.user.email}</span>
      <form method="POST" action="/logout">
        <button type="submit" aria-label="Sign out">Sign out</button>
      </form>
    </div>
  </header>

  {#if pabloOpen}
    <aside class="pablo-panel" aria-labelledby="pablo-panel-title">
      <header>
        <h2 id="pablo-panel-title">Pablo's read</h2>
        <span class="panel-route"><code>{page.url.pathname}</code></span>
        <button type="button" class="close" onclick={closePablo} aria-label="Close Pablo panel">✕</button>
      </header>

      {#if pabloInvoking}
        <div class="working">
          <div class="spinner" aria-hidden="true"></div>
          <p>Pablo is walking the surface — this takes 15-30s on the Cell's Quiet Loom.</p>
        </div>
      {:else if pabloError}
        <div class="panel-error" role="alert">
          <strong>Error</strong>
          <p>{pabloError}</p>
        </div>
      {:else if pabloResult?.ok && pabloResult.output}
        {@const out = pabloResult.output}
        <div class="panel-body">
          <header class="verdict-row">
            <span class={`pill review-verdict ${out.verdict}`}>{out.verdict}</span>
            {#if pabloResult.durationMs}
              <span class="duration">{(pabloResult.durationMs / 1000).toFixed(1)}s</span>
            {/if}
          </header>
          {#if out.verdict_text}
            <p class="verdict-text">{out.verdict_text}</p>
          {/if}
          {#if out.in_pablo_voice}
            <blockquote class="pablo-voice">{out.in_pablo_voice}</blockquote>
          {/if}
          {#if Array.isArray(out.findings) && out.findings.length > 0}
            <ol class="findings">
              {#each out.findings as f}
                <li class={`finding sev-${f.severity ?? 'medium'}`}>
                  <header>
                    <span class={`sev-pill sev-${f.severity ?? 'medium'}`}>{f.severity ?? 'medium'}</span>
                    <span class="category">{f.category ?? 'other'}</span>
                    <span class="source"><code>{f.source ?? 'pablos-eye'}</code></span>
                  </header>
                  <p class="finding-body">{f.finding ?? ''}</p>
                  {#if f.evidence}
                    <pre class="evidence"><code>{f.evidence.length > 240 ? f.evidence.slice(0, 240) + '…' : f.evidence}</code></pre>
                  {/if}
                  {#if f.fix}
                    <p class="fix"><strong>Fix:</strong> {f.fix}</p>
                  {/if}
                </li>
              {/each}
            </ol>
          {:else}
            <p class="muted-line">No findings. Pablo blesses this surface.</p>
          {/if}
        </div>
      {/if}
    </aside>
  {/if}

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

  /* ── Pablo trigger button + panel ──────────────────────────────── */
  .pablo-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    background: transparent;
    color: var(--cyan, #5fcfe0);
    border: 1px solid var(--cyan-dim, #4ba9b8);
    padding: 0.32rem 0.75rem;
    border-radius: 999px;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.78rem;
    letter-spacing: 0.02em;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .pablo-trigger:hover:not(:disabled) {
    background: rgba(95, 207, 224, 0.08);
    color: var(--cyan, #5fcfe0);
  }

  .pablo-trigger:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  .pablo-trigger svg {
    color: var(--gold, #c9a96a);
  }

  .pablo-panel {
    position: fixed;
    top: 72px;
    right: 0;
    bottom: 0;
    width: min(520px, 100vw);
    background: linear-gradient(180deg, #0e0e0e, #0a0a0a);
    border-left: 1px solid var(--line, #1f1f1f);
    box-shadow: -16px 0 48px rgba(0, 0, 0, 0.45);
    display: flex;
    flex-direction: column;
    z-index: 50;
    animation: pablo-slide 0.18s cubic-bezier(0.2, 0.6, 0.1, 1);
  }

  @keyframes pablo-slide {
    from { transform: translateX(40px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }

  .pablo-panel > header {
    display: flex;
    align-items: baseline;
    gap: 0.85rem;
    padding: 0.95rem 1.25rem;
    border-bottom: 1px solid var(--line, #1f1f1f);
    flex-shrink: 0;
  }

  .pablo-panel h2 {
    margin: 0;
    color: var(--gold);
    font-family: 'Iowan Old Style', 'Hoefler Text', Georgia, serif;
    font-size: 1.1rem;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .pablo-panel .panel-route {
    color: var(--text-mute);
    font-size: 0.78rem;
  }

  .pablo-panel .panel-route code {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--text-mute);
    font-size: inherit;
  }

  .pablo-panel .close {
    margin-left: auto;
    background: transparent;
    border: 0;
    color: var(--text-mute);
    cursor: pointer;
    font-size: 1.1rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
  }

  .pablo-panel .close:hover {
    color: var(--text);
    background: rgba(95, 207, 224, 0.06);
  }

  .pablo-panel .panel-body,
  .pablo-panel .working,
  .pablo-panel .panel-error {
    padding: 1rem 1.25rem 1.5rem;
    overflow-y: auto;
    flex: 1;
  }

  .pablo-panel .working {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--text-secondary);
    gap: 1rem;
  }

  .pablo-panel .working .spinner {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid var(--line);
    border-top-color: var(--gold);
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .pablo-panel .verdict-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.6rem;
  }

  .pablo-panel .verdict-row .duration {
    color: var(--text-mute);
    font-size: 0.74rem;
    font-variant-numeric: tabular-nums;
    margin-left: auto;
  }

  .pablo-panel .pill {
    display: inline-block;
    padding: 0.05rem 0.55rem;
    border-radius: 999px;
    font-size: 0.65rem;
    border: 1px solid currentColor;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
    line-height: 1.5;
  }

  .pablo-panel .review-verdict.passes {
    color: #9fd99f;
    background: #0d1a0d;
    border-color: #2a4020;
  }

  .pablo-panel .review-verdict.concerns {
    color: var(--gold);
    background: #1a160a;
    border-color: #3a3220;
  }

  .pablo-panel .review-verdict.fails {
    color: #f88;
    background: #2a0808;
    border-color: #602020;
  }

  .pablo-panel .verdict-text {
    color: var(--text-secondary);
    font-size: 0.92rem;
    line-height: 1.55;
    margin: 0 0 0.85rem;
  }

  .pablo-panel .pablo-voice {
    margin: 0 0 1.25rem;
    padding: 0.7rem 0.9rem;
    border-left: 3px solid var(--gold);
    background: rgba(201, 169, 106, 0.04);
    color: var(--text);
    font-family: 'Iowan Old Style', 'Hoefler Text', Georgia, serif;
    font-style: italic;
    font-size: 0.98rem;
    line-height: 1.55;
  }

  .pablo-panel .findings {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }

  .pablo-panel .finding {
    border: 1px solid var(--line, #1f1f1f);
    border-left-width: 3px;
    border-radius: 6px;
    padding: 0.7rem 0.85rem;
    background: var(--bg-1, #111);
  }

  .pablo-panel .finding.sev-high { border-left-color: #f88; }
  .pablo-panel .finding.sev-medium { border-left-color: var(--gold); }
  .pablo-panel .finding.sev-low { border-left-color: var(--cyan-dim, #4ba9b8); }

  .pablo-panel .finding > header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.45rem;
    flex-wrap: wrap;
  }

  .pablo-panel .sev-pill {
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
    border: 1px solid currentColor;
  }

  .pablo-panel .sev-pill.sev-high { color: #f88; background: #2a0808; }
  .pablo-panel .sev-pill.sev-medium { color: var(--gold); background: #1a160a; }
  .pablo-panel .sev-pill.sev-low { color: var(--cyan-dim, #4ba9b8); background: rgba(95, 207, 224, 0.06); }

  .pablo-panel .finding .category {
    color: var(--text-dim);
    font-size: 0.72rem;
  }

  .pablo-panel .finding .source {
    color: var(--text-mute);
    font-size: 0.7rem;
    margin-left: auto;
  }

  .pablo-panel .finding .source code {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--text-mute);
    font-size: inherit;
  }

  .pablo-panel .finding-body {
    margin: 0 0 0.5rem;
    color: var(--text-secondary);
    font-size: 0.88rem;
    line-height: 1.55;
  }

  .pablo-panel .evidence {
    margin: 0 0 0.5rem;
    padding: 0.5rem 0.7rem;
    background: #0a0a0a;
    border: 1px solid #1a1a1a;
    border-radius: 4px;
    overflow-x: auto;
  }

  .pablo-panel .evidence code {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--text-dim);
    font-size: 0.72rem;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .pablo-panel .fix {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.84rem;
    line-height: 1.5;
  }

  .pablo-panel .fix strong {
    color: var(--gold);
    font-weight: 600;
    margin-right: 0.25rem;
  }

  .pablo-panel .panel-error {
    color: #fbb;
  }

  .pablo-panel .panel-error strong {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.72rem;
    color: #f88;
    display: block;
    margin-bottom: 0.4rem;
  }

  .pablo-panel .muted-line {
    color: var(--text-mute);
    font-size: 0.9rem;
    line-height: 1.55;
  }
</style>
