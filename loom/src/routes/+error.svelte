<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head>
  <title>{page.status} · Warp</title>
</svelte:head>

<main>
  <div class="card">
    <header>
      <span class="brand-mark">WARP</span>
      <span class="brand-sub">Webspinner Foundation</span>
    </header>

    <div class="status">{page.status}</div>

    {#if page.status === 404}
      <h1>Not found</h1>
      <p class="lede">
        The thread you followed leads nowhere. The Loom doesn't have a route at
        <code>{page.url.pathname}</code>.
      </p>
    {:else if page.status === 401 || page.status === 403}
      <h1>Not authorised</h1>
      <p class="lede">
        You're not signed in for this. Sign in and try again — or register if you don't have an
        account yet.
      </p>
    {:else if page.status >= 500}
      <h1>Something on our side</h1>
      <p class="lede">
        The Loom hit an internal error. This shouldn't happen. The Wizard has been notified through
        the audit log. A refresh usually clears it; if it doesn't, sign out and back in.
      </p>
    {:else}
      <h1>Trouble</h1>
      <p class="lede">{page.error?.message ?? 'Something unexpected happened.'}</p>
    {/if}

    <div class="actions">
      <a class="cta" href="/">Back to splash</a>
      {#if page.status === 401 || page.status === 403}
        <a class="cta secondary" href="/login">Sign in</a>
        <a class="cta secondary" href="/register">Register</a>
      {:else}
        <a class="cta secondary" href="/login">Sign in</a>
      {/if}
    </div>

    <footer>
      <span>{page.url.pathname}</span>
      <span class="dot">·</span>
      <span>HTTP {page.status}</span>
    </footer>
  </div>
</main>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: #0a0a0a;
    color: #f0f0f0;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  }

  main {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }

  .card {
    width: 100%;
    max-width: 520px;
    background: linear-gradient(180deg, #0e0e0e, #0a0a0a);
    border: 1px solid #1a1a1a;
    border-radius: 12px;
    padding: 2rem 1.85rem;
    text-align: center;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 0.85rem;
    margin-bottom: 1.25rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid #1a1a1a;
    justify-content: center;
  }

  .brand-mark {
    color: var(--gold, #c9a96a);
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: 0.18em;
  }

  .brand-sub {
    color: var(--text-mute);
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .status {
    font-family: 'Iowan Old Style', 'Hoefler Text', Georgia, serif;
    font-size: 4rem;
    font-weight: 600;
    color: var(--gold, #c9a96a);
    letter-spacing: 0.04em;
    line-height: 1;
    margin: 0.5rem 0 1rem;
    opacity: 0.55;
  }

  h1 {
    margin: 0 0 0.6rem;
    font-size: 1.5rem;
    color: var(--gold, #c9a96a);
    font-family: 'Iowan Old Style', 'Hoefler Text', Georgia, serif;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .lede {
    margin: 0 0 1.75rem;
    color: #ccc;
    font-size: 0.95rem;
    line-height: 1.6;
  }

  .lede code {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 3px;
    padding: 1px 6px;
    font-size: 0.85em;
    color: #ddd;
    font-family: ui-monospace, monospace;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    justify-content: center;
  }

  .cta {
    display: inline-block;
    background: var(--gold, #c9a96a);
    color: #1a1306;
    padding: 0.6rem 1.2rem;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
    font-size: 0.9rem;
    letter-spacing: 0.02em;
    transition: background 0.2s ease, transform 0.2s ease;
  }

  .cta:hover {
    background: var(--gold-bright, #e6c98a);
    transform: translateY(-1px);
  }

  .cta.secondary {
    background: transparent;
    color: var(--cyan, #5fcfe0);
    border: 1px solid #2a2a2a;
  }

  .cta.secondary:hover {
    border-color: var(--cyan, #5fcfe0);
    background: #0d1416;
    transform: none;
  }

  footer {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid #1a1a1a;
    color: var(--text-faint);
    font-size: 0.72rem;
    font-family: ui-monospace, monospace;
    letter-spacing: 0.04em;
  }

  footer .dot {
    margin: 0 0.4rem;
    color: #333;
  }
</style>
