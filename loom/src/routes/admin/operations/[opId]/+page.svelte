<script lang="ts">
  let { data } = $props();

  function fmt(iso: string): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  function fmtRelative(iso: string): string {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return iso;
    const diff = Date.now() - t;
    if (diff < 0) return 'just now';
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function duration(startIso: string, endIso: string): string {
    const a = new Date(startIso).getTime();
    const b = new Date(endIso).getTime();
    if (Number.isNaN(a) || Number.isNaN(b)) return '—';
    const ms = b - a;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
  }

  function statusClass(s: string): string {
    if (s === 'ok' || s === 'success') return 'ok';
    if (s === 'partial' || s === 'denied') return 'warn';
    if (s === 'failed' || s === 'error') return 'bad';
    return '';
  }

  function statusGlyph(s: string): string {
    if (s === 'ok' || s === 'success') return '✓';
    if (s === 'partial') return '⚠';
    if (s === 'denied') return '⊘';
    if (s === 'failed' || s === 'error') return '✗';
    return '·';
  }

  function jsonPretty(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
</script>

{#if data.setupError}
  <p class="error" role="alert">{data.setupError}</p>
{:else if !data.operation}
  <p class="error" role="alert">Operation not found.</p>
{:else}
  <header class="head">
    <p class="back">
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a href="/admin/operations">← All operations</a>
    </p>
    <h1>
      <code class="kind">{data.operation.kind}</code>
      <span class={`pill ${statusClass(data.operation.status)}`}>
        <span class="glyph">{statusGlyph(data.operation.status)}</span>
        {data.operation.status}
      </span>
    </h1>
    <p class="op-id" title="Click to copy">
      <code>{data.operation.opId}</code>
    </p>

    <div class="actions">
      <button
        type="button"
        class="action-btn"
        disabled
        title="Re-run isn't implemented yet — needs meta-runtime resumability (Tier 2)"
      >
        Re-run
      </button>
      <button
        type="button"
        class="action-btn"
        disabled
        title="Cancel isn't implemented yet — operations are synchronous in Tier 0"
      >
        Cancel
      </button>
    </div>
  </header>

  <dl class="envelope">
    <dt>Started</dt>
    <dd>
      <span class="abs">{fmt(data.operation.startedAt)}</span>
      <span class="rel">({fmtRelative(data.operation.startedAt)})</span>
    </dd>

    <dt>Duration</dt>
    <dd>{duration(data.operation.startedAt, data.operation.endedAt)}</dd>

    <dt>Actor</dt>
    <dd>
      <span class="actor-kind">{data.operation.actor.kind}</span>
      {#if data.operation.actor.email}
        {data.operation.actor.email}
      {:else}
        <code>{data.operation.actor.id}</code>
      {/if}
    </dd>

    {#if data.operation.parentOpId}
      <dt>Parent</dt>
      <dd>
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
        <a href={`/admin/operations/${data.operation.parentOpId}`}>
          <code>{data.operation.parentOpId}</code>
        </a>
      </dd>
    {/if}
  </dl>

  <section class="block">
    <h2>Input</h2>
    <pre class="json">{jsonPretty(data.operation.input)}</pre>
  </section>

  {#if data.operation.output}
    <section class="block">
      <h2>Output</h2>
      <pre class="json">{jsonPretty(data.operation.output)}</pre>
    </section>
  {/if}

  {#if data.operation.error}
    <section class="block error-block">
      <h2>Error</h2>
      <p class="error-kind"><code>{data.operation.error.kind}</code></p>
      <pre class="json">{data.operation.error.message}</pre>
    </section>
  {/if}

  <section class="block">
    <h2>
      Linked audit events
      <span class="count">({data.auditEvents.length})</span>
    </h2>

    {#if data.auditEvents.length === 0}
      <p class="empty">
        No audit events correlated to this operation. (The Loom is configured to write one per op —
        if you see this, the audit write may have soft-failed; check the Loom logs.)
      </p>
    {:else}
      <ul class="audit-list">
        {#each data.auditEvents as e (e.id)}
          <li class="audit-item">
            <div class="audit-head">
              <code class="audit-type">{e.type}</code>
              <span class={`pill ${statusClass(e.result)}`}>
                <span class="glyph">{statusGlyph(e.result)}</span>
                {e.result}
              </span>
              <span class="audit-time" title={e.time}>{fmt(e.time)}</span>
            </div>
            <dl class="audit-fields">
              <dt>actor</dt>
              <dd>
                <span class="actor-kind">{e.actorKind}</span>
                {e.actorDisplay || e.actorId}
              </dd>
              <dt>source</dt>
              <dd><code>{e.source}</code></dd>
              {#if e.subject}
                <dt>subject</dt>
                <dd>{e.subject}</dd>
              {/if}
              <dt>reason</dt>
              <dd>{e.reason}</dd>
            </dl>
            <details class="audit-data">
              <summary>data</summary>
              <pre class="json">{jsonPretty(e.data)}</pre>
            </details>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .head {
    margin: 0 0 1.5rem;
    max-width: 80rem;
  }

  .back {
    margin: 0 0 0.6rem;
    font-size: 0.85rem;
  }

  .back a {
    color: var(--text-mute);
    text-decoration: none;
  }

  .back a:hover {
    color: var(--cyan);
  }

  h1 {
    margin: 0 0 0.4rem;
    font-size: 1.4rem;
    font-weight: 600;
    color: var(--gold);
    display: flex;
    align-items: center;
    gap: 0.65rem;
    font-family: var(--font-prose);
  }

  h1 code.kind {
    background: transparent;
    color: var(--cyan);
    font-family: var(--font-mono);
    font-size: 1.1rem;
  }

  .op-id {
    margin: 0;
    color: var(--text-mute);
    font-size: 0.78rem;
    font-family: var(--font-mono);
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.8rem;
  }

  .action-btn {
    background: var(--bg-1);
    border: 1px solid var(--line);
    color: var(--text-mute);
    padding: 0.4rem 0.9rem;
    border-radius: 4px;
    font-family: var(--font-data);
    font-size: 0.85rem;
    cursor: not-allowed;
    opacity: 0.55;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.18rem 0.55rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: lowercase;
    letter-spacing: 0.02em;
    border: 1px solid var(--line);
    color: var(--text-mute);
    background: var(--bg-1);
    font-family: var(--font-data);
  }

  .pill .glyph {
    font-size: 0.85rem;
  }

  .pill.ok {
    color: var(--cyan);
    border-color: rgba(95, 207, 224, 0.4);
    background: rgba(95, 207, 224, 0.08);
  }

  .pill.warn {
    color: var(--gold);
    border-color: rgba(201, 169, 106, 0.45);
    background: rgba(201, 169, 106, 0.08);
  }

  .pill.bad {
    color: #d99;
    border-color: rgba(180, 64, 64, 0.5);
    background: rgba(120, 32, 32, 0.18);
  }

  .envelope {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.4rem 1.2rem;
    margin: 0 0 1.5rem;
    max-width: 80rem;
    font-size: 0.92rem;
    font-family: var(--font-data);
  }

  .envelope dt {
    color: var(--text-mute);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.7rem;
    align-self: baseline;
  }

  .envelope dd {
    margin: 0;
    color: var(--text-secondary);
  }

  .envelope dd code {
    background: var(--bg-1);
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 1px 6px;
    font-family: var(--font-mono);
    font-size: 0.88em;
  }

  .actor-kind {
    color: var(--text-mute);
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-right: 0.45rem;
  }

  .abs {
    color: var(--text-secondary);
  }

  .rel {
    color: var(--text-mute);
    margin-left: 0.4rem;
    font-size: 0.85em;
  }

  .block {
    margin: 0 0 1.5rem;
    max-width: 80rem;
  }

  .block h2 {
    color: var(--gold-dim);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin: 0 0 0.5rem;
    font-weight: 600;
  }

  .block h2 .count {
    color: var(--text-mute);
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    margin-left: 0.4rem;
    font-size: 0.85em;
  }

  .json {
    background: var(--bg-1);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 0.7rem 0.9rem;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 0.82rem;
    line-height: 1.55;
    overflow-x: auto;
    margin: 0;
    white-space: pre;
    max-height: 30rem;
    overflow-y: auto;
  }

  .error-block .error-kind {
    margin: 0 0 0.4rem;
    font-family: var(--font-mono);
    font-size: 0.88rem;
  }

  .error-block .error-kind code {
    background: rgba(120, 32, 32, 0.18);
    border: 1px solid rgba(180, 64, 64, 0.5);
    color: #d99;
    padding: 0.15rem 0.45rem;
    border-radius: 3px;
  }

  .empty {
    color: var(--text-mute);
    font-size: 0.92rem;
    font-style: italic;
    font-family: var(--font-prose);
    line-height: 1.55;
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

  .audit-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .audit-item {
    background: var(--bg-1);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0.85rem 1rem;
  }

  .audit-head {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    margin: 0 0 0.5rem;
    flex-wrap: wrap;
  }

  .audit-type {
    color: var(--cyan-dim);
    font-family: var(--font-mono);
    font-size: 0.9rem;
    background: transparent;
  }

  .audit-time {
    color: var(--text-mute);
    font-size: 0.78rem;
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }

  .audit-fields {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 1rem;
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
  }

  .audit-fields dt {
    color: var(--text-mute);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.66rem;
    align-self: baseline;
  }

  .audit-fields dd {
    margin: 0;
    color: var(--text-secondary);
  }

  .audit-fields dd code {
    background: var(--bg-1);
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 1px 5px;
    font-family: var(--font-mono);
    font-size: 0.86em;
  }

  .audit-data {
    margin-top: 0.4rem;
  }

  .audit-data summary {
    color: var(--text-mute);
    font-size: 0.78rem;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
  }

  .audit-data[open] summary {
    color: var(--gold-dim);
    margin-bottom: 0.4rem;
  }
</style>
