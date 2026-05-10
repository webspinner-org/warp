<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props();
  let addSubmitting = $state(false);

  function fmt(iso: string): string {
    return new Date(iso).toLocaleString();
  }
</script>

<h1>Vault</h1>
<p class="lede">
  Encrypted secrets — AES-GCM-256, master key from <code>WARP_VAULT_MASTER_KEY</code> at runtime.
  Values are stored as ciphertext in the Grimoire; this UI shows names and metadata only. Per
  Operating Principle §17.2, secrets are entered here, never via Claude Code.
</p>

{#if data.setupError}
  <p class="error" role="alert">{data.setupError}</p>
{/if}

<section class="add">
  <h2>Add a secret</h2>
  <form
    method="POST"
    action="?/add"
    autocomplete="off"
    use:enhance={() => {
      addSubmitting = true;
      return async ({ update }) => {
        await update({ reset: true });
        addSubmitting = false;
      };
    }}
  >
    <!-- All inputs autocomplete="off" + non-username-ish names so Safari/Chrome
         don't pop the saved-password chooser over the description field. -->
    <div class="grid">
      <label>
        <span>Name</span>
        <input
          name="name"
          required
          maxlength="64"
          pattern="[a-zA-Z0-9_./\-]+"
          placeholder="cf-token, hetzner-token, anthropic-api-key…"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          data-1p-ignore
          data-lpignore="true"
        />
      </label>
      <label>
        <span>Description (optional)</span>
        <input
          name="description"
          maxlength="256"
          placeholder="What's this for?"
          autocomplete="off"
          spellcheck="false"
          data-1p-ignore
          data-lpignore="true"
        />
      </label>
      <label class="full">
        <span>Value</span>
        <input
          name="value"
          type="password"
          required
          autocomplete="new-password"
          spellcheck="false"
          placeholder="paste the secret"
          data-1p-ignore
          data-lpignore="true"
        />
      </label>
    </div>
    <div class="actions">
      <button type="submit" disabled={addSubmitting}>
        {addSubmitting ? 'Saving…' : 'Add secret'}
      </button>
      {#if form?.action === 'add' && form?.error}
        <span class="error">{form.error}</span>
      {/if}
      {#if form?.action === 'add' && form?.added}
        <span class="ok">Saved <strong>{form.added}</strong>.</span>
      {/if}
    </div>
  </form>
</section>

<section class="list">
  <h2>Stored secrets <span class="count">({data.secrets.length})</span></h2>
  {#if form?.action === 'delete' && form?.deleted}
    <p class="ok">Removed <strong>{form.deleted}</strong>.</p>
  {/if}
  {#if form?.action === 'delete' && form?.error}
    <p class="error">{form.error}</p>
  {/if}

  {#if data.secrets.length === 0}
    <p class="empty">Nothing stored yet.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Description</th>
          <th>Created</th>
          <th>Updated</th>
          <th aria-label="Actions"></th>
        </tr>
      </thead>
      <tbody>
        {#each data.secrets as s (s.id)}
          <tr>
            <td><code>{s.name}</code></td>
            <td>{s.description || '—'}</td>
            <td>{fmt(s.created)}</td>
            <td>{fmt(s.updated)}</td>
            <td class="row-actions">
              <form method="POST" action="?/delete" use:enhance>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="name" value={s.name} />
                <button
                  type="submit"
                  class="danger"
                  onclick={(e) => {
                    if (!confirm(`Delete ${s.name}? This cannot be undone.`)) e.preventDefault();
                  }}
                  aria-label={`Delete ${s.name}`}>Delete</button
                >
              </form>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--gold);
    letter-spacing: 0.02em;
  }

  .lede {
    margin: 0 0 1.75rem;
    color: var(--text-mute);
    font-size: 0.9rem;
    max-width: 60ch;
    line-height: 1.55;
  }

  code {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 0.85em;
    color: #ddd;
  }

  h2 {
    margin: 0 0 0.75rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--cyan);
    font-weight: 600;
  }

  .count {
    color: var(--text-faint);
    font-weight: 400;
  }

  section {
    margin-bottom: 2.25rem;
    max-width: 64rem;
  }

  .add {
    background: #111;
    border: 1px solid #1f1f1f;
    border-radius: 6px;
    padding: 1rem 1.25rem 1.25rem;
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 0.75rem 1rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
  }

  label span {
    color: var(--text-dim);
  }

  label.full {
    grid-column: 1 / -1;
  }

  input {
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    color: #eee;
    padding: 0.55rem 0.7rem;
    border-radius: 4px;
    font-size: 0.95rem;
    font-family: inherit;
  }

  input:focus {
    outline: none;
    border-color: var(--cyan);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-top: 1rem;
  }

  button {
    background: var(--gold);
    color: #1a1306;
    border: none;
    padding: 0.55rem 1rem;
    border-radius: 4px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
  }

  button:hover:not(:disabled, .danger) {
    background: var(--gold-bright);
  }

  button:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  button.danger {
    background: transparent;
    color: #f88;
    border: 1px solid #602020;
    font-weight: 500;
    padding: 0.3rem 0.7rem;
    font-size: 0.8rem;
  }

  button.danger:hover {
    background: #2a0808;
    border-color: #803030;
    color: #fbb;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }

  th {
    text-align: left;
    color: var(--text-mute);
    font-weight: 500;
    border-bottom: 1px solid #1f1f1f;
    padding: 0.5rem 0.75rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  td {
    padding: 0.65rem 0.75rem;
    border-bottom: 1px solid #141414;
    color: #ccc;
  }

  td code {
    background: transparent;
    border: none;
    padding: 0;
    color: #eee;
  }

  .row-actions {
    text-align: right;
  }

  .empty {
    color: var(--text-mute);
    font-size: 0.9rem;
  }

  .error {
    color: #f88;
    background: #2a0808;
    border: 1px solid #602020;
    border-radius: 4px;
    padding: 0.45rem 0.7rem;
    font-size: 0.85rem;
    margin: 0.5rem 0 0;
  }

  .ok {
    color: #8f8;
    font-size: 0.85rem;
  }
</style>
