<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types.js';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let submitting = $state(false);
  let confirmed = $state(false);

  function lastRotationText() {
    if (!data.vault.lastRotationAt) return 'No prior rotation recorded.';
    const ms = Date.now() - new Date(data.vault.lastRotationAt).getTime();
    const days = Math.floor(ms / 86400_000);
    if (days < 1) return `${data.vault.lastRotationAt} (today)`;
    return `${data.vault.lastRotationAt} (${days}d ago)`;
  }
</script>

<svelte:head>
  <title>Vault rotation · admin</title>
</svelte:head>

<div class="page">
  <header>
    <h1>Vault rotation</h1>
    <p class="lede">
      Rotate the AES-GCM master key the operator vault is encrypted with. Backs up first, never
      throws on error mid-way — safe to retry if the worst happens.
    </p>
  </header>

  <section class="card">
    <h2>Vault state</h2>
    <dl class="grid">
      <dt>Encrypted rows</dt>
      <dd>{data.vault.rowCount}</dd>
      <dt>Current key fingerprint</dt>
      <dd><code>{data.vault.oldKeyFingerprint}</code> <span class="hint">(SHA-256/8)</span></dd>
      <dt>Last rotation</dt>
      <dd>{lastRotationText()}</dd>
      {#if data.vault.lastRotationDir}
        <dt>Last backup dir</dt>
        <dd><code>{data.vault.lastRotationDir}</code></dd>
      {/if}
    </dl>
  </section>

  <section class="card">
    <h2>Storage paths</h2>
    <dl class="grid">
      <dt>Hub storage dir</dt>
      <dd>
        <code>{data.storage.resolvedPath}</code>
        <span class="hint">(source: {data.storage.source})</span>
      </dd>
      <dt>Status</dt>
      <dd>
        {#if data.storage.exists}
          ✓ exists{data.storage.entryCount !== null ? `; ${data.storage.entryCount} entries` : ''}
        {:else}
          ✗ directory missing
        {/if}
      </dd>
    </dl>
    <p class="hint">
      Set HUB_STORAGE_DIR in the launchd plist to override the default. Full UI configurability
      lives in task #43; today this surface is read-only visibility.
    </p>
  </section>

  <section class="card card--action">
    <h2>Rotate master key</h2>
    <p>
      Generates a fresh 32-byte key, re-encrypts every vault row, rewrites the three plists (loom /
      loom-demo / hub). The new key NEVER leaves this server — the response shows only an 8-char
      fingerprint.
    </p>
    <p>
      <strong>You'll need to restart services manually afterwards.</strong> Doing it from this route
      would kill the running Loom mid-response. After rotation, run
      <code>bash ~/warp/tools/deploy-loom</code> in a terminal.
    </p>

    {#if form?.result?.ok === false}
      <p class="error">
        Rotation failed at <code>{form.result.phase}</code>: {form.result.reason}
        {#if form.result.backupDir}
          <br /><span class="hint">Backup at <code>{form.result.backupDir}</code></span>
        {/if}
      </p>
    {/if}
    {#if form?.result?.ok}
      <p class="ok">
        ✓ Rotated. {form.result.rowsRotated} row(s) re-encrypted; {form.result.plistsRewritten}
        plist key(s) rewritten.<br />
        <span class="hint">
          Old key fp <code>{form.result.oldKeyFingerprint}</code> → new key fp
          <code>{form.result.newKeyFingerprint}</code><br />
          Backup at <code>{form.result.backupDir}</code><br />
          {form.result.restartInstruction}
        </span>
      </p>
    {/if}

    <form
      method="POST"
      action="?/rotate"
      use:enhance={() => {
        submitting = true;
        return async ({ update }) => {
          await update();
          submitting = false;
          confirmed = false;
        };
      }}
    >
      {#if !confirmed}
        <button
          type="button"
          class="btn btn--primary"
          onclick={() => {
            confirmed = true;
          }}
        >
          Begin rotation
        </button>
      {:else}
        <button type="submit" class="btn btn--danger" disabled={submitting}>
          {submitting ? 'Rotating…' : 'Confirm: rotate now'}
        </button>
        <button
          type="button"
          class="btn"
          disabled={submitting}
          onclick={() => {
            confirmed = false;
          }}
        >
          Cancel
        </button>
      {/if}
    </form>
  </section>
</div>

<style>
  .page {
    max-width: 760px;
    margin: 2rem auto;
    padding: 0 1.4rem 4rem;
    color: var(--text);
  }
  h1 {
    margin: 0 0 0.4rem;
    color: var(--accent-1);
  }
  .lede {
    color: var(--text-muted);
    margin: 0 0 1.5rem;
  }
  .card {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.1rem 1.3rem;
    margin: 1rem 0;
  }
  .card h2 {
    margin: 0 0 0.85rem;
    font-size: 0.78rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent-1);
    font-family: ui-monospace, monospace;
  }
  .card.card--action {
    border-color: color-mix(in oklab, var(--accent-1) 25%, var(--border));
  }
  dl.grid {
    display: grid;
    grid-template-columns: 14rem 1fr;
    row-gap: 0.55rem;
    column-gap: 0.7rem;
    margin: 0;
  }
  dt {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    font-family: ui-monospace, monospace;
    align-self: center;
  }
  dd {
    margin: 0;
    color: var(--text);
    font-size: 0.95rem;
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 0.86rem;
    color: var(--accent-1);
    background: color-mix(in oklab, var(--accent-1) 8%, transparent);
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
  }
  .hint {
    color: var(--text-muted);
    font-size: 0.82rem;
  }
  .btn {
    appearance: none;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    padding: 0.6rem 1.1rem;
    border-radius: 8px;
    font: inherit;
    cursor: pointer;
  }
  .btn:hover {
    background: var(--bg-muted);
  }
  .btn--primary {
    background: var(--accent-1);
    color: var(--accent-ink);
    border-color: var(--accent-1);
  }
  .btn--primary:hover {
    background: var(--accent-2);
  }
  .btn--danger {
    background: #c33;
    color: white;
    border-color: #c33;
  }
  .btn--danger:hover {
    background: #a22;
  }
  .ok {
    color: #5fcfa0;
    background: rgba(95, 207, 160, 0.08);
    border-left: 3px solid #5fcfa0;
    padding: 0.7rem 0.9rem;
    border-radius: 6px;
  }
  .error {
    color: #e57;
    background: rgba(229, 87, 87, 0.08);
    border-left: 3px solid #e57;
    padding: 0.7rem 0.9rem;
    border-radius: 6px;
  }
</style>
