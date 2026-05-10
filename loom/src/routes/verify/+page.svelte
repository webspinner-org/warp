<script lang="ts">
  let { data } = $props();
</script>

<svelte:head>
  <title>Email verified · Warp</title>
</svelte:head>

<main>
  <div class={`card ${data.state}`}>
    <header>
      <span class="brand-mark">WARP</span>
      <span class="brand-sub">Webspinner Foundation</span>
    </header>

    {#if data.state === 'verified'}
      <h1>You're verified.</h1>
      <p class="lede">
        Email confirmed for <strong>{data.email}</strong>. The Loom is open to you now.
      </p>
      <a class="cta" href="/admin">Enter the Loom →</a>
    {:else if data.state === 'invalid'}
      <h1>Link not valid</h1>
      <p class="lede">{data.message}</p>
      <a class="cta" href="/verify-pending">Request a new link</a>
    {:else}
      <h1>Trouble verifying</h1>
      <p class="lede">{data.message}</p>
      <a class="cta secondary" href="/login">Sign in</a>
    {/if}
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
    max-width: 460px;
    background: linear-gradient(180deg, #0e0e0e, #0a0a0a);
    border: 1px solid #1a1a1a;
    border-radius: 12px;
    padding: 2rem 1.75rem;
    text-align: center;
  }

  .card.verified {
    border-color: rgba(95, 207, 224, 0.35);
    box-shadow: 0 12px 40px -16px rgba(95, 207, 224, 0.25);
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 0.85rem;
    margin-bottom: 1.5rem;
    padding-bottom: 1.25rem;
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

  h1 {
    margin: 0 0 0.85rem;
    font-size: 1.7rem;
    color: var(--gold, #c9a96a);
    font-family: 'Iowan Old Style', 'Hoefler Text', Georgia, serif;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .card.verified h1 {
    color: #5fcfe0;
  }

  .lede {
    margin: 0 0 1.75rem;
    color: #ccc;
    font-size: 0.95rem;
    line-height: 1.6;
  }

  .lede strong {
    color: var(--gold, #c9a96a);
    font-weight: 600;
  }

  .cta {
    display: inline-block;
    background: var(--gold, #c9a96a);
    color: #1a1306;
    padding: 0.7rem 1.4rem;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
    font-size: 0.95rem;
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
</style>
