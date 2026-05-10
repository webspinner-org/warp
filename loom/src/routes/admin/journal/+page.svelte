<script lang="ts">
  import { invalidateAll } from '$app/navigation';

  let { data } = $props();

  type Kind = 'action' | 'decision' | 'problem' | 'learning' | 'note';

  let kind = $state<Kind>('action');
  let title = $state('');
  let body = $state('');
  let tagsRaw = $state('');
  let publicFlag = $state(false);
  let submitting = $state(false);
  let submitError = $state<string | null>(null);
  let lastWritten = $state<{ id: string; title: string } | null>(null);

  let filter = $state<'all' | Kind>('all');

  const visible = $derived.by(() => {
    if (filter === 'all') return data.entries;
    return data.entries.filter((e) => e.kind === filter);
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (submitting) return;
    if (title.trim().length === 0 || body.trim().length === 0) {
      submitError = 'Title and body are required.';
      return;
    }
    submitting = true;
    submitError = null;
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    try {
      const res = await fetch('/admin/spinners/wizards-journal/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capability: 'record',
          input: { kind, title, body, tags, public: publicFlag },
        }),
      });
      const reply = await res.json();
      if (!res.ok || reply.ok === false) {
        submitError = reply.message ?? `Failed (${res.status}).`;
      } else {
        lastWritten = { id: reply.output.id, title: reply.output.title };
        title = '';
        body = '';
        tagsRaw = '';
        publicFlag = false;
        await invalidateAll();
      }
    } catch (err) {
      submitError = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }

  function fmtTimestamp(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function kindClass(k: string): string {
    return `kind kind-${k}`;
  }
</script>

<header class="head">
  <h1>Wizard's Journal</h1>
  <p class="lede">
    The Cell's operational diary — actions, decisions, problems, learnings.
    {data.total} entries total; {data.entries.length} within the last {data.horizonDays} days.
  </p>
</header>

{#if data.setupError}
  <p class="error" role="alert">{data.setupError}</p>
{/if}

<section class="entry">
  <h2>New entry</h2>
  <form onsubmit={submit}>
    <div class="kind-row">
      {#each (['action', 'decision', 'problem', 'learning', 'note'] as Kind[]) as k}
        <label class="kind-choice">
          <input type="radio" name="kind" value={k} bind:group={kind} />
          <span class={kindClass(k)}>{k}</span>
        </label>
      {/each}
    </div>

    <label class="field">
      <span>Title</span>
      <input
        type="text"
        bind:value={title}
        placeholder="Short, present-tense"
        maxlength="200"
        autocomplete="off"
      />
    </label>

    <label class="field">
      <span>Body</span>
      <textarea
        bind:value={body}
        rows="6"
        placeholder="What happened, why, what next."
        maxlength="10000"
        spellcheck="true"
      ></textarea>
    </label>

    <div class="meta-row">
      <label class="field tags">
        <span>Tags <span class="opt">(comma-separated)</span></span>
        <input
          type="text"
          bind:value={tagsRaw}
          placeholder="focus, ux, pablo"
          autocomplete="off"
        />
      </label>
      <label class="public-toggle">
        <input type="checkbox" bind:checked={publicFlag} />
        <span>Eligible for public docs</span>
      </label>
    </div>

    {#if submitError}
      <p class="error inline" role="alert">{submitError}</p>
    {/if}
    {#if lastWritten}
      <p class="ok">Recorded <strong>{lastWritten.title}</strong>.</p>
    {/if}

    <div class="actions">
      <button type="submit" disabled={submitting}>
        {submitting ? 'Writing…' : 'Record entry'}
      </button>
    </div>
  </form>
</section>

<section class="recent">
  <header class="recent-head">
    <h2>Recent entries <span class="count">({visible.length})</span></h2>
    <div class="filters" role="tablist">
      <button role="tab" aria-selected={filter === 'all'} class:active={filter === 'all'}
        onclick={() => (filter = 'all')}>All</button>
      <button role="tab" aria-selected={filter === 'action'} class:active={filter === 'action'}
        onclick={() => (filter = 'action')}>Actions</button>
      <button role="tab" aria-selected={filter === 'decision'} class:active={filter === 'decision'}
        onclick={() => (filter = 'decision')}>Decisions</button>
      <button role="tab" aria-selected={filter === 'problem'} class:active={filter === 'problem'}
        onclick={() => (filter = 'problem')}>Problems</button>
      <button role="tab" aria-selected={filter === 'learning'} class:active={filter === 'learning'}
        onclick={() => (filter = 'learning')}>Learnings</button>
      <button role="tab" aria-selected={filter === 'note'} class:active={filter === 'note'}
        onclick={() => (filter = 'note')}>Notes</button>
    </div>
  </header>

  {#if visible.length === 0}
    <p class="empty">
      {data.entries.length === 0
        ? "No entries within the last 30 days. The journal starts above."
        : 'No entries match this filter.'}
    </p>
  {:else}
    <ol class="entries">
      {#each visible as e (e.id)}
        <li class="entry-row">
          <header>
            <span class={kindClass(e.kind)}>{e.kind}</span>
            <strong class="entry-title">{e.title}</strong>
            <time>{fmtTimestamp(e.timestamp)}</time>
            {#if e.public}<span class="public-pill" title="Eligible for public docs">public</span>{/if}
          </header>
          <p class="entry-body">{e.body}</p>
          {#if e.tags.length > 0}
            <div class="tags-row">
              {#each e.tags as t}
                <span class="tag-chip">{t}</span>
              {/each}
            </div>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .head {
    margin: 0 0 1.5rem;
    max-width: 64rem;
  }

  h1 {
    margin: 0 0 0.4rem;
    font-size: 1.6rem;
    font-weight: 600;
    color: var(--gold);
    letter-spacing: 0.02em;
    font-family: var(--font-prose);
  }

  .lede {
    margin: 0;
    color: var(--text-dim);
    font-size: 1rem;
    line-height: 1.55;
    max-width: 60ch;
    font-family: var(--font-prose);
    font-style: italic;
  }

  .error {
    background: #2a0808;
    border: 1px solid #602020;
    color: #fbb;
    padding: 0.65rem 0.85rem;
    border-radius: 6px;
    margin: 0 0 1rem;
    font-size: 0.9rem;
    line-height: 1.55;
    max-width: 60rem;
  }

  .error.inline {
    margin: 0.5rem 0 0;
  }

  .ok {
    background: #0d1a0d;
    border: 1px solid #2a4020;
    color: #9fd99f;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    margin: 0.5rem 0 0;
    font-size: 0.88rem;
  }

  section {
    margin-bottom: 2.25rem;
    max-width: 64rem;
  }

  h2 {
    margin: 0 0 0.85rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--cyan);
    font-weight: 600;
  }

  /* ── New entry form ─────────────────────────────────────────────── */
  .entry form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 48rem;
    background: var(--bg-1, #111);
    border: 1px solid var(--line, #1f1f1f);
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
  }

  .kind-row {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .kind-choice {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
  }

  .kind-choice input {
    display: none;
  }

  .kind {
    display: inline-block;
    padding: 0.2rem 0.7rem;
    border-radius: 999px;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
    border: 1px solid var(--line, #1f1f1f);
    color: var(--text-mute);
    background: var(--bg-1, #111);
    transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  }

  .kind-choice input:checked + .kind {
    color: var(--cyan);
    border-color: var(--cyan-dim, #4ba9b8);
    background: rgba(95, 207, 224, 0.08);
  }

  /* recent entries use the kind chip too, but coloured by category */
  .kind.kind-action { color: var(--cyan-dim, #4ba9b8); border-color: var(--cyan-dim, #4ba9b8); background: rgba(95, 207, 224, 0.06); }
  .kind.kind-decision { color: var(--gold); border-color: #3a3220; background: #1a160a; }
  .kind.kind-problem { color: #f88; border-color: #602020; background: #2a0808; }
  .kind.kind-learning { color: #9fd99f; border-color: #2a4020; background: #0d1a0d; }
  .kind.kind-note { color: var(--text-mute); border-color: var(--line, #1f1f1f); }

  /* but only in the entries list (not the form chooser, where the active state takes over) */
  .entries .kind { font-size: 0.65rem; padding: 0.1rem 0.55rem; }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
  }

  .field > span {
    color: var(--text-dim);
  }

  .field .opt {
    color: var(--text-mute);
    font-size: 0.92em;
  }

  .field input,
  .field textarea {
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    color: var(--text);
    padding: 0.6rem 0.75rem;
    border-radius: 6px;
    font-size: 0.95rem;
    font-family: var(--font-data);
    line-height: 1.5;
    width: 100%;
    box-sizing: border-box;
  }

  .field textarea {
    font-family: var(--font-prose);
    resize: vertical;
  }

  .field input:focus,
  .field textarea:focus {
    outline: none;
    border-color: var(--cyan);
  }

  .meta-row {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 1rem;
    align-items: end;
  }

  .public-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--text-mute);
    font-size: 0.85rem;
    padding-bottom: 0.55rem;
    cursor: pointer;
  }

  .public-toggle input {
    accent-color: var(--cyan);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
  }

  .actions button {
    background: var(--gold);
    color: #1a1306;
    border: 0;
    padding: 0.6rem 1.4rem;
    border-radius: 6px;
    font-size: 0.92rem;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    letter-spacing: 0.02em;
  }

  .actions button:hover:not(:disabled) {
    background: var(--gold-bright);
  }

  .actions button:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  /* ── Recent entries ─────────────────────────────────────────────── */
  .recent-head {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
  }

  .recent-head h2 {
    margin: 0;
  }

  .recent-head .count {
    color: var(--text-mute);
    font-weight: 400;
  }

  .filters {
    display: flex;
    gap: 0.25rem;
    margin-left: auto;
    flex-wrap: wrap;
  }

  .filters button {
    background: transparent;
    border: 1px solid var(--line, #1f1f1f);
    color: var(--text-mute);
    padding: 0.32rem 0.7rem;
    font-size: 0.74rem;
    border-radius: 999px;
    cursor: pointer;
    font-family: inherit;
    letter-spacing: 0.02em;
  }

  .filters button:hover {
    color: var(--text);
    border-color: #2a2a2a;
  }

  .filters button.active {
    color: var(--cyan);
    border-color: var(--cyan-dim, #4ba9b8);
    background: rgba(95, 207, 224, 0.06);
  }

  .empty {
    color: var(--text-mute);
    font-size: 0.92rem;
    margin: 1rem 0;
    line-height: 1.55;
    font-family: var(--font-prose);
    font-style: italic;
  }

  .entries {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .entry-row {
    border: 1px solid var(--line, #1f1f1f);
    border-radius: 8px;
    padding: 0.85rem 1.1rem;
    background: var(--bg-1, #111);
  }

  .entry-row > header {
    display: flex;
    align-items: baseline;
    gap: 0.65rem;
    margin-bottom: 0.55rem;
    flex-wrap: wrap;
  }

  .entry-title {
    color: var(--gold);
    font-weight: 600;
    font-size: 1rem;
    font-family: var(--font-prose);
  }

  .entry-row time {
    color: var(--text-mute);
    font-size: 0.74rem;
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }

  .public-pill {
    display: inline-block;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
    color: var(--cyan-dim, #4ba9b8);
    border: 1px solid var(--cyan-dim, #4ba9b8);
    background: rgba(95, 207, 224, 0.06);
  }

  .entry-body {
    margin: 0;
    color: var(--text-secondary, #cfcfcf);
    font-size: 0.92rem;
    line-height: 1.6;
    font-family: var(--font-prose);
    white-space: pre-wrap;
  }

  .tags-row {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
    margin-top: 0.55rem;
  }

  .tag-chip {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: 4px;
    font-size: 0.7rem;
    color: var(--text-mute);
    background: var(--bg-2, #161616);
    border: 1px solid var(--line, #1f1f1f);
    font-family: var(--font-data);
  }
</style>
