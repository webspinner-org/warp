<script lang="ts">
  import type { PageData } from './$types.js';
  let { data }: { data: PageData } = $props();
  let installing = $state(false);
  let result = $state<{
    ok: boolean;
    appId?: string;
    deployedSurfaceUrl?: string;
    message?: string;
    kind?: 'forward' | string;
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
        // Common case on try.webspinner.ai: the demo doesn't expose
        // /admin/db-app/import (no patron auth, no Cell of their own).
        // Surface the federation framing instead of the raw HTTP code.
        if (install.status === 405 || install.status === 404 || install.status === 401) {
          result = {
            ok: false,
            message:
              "This demo doesn't host installs — it's session-isolated.\n\n" +
              'To install ' +
              data.appName +
              ' into a real Cell, forward this whole URL ' +
              '(including the ?t=… token) to a Webspinner with their own operator Cell. ' +
              'They open it on their Cell, hit Install, and the app lands there.',
            kind: 'forward',
          };
        } else {
          result = {
            ok: false,
            message:
              body?.detail ||
              body?.reason ||
              `Install failed: HTTP ${install.status}. Sign in to your Cell first.`,
          };
        }
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
    {:else if result.kind === 'forward'}
      <div class="install-result install-result--forward">
        <h3>Forward this link to install</h3>
        <p style="white-space: pre-line;">{result.message}</p>
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
  /* cache-bust v3 — readable contrast on dark page bg */
  .install-shell {
    max-width: 720px;
    margin: 3rem auto;
    padding: 0 1.4rem;
    font-family: ui-sans-serif, system-ui, sans-serif;
    color: #e8e4dc;
  }
  .install-head h1 {
    color: #f5eedd;
  }
  .install-sub {
    color: #cfc6b3;
    opacity: 1;
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
    background: #1c1c22;
    border: 1px solid #34373d;
    border-radius: 12px;
    padding: 1.1rem 1.3rem;
    margin: 1rem 0;
  }
  .install-card h2 {
    margin: 0 0 0.85rem;
    font-size: 0.78rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #d4a574;
    font-family: ui-monospace, monospace;
  }
  .install-card dl {
    display: grid;
    grid-template-columns: 11rem 1fr;
    row-gap: 0.55rem;
    column-gap: 0.7rem;
    margin: 0;
  }
  .install-card dt {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #9a9189;
    font-family: ui-monospace, monospace;
    align-self: center;
  }
  .install-card dd {
    margin: 0;
    color: #f0e9d8;
    font-size: 0.96rem;
  }
  .install-card code {
    font-family: ui-monospace, monospace;
    font-size: 0.88rem;
    color: #d4a574;
    background: rgba(212, 165, 116, 0.08);
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
  }
  .install-card ul {
    margin: 0;
    padding-left: 1.2rem;
    color: #f0e9d8;
  }
  .install-card li {
    padding: 0.2rem 0;
  }
  .install-card li strong {
    color: #d4a574;
  }
  .install-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    padding-top: 1rem;
    border-top: 1px solid #34373d;
    margin-top: 1.6rem;
  }
  .install-note {
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
    color: #f0e9d8;
  }
  .install-result--forward {
    background: rgba(212, 165, 116, 0.1);
    border: 1px solid rgba(212, 165, 116, 0.4);
    color: #f0e9d8;
  }
  .install-result--forward h3 {
    color: #d4a574;
  }
</style>
