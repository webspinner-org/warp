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

  function resultClass(r: string): string {
    if (r === 'success') return 'ok';
    if (r === 'denied') return 'warn';
    if (r === 'error') return 'bad';
    return '';
  }

  function navigate(extra: Record<string, string>) {
    const params = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    const qs = params.toString();
    window.location.href = qs ? `/admin/audit?${qs}` : '/admin/audit';
  }
</script>

<header class="head">
  <h1>Audit log</h1>
  <p class="lede">
    Every Spinner invocation, every privileged Loom action — emitted as a CloudEvents-shaped
    record in the <code>wp_audit</code> collection. {data.total} entries total; showing the
    {data.events.length} most recent.
  </p>
</header>

{#if data.setupError}
  <p class="error" role="alert">{data.setupError}</p>
{/if}

<section class="controls">
  <label class="field">
    <span>Filter by event type</span>
    <select onchange={(e) => navigate({ type: (e.currentTarget as HTMLSelectElement).value })}>
      <option value="" selected={!data.eventType}>(all types)</option>
      {#each data.distinctTypes as t}
        <option value={t} selected={t === data.eventType}>{t}</option>
      {/each}
    </select>
  </label>
  <label class="field">
    <span>Filter by result</span>
    <select onchange={(e) => navigate({ result: (e.currentTarget as HTMLSelectElement).value })}>
      <option value="" selected={!data.result}>(all results)</option>
      {#each data.distinctResults as r}
        <option value={r} selected={r === data.result}>{r}</option>
      {/each}
    </select>
  </label>
  <label class="field">
    <span>Window</span>
    <select onchange={(e) => navigate({ limit: (e.currentTarget as HTMLSelectElement).value })}>
      {#each [25, 50, 100, 200] as n}
        <option value={n} selected={n === data.limit}>last {n}</option>
      {/each}
    </select>
  </label>
</section>

{#if data.events.length === 0}
  <p class="empty">
    No events match. {data.eventType || data.result
      ? 'Clear the filters above to widen the view.'
      : 'The Grimoire has no audit records yet — invoke a Spinner to generate the first entries.'}
  </p>
{:else}
  <table class="audit-table">
    <thead>
      <tr>
        <th>When</th>
        <th>Type</th>
        <th>Source</th>
        <th>Subject</th>
        <th>Actor</th>
        <th>Result</th>
        <th>Reason</th>
      </tr>
    </thead>
    <tbody>
      {#each data.events as e (e.id)}
        <tr>
          <td class="time">{fmt(e.time)}</td>
          <td class="type"><code>{e.type}</code></td>
          <td class="source"><code>{e.source.replace('wp://spinner/', '')}</code></td>
          <td class="subject">{e.subject || '—'}</td>
          <td class="actor">
            <span class="actor-kind">{e.actorKind}</span>
            {e.actorDisplay || e.actorId}
          </td>
          <td><span class={`pill ${resultClass(e.result)}`}>{e.result}</span></td>
          <td class="reason">{e.reason}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .head {
    margin: 0 0 1.5rem;
    max-width: 72rem;
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
    max-width: 64ch;
    font-family: var(--font-prose);
    font-style: italic;
  }

  .lede code {
    background: var(--bg-1);
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 1px 5px;
    font-family: var(--font-mono);
    font-size: 0.85em;
    color: var(--text-secondary);
    font-style: normal;
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

  .controls {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    margin: 0 0 1rem;
    max-width: 72rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.78rem;
  }

  .field > span {
    color: var(--text-mute);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.66rem;
    font-weight: 600;
  }

  .field select {
    background: var(--bg-1);
    border: 1px solid var(--line);
    color: var(--text);
    padding: 0.45rem 0.65rem;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.88rem;
    min-width: 12rem;
  }

  .empty {
    color: var(--text-mute);
    font-size: 0.95rem;
    margin: 1.5rem 0;
    line-height: 1.55;
    max-width: 60ch;
    font-family: var(--font-prose);
    font-style: italic;
  }

  .audit-table {
    width: 100%;
    max-width: 96rem;
    border-collapse: collapse;
    font-size: 0.84rem;
    font-family: var(--font-data);
  }

  .audit-table th {
    text-align: left;
    padding: 0.5rem 0.75rem;
    color: var(--gold-dim);
    border-bottom: 1px solid var(--line);
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
  }

  .audit-table td {
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--line);
    color: var(--text-secondary);
    vertical-align: top;
  }

  .audit-table tbody tr:hover {
    background: rgba(95, 207, 224, 0.04);
  }

  .time {
    white-space: nowrap;
    color: var(--text-mute);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }

  .type code, .source code {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 0.92em;
  }

  .source code {
    color: var(--cyan-dim);
  }

  .actor-kind {
    display: inline-block;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-mute);
    border: 1px solid var(--line);
    margin-right: 0.4rem;
  }

  .subject {
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 0.82rem;
    word-break: break-all;
  }

  .reason {
    color: var(--text-secondary);
    font-family: var(--font-prose);
    max-width: 30rem;
  }

  .pill {
    display: inline-block;
    padding: 0.05rem 0.55rem;
    border-radius: 999px;
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
    border: 1px solid currentColor;
    line-height: 1.5;
    color: var(--text-mute);
  }

  .pill.ok { color: #9fd99f; background: #0d1a0d; border-color: #2a4020; }
  .pill.warn { color: var(--gold); background: #1a160a; border-color: #3a3220; }
  .pill.bad { color: #f88; background: #2a0808; border-color: #602020; }
</style>
