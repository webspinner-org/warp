<script lang="ts">
  import type { PageData } from './$types.js';
  let { data }: { data: PageData } = $props();
  let unlocking = $state(false);
  let unlocked = $state(!data.locked);
  let passphrase = $state('');
  let unlockError = $state<string | null>(null);

  async function unlock() {
    if (passphrase.length === 0) return;
    unlocking = true;
    unlockError = null;
    const r = await fetch(`/app/${data.shortCode}/unlock?t=${data.installToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
    const body = await r.json().catch(() => null);
    unlocking = false;
    if (r.ok && body?.ok) {
      unlocked = true;
      passphrase = '';
    } else {
      unlockError = body?.reason ?? `HTTP ${r.status}`;
    }
  }

  function openWebbase() {
    // Navigate to the in-browser runtime — bundle loads on that
    // page, schema scaffolds into IndexedDB, data stays in the
    // visitor's browser. No Cell round-trip on use.
    window.location.href = `/run/${data.shortCode}?t=${data.installToken}`;
  }
</script>

<svelte:head>
  <title>{data.appName}</title>
</svelte:head>

<section class="app-shell">
  <header class="app-head">
    <h1><em>{data.appName}</em></h1>
    <p class="app-sub">
      A Webbase published from a Webspinner Cell. Review what comes with it before you open.
    </p>
  </header>

  {#if !unlocked}
    <article class="app-card unlock-card">
      <h2>Unlock</h2>
      <p>The author set a passphrase on this Webbase. Enter it to open.</p>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          unlock();
        }}
      >
        <input
          type="password"
          bind:value={passphrase}
          placeholder="Passphrase"
          autofocus
          autocomplete="off"
        />
        <button type="submit" class="install-btn" disabled={unlocking || passphrase.length === 0}>
          {unlocking ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
      {#if unlockError}
        <p class="error">{unlockError}</p>
      {/if}
    </article>
  {:else}
    <article class="app-card">
      <h2>About this Webbase</h2>
      <dl>
        <dt>Name</dt>
        <dd>{data.appName}</dd>
        <dt>Domain</dt>
        <dd>{data.domain || '(not declared)'}</dd>
        <dt>Built from</dt>
        <dd>"{data.patronSentence}"</dd>
        <dt>Version</dt>
        <dd>v{data.version}</dd>
        <dt>Built on</dt>
        <dd>{data.createdAt}</dd>
      </dl>
    </article>

    <article class="app-card">
      <h2>Provenance</h2>
      <dl>
        <dt>Author Cell</dt>
        <dd>{data.cellName}</dd>
        <dt>Cell key fingerprint</dt>
        <dd><code>{data.cellKeyFingerprint}</code></dd>
        <dt>Published by</dt>
        <dd>{data.senderEmail}</dd>
        <dt>Built by Spinner</dt>
        <dd>{data.spinnerBundleName}@{data.spinnerBundleVersion}</dd>
      </dl>
    </article>

    <article class="app-card">
      <h2>Entities</h2>
      <ul>
        {#each data.entities as e (e.name)}
          <li>
            <strong>{e.name}</strong>
            — {e.fieldCount} field{e.fieldCount === 1 ? '' : 's'}{e.linkCount > 0
              ? `, ${e.linkCount} relation${e.linkCount === 1 ? '' : 's'}`
              : ''}
          </li>
        {/each}
      </ul>
    </article>

    <footer class="app-foot">
      <p class="app-note">
        This link is good for {data.installsRemaining} more open{data.installsRemaining === 1
          ? ''
          : 's'} into a Cell and expires on {new Date(data.expiresAt).toLocaleDateString()}.
      </p>
      <button class="install-btn" onclick={openWebbase}> Open this Webbase </button>
    </footer>
  {/if}
</section>

<style>
  :global(body) {
    background: #15151a;
  }
  .app-shell {
    max-width: 720px;
    margin: 3rem auto;
    padding: 0 1.4rem;
    font-family: ui-sans-serif, system-ui, sans-serif;
    color: #e8e4dc;
  }
  .app-head h1 {
    color: #f5eedd;
    font-family: serif;
    font-size: 1.85rem;
    margin: 0 0 0.45rem;
    font-weight: 500;
  }
  .app-head em {
    color: #b88a3a;
    font-style: normal;
    font-weight: 600;
  }
  .app-sub {
    color: #cfc6b3;
    margin: 0 0 1.6rem;
  }
  .app-card {
    background: #1c1c22;
    border: 1px solid #34373d;
    border-radius: 12px;
    padding: 1.1rem 1.3rem;
    margin: 1rem 0;
  }
  .app-card h2 {
    margin: 0 0 0.85rem;
    font-size: 0.78rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #d4a574;
    font-family: ui-monospace, monospace;
  }
  .app-card dl {
    display: grid;
    grid-template-columns: 11rem 1fr;
    row-gap: 0.55rem;
    column-gap: 0.7rem;
    margin: 0;
  }
  .app-card dt {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #9a9189;
    font-family: ui-monospace, monospace;
    align-self: center;
  }
  .app-card dd {
    margin: 0;
    color: #f0e9d8;
    font-size: 0.96rem;
  }
  .app-card code {
    font-family: ui-monospace, monospace;
    font-size: 0.88rem;
    color: #d4a574;
    background: rgba(212, 165, 116, 0.08);
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
  }
  .app-card ul {
    margin: 0;
    padding-left: 1.2rem;
    color: #f0e9d8;
  }
  .app-card li {
    padding: 0.2rem 0;
  }
  .app-card li strong {
    color: #d4a574;
  }
  .unlock-card form {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .unlock-card input {
    flex: 1;
    appearance: none;
    background: #15151a;
    color: #f0e9d8;
    border: 1px solid #34373d;
    border-radius: 6px;
    padding: 0.55rem 0.7rem;
    font-size: 1rem;
  }
  .unlock-card input:focus {
    outline: none;
    border-color: #d4a574;
  }
  .error {
    margin-top: 0.7rem;
    color: #f0c1c1;
    font-size: 0.88rem;
  }
  .app-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    padding-top: 1rem;
    border-top: 1px solid #34373d;
    margin-top: 1.6rem;
  }
  .app-note {
    margin: 0;
    font-size: 0.85rem;
    color: #9a9189;
  }
  .install-btn {
    appearance: none;
    background: linear-gradient(135deg, #d4a574, #b88a3a);
    color: #1a1410;
    border: 0;
    border-radius: 8px;
    padding: 0.65rem 1.25rem;
    font-weight: 600;
    font-size: 0.96rem;
    cursor: pointer;
  }
  .install-btn:hover {
    filter: brightness(1.08);
  }
  .install-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .app-result {
    margin-top: 1.6rem;
    padding: 1rem 1.2rem;
    border-radius: 10px;
  }
  .app-result h3 {
    margin: 0 0 0.4rem;
    font-family: serif;
    font-size: 1.2rem;
  }
  .app-result--ok {
    background: rgba(122, 156, 122, 0.12);
    border: 1px solid rgba(122, 156, 122, 0.45);
  }
  .app-result--err {
    background: rgba(200, 116, 104, 0.1);
    border: 1px solid rgba(200, 116, 104, 0.4);
    color: #f0e9d8;
  }
  .app-result--forward {
    background: rgba(212, 165, 116, 0.1);
    border: 1px solid rgba(212, 165, 116, 0.4);
    color: #f0e9d8;
  }
  .app-result--forward h3 {
    color: #d4a574;
  }
</style>
