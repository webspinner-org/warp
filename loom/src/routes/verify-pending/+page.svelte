<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props();
  let resending = $state(false);
</script>

<svelte:head>
  <title>Verify your email · Warp</title>
</svelte:head>

<main>
  <div class="card">
    <header>
      <span class="brand-mark">WARP</span>
      <span class="brand-sub">Webspinner Foundation</span>
    </header>

    <h1>Verify your email</h1>
    <p class="lede">
      We sent a verification link to <strong>{data.user.email}</strong>. Click it to finish — the link
      expires in 24 hours. You're signed in, but the rest of the Loom waits until your address is
      confirmed.
    </p>

    {#if data.bootstrap.pendingVerifyUrl}
      <div class="bootstrap">
        <strong>Bootstrap mode</strong>
        <p>
          Email send isn't yet wired (the Resend API key isn't in this Cell's vault). For your own
          first registration, you can verify directly with this link:
        </p>
        <p class="bootstrap-link">
          <a href={data.bootstrap.pendingVerifyUrl}>Verify directly →</a>
        </p>
        <p class="bootstrap-note">
          This bootstrap path vanishes the moment <code>vault://_self/resend-api-key</code> is set.
        </p>
      </div>
    {/if}

    <form
      method="POST"
      action="?/resend"
      use:enhance={() => {
        resending = true;
        return async ({ update }) => {
          await update();
          resending = false;
        };
      }}
    >
      <button type="submit" disabled={resending}>
        {resending ? 'Resending…' : 'Resend verification email'}
      </button>
    </form>

    {#if form?.error}
      <p class="msg error" role="alert">{form.error}</p>
    {:else if form?.resent === 'sent'}
      <p class="msg ok">Sent. Check your inbox (and spam, just in case).</p>
    {:else if form?.resent === 'bootstrap'}
      <p class="msg ok">
        New link generated — bootstrap mode, click below.
      </p>
      <p class="bootstrap-link"><a href={form.verifyUrl}>Verify directly →</a></p>
    {/if}

    <p class="alt">
      Wrong account? <a href="/logout">Sign out</a>
    </p>
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
    max-width: 480px;
    background: linear-gradient(180deg, #0e0e0e, #0a0a0a);
    border: 1px solid #1a1a1a;
    border-radius: 12px;
    padding: 2rem 1.75rem;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 0.85rem;
    margin-bottom: 1.5rem;
    padding-bottom: 1.25rem;
    border-bottom: 1px solid #1a1a1a;
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
    margin: 0 0 0.6rem;
    font-size: 1.5rem;
    color: var(--gold, #c9a96a);
    font-family: 'Iowan Old Style', 'Hoefler Text', Georgia, serif;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .lede {
    margin: 0 0 1.5rem;
    color: #ccc;
    font-size: 0.95rem;
    line-height: 1.6;
  }

  .lede strong {
    color: var(--gold, #c9a96a);
    font-weight: 600;
  }

  .bootstrap {
    margin: 0 0 1.5rem;
    padding: 1rem 1.1rem;
    border: 1px solid #3a3220;
    background: #1a160a;
    border-radius: 8px;
  }

  .bootstrap strong {
    color: var(--gold, #c9a96a);
    text-transform: uppercase;
    font-size: 0.7rem;
    letter-spacing: 0.12em;
  }

  .bootstrap p {
    margin: 0.5rem 0 0;
    color: #ccc;
    font-size: 0.85rem;
    line-height: 1.55;
  }

  .bootstrap-link {
    margin-top: 0.6rem !important;
  }

  .bootstrap-link a {
    color: var(--cyan, #5fcfe0);
    text-decoration: none;
    font-weight: 500;
    font-size: 0.95rem;
  }

  .bootstrap-link a:hover {
    text-decoration: underline;
  }

  .bootstrap-note {
    color: var(--text-mute) !important;
    font-size: 0.75rem !important;
  }

  .bootstrap-note code {
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    border-radius: 3px;
    padding: 1px 5px;
    color: var(--text-dim);
    font-size: 0.85em;
  }

  form {
    margin: 0 0 0.75rem;
  }

  button {
    width: 100%;
    background: var(--gold, #c9a96a);
    color: #1a1306;
    border: none;
    padding: 0.7rem 1rem;
    border-radius: 6px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    letter-spacing: 0.02em;
    transition: background 0.2s ease;
  }

  button:hover:not(:disabled) {
    background: var(--gold-bright, #e6c98a);
  }

  button:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  .msg {
    margin: 0.85rem 0 0;
    padding: 0.55rem 0.8rem;
    border-radius: 6px;
    font-size: 0.85rem;
  }

  .msg.error {
    background: #2a0808;
    border: 1px solid #602020;
    color: #f88;
  }

  .msg.ok {
    background: #0d1a0d;
    border: 1px solid #2a4020;
    color: #8f8;
  }

  .alt {
    margin: 1.5rem 0 0;
    text-align: center;
    color: var(--text-mute);
    font-size: 0.85rem;
  }

  .alt a {
    color: var(--cyan, #5fcfe0);
    text-decoration: none;
  }

  .alt a:hover {
    text-decoration: underline;
  }
</style>
