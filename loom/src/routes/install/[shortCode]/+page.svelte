<script lang="ts">
  import type { PageData } from './$types.js';
  let { data }: { data: PageData } = $props();
  let installing = $state(false);
  let result = $state<{
    ok: boolean;
    appId?: string;
    deployedSurfaceUrl?: string;
    message?: string;
  } | null>(null);

  async function doInstall() {
    installing = true;
    result = null;
    try {
      // Pull the bundle from the registry via the public install
      // endpoint and POST to /admin/db-app/import (auth: Loom session).
      const fetchBundle = await fetch(`/install/${data.shortCode}/bundle?t=${data.installToken}`, {
        headers: { Accept: 'application/json' },
      });
      if (!fetchBundle.ok) {
        result = { ok: false, message: `Could not fetch bundle: HTTP ${fetchBundle.status}` };
        installing = false;
        return;
      }
      const bundle = await fetchBundle.json();
      const install = await fetch('/admin/db-app/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle),
      });
      const body = await install.json().catch(() => null);
      if (!install.ok || !body || body.ok !== true) {
        result = {
          ok: false,
          message:
            body?.detail ||
            body?.reason ||
            `Install failed: HTTP ${install.status}. Sign in to your Cell first.`,
        };
      } else {
        result = {
          ok: true,
          appId: body.appId,
          deployedSurfaceUrl: body.deployedSurfaceUrl,
        };
      }
    } catch (err) {
      result = { ok: false, message: (err as Error).message };
    } finally {
      installing = false;
    }
  }
</script>

<svelte:head>
  <title>Install: {data.appName}</title>
</svelte:head>

<section class="install-shell">
  <header class="install-head">
    <h1>Install <em>{data.appName}</em> in your Cell</h1>
    <p class="install-sub">
      You're about to add this application to your Cell. Review what comes with it before
      installing.
    </p>
  </header>

  <article class="install-card">
    <h2>About the application</h2>
    <dl>
      <dt>Name</dt>
      <dd>{data.appName}</dd>
      <dt>Domain</dt>
      <dd>{data.domain || '(not declared)'}</dd>
      <dt>Built from</dt>
      <dd>"{data.patronSentence}"</dd>
      <dt>Built on</dt>
      <dd>{data.createdAt}</dd>
    </dl>
  </article>

  <article class="install-card">
    <h2>Provenance</h2>
    <dl>
      <dt>Author Cell</dt>
      <dd>{data.cellName}</dd>
      <dt>Cell key fingerprint</dt>
      <dd><code>{data.cellKeyFingerprint}</code></dd>
      <dt>Sent by</dt>
      <dd>{data.senderEmail}</dd>
      <dt>Built by Spinner</dt>
      <dd>{data.spinnerBundleName}@{data.spinnerBundleVersion}</dd>
    </dl>
  </article>

  <article class="install-card">
    <h2>Entities that will be created in your Cell</h2>
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

  <footer class="install-foot">
    <p class="install-note">
      This link is good for {data.installsRemaining} more install{data.installsRemaining === 1
        ? ''
        : 's'} and expires on {new Date(data.expiresAt).toLocaleDateString()}.
    </p>
    <button class="install-btn" onclick={doInstall} disabled={installing}>
      {installing ? 'Installing…' : 'Install in my Cell'}
    </button>
  </footer>

  {#if result}
    {#if result.ok}
      <div class="install-result install-result--ok">
        <h3>Installed.</h3>
        <p>Your Cell now has its own instance of <em>{data.appName}</em>.</p>
        {#if result.appId}
          <p>App id: <code>{result.appId}</code></p>
        {/if}
      </div>
    {:else}
      <div class="install-result install-result--err">
        <h3>Could not install</h3>
        <p>{result.message}</p>
      </div>
    {/if}
  {/if}
</section>

<style>
  /* cache-bust v2 — force new asset hash after CF cached the pre-proxy 404 */
  .install-shell {
    max-width: 720px;
    margin: 3rem auto;
    padding: 0 1.4rem;
    font-family: ui-sans-serif, system-ui, sans-serif;
    color: var(--text, #11212a);
  }
  .install-head {
    margin-bottom: 1.6rem;
  }
  .install-head h1 {
    font-family: serif;
    font-size: 1.85rem;
    margin: 0 0 0.45rem;
    font-weight: 500;
  }
  .install-head em {
    color: var(--gold-soft, #b88a3a);
    font-style: normal;
    font-weight: 600;
  }
  .install-sub {
    margin: 0;
    opacity: 0.78;
  }
  .install-card {
    background: var(--bg-elev, #fffdf7);
    border: 1px solid var(--border, #d9cebf);
    border-radius: 12px;
    padding: 1rem 1.2rem;
    margin: 1rem 0;
  }
  .install-card h2 {
    margin: 0 0 0.6rem;
    font-size: 0.78rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--gold-soft, #b88a3a);
    font-family: ui-monospace, monospace;
  }
  .install-card dl {
    display: grid;
    grid-template-columns: 11rem 1fr;
    row-gap: 0.4rem;
    margin: 0;
  }
  .install-card dt {
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text, #11212a);
    opacity: 0.65;
  }
  .install-card dd {
    margin: 0;
  }
  .install-card code {
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    color: var(--text, #11212a);
  }
  .install-card ul {
    margin: 0;
    padding-left: 1.2rem;
  }
  .install-card li {
    padding: 0.2rem 0;
  }
  .install-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border, #d9cebf);
    margin-top: 1.6rem;
  }
  .install-note {
    margin: 0;
    font-size: 0.85rem;
    opacity: 0.7;
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
  .install-result {
    margin-top: 1.6rem;
    padding: 1rem 1.2rem;
    border-radius: 10px;
  }
  .install-result h3 {
    margin: 0 0 0.4rem;
    font-family: serif;
    font-size: 1.2rem;
  }
  .install-result--ok {
    background: rgba(122, 156, 122, 0.12);
    border: 1px solid rgba(122, 156, 122, 0.45);
  }
  .install-result--err {
    background: rgba(200, 116, 104, 0.1);
    border: 1px solid rgba(200, 116, 104, 0.4);
  }
</style>
