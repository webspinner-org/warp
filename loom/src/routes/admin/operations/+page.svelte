<script lang="ts">
  let { data } = $props();

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
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  function durationMs(startIso: string, endIso: string): string {
    const a = new Date(startIso).getTime();
    const b = new Date(endIso).getTime();
    if (Number.isNaN(a) || Number.isNaN(b)) return '—';
    const ms = b - a;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
  }

  function statusClass(s: string): string {
    if (s === 'ok') return 'ok';
    if (s === 'partial') return 'warn';
    if (s === 'failed') return 'bad';
    return '';
  }

  function statusGlyph(s: string): string {
    if (s === 'ok') return '✓';
    if (s === 'partial') return '⚠';
    if (s === 'failed') return '✗';
    return '·';
  }

  function parseQuery(search: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (!search) return out;
    const trimmed = search.startsWith('?') ? search.slice(1) : search;
    for (const part of trimmed.split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      const key = eq < 0 ? part : part.slice(0, eq);
      const val = eq < 0 ? '' : part.slice(eq + 1);
      out[decodeURIComponent(key)] = decodeURIComponent(val);
    }
    return out;
  }

  function buildQuery(params: Record<string, string>): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      if (v.length === 0) continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
    return parts.join('&');
  }

  function navigate(extra: Record<string, string>) {
    const params = parseQuery(window.location.search);
    for (const [k, v] of Object.entries(extra)) {
      if (v) params[k] = v;
      else delete params[k];
    }
    if (!('cursor' in extra)) delete params['cursor'];
    const qs = buildQuery(params);
    window.location.href = qs ? `/admin/operations?${qs}` : '/admin/operations';
  }

  function toggleMulti(key: string, value: string) {
    const params = parseQuery(window.location.search);
    const current = (params[key] ?? '').split(',').filter((s) => s.length > 0);
    const idx = current.indexOf(value);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(value);
    if (current.length > 0) params[key] = current.join(',');
    else delete params[key];
    delete params['cursor'];
    const qs = buildQuery(params);
    window.location.href = qs ? `/admin/operations?${qs}` : '/admin/operations';
  }

  function isSelected(key: 'kinds' | 'statuses' | 'actorKinds', value: string): boolean {
    return data.filters[key].includes(value as never);
  }

  function shortSubject(s: string): string {
    if (!s) return '—';
    // Trim long bundle paths to last two segments for readability.
    if (s.startsWith('/') || s.startsWith('~')) {
      const parts = s.split('/');
      if (parts.length > 3) return '…/' + parts.slice(-2).join('/');
    }
    return s;
  }
</script>

<header class="head">
  <h1>Operations</h1>
  <p class="lede">
    The meta-runtime's record of work it did on your behalf. Each row is one
    <code>wp_operations</code>
    envelope; click any row to see the linked audit events. Failures and partials are surfaced here so
    you can see what's gone sideways and why.
  </p>
</header>

{#if data.setupError}
  <p class="error" role="alert">{data.setupError}</p>
{/if}

<section class="controls">
  <div class="field-group">
    <span class="group-label">Kind</span>
    <div class="chip-row">
      {#each data.options.kinds as k (k)}
        <button
          type="button"
          class="chip"
          class:active={isSelected('kinds', k)}
          onclick={() => toggleMulti('kinds', k)}
        >
          {k}
        </button>
      {/each}
    </div>
  </div>

  <div class="field-group">
    <span class="group-label">Status</span>
    <div class="chip-row">
      {#each data.options.statuses as s (s)}
        <button
          type="button"
          class="chip"
          class:active={isSelected('statuses', s)}
          onclick={() => toggleMulti('statuses', s)}
        >
          {statusGlyph(s)}
          {s}
        </button>
      {/each}
    </div>
  </div>

  <div class="field-group">
    <span class="group-label">Actor</span>
    <div class="chip-row">
      {#each data.options.actorKinds as a (a)}
        <button
          type="button"
          class="chip"
          class:active={isSelected('actorKinds', a)}
          onclick={() => toggleMulti('actorKinds', a)}
        >
          {a}
        </button>
      {/each}
    </div>
  </div>

  <label class="field">
    <span class="group-label">Since</span>
    <select onchange={(e) => navigate({ since: (e.currentTarget as HTMLSelectElement).value })}>
      {#each data.options.sinceChoices as c (c)}
        <option
          value={c === 'all' ? '' : c}
          selected={(c === 'all' ? '' : c) === data.filters.since}>{c}</option
        >
      {/each}
    </select>
  </label>

  <label class="field">
    <span class="group-label">Window</span>
    <select onchange={(e) => navigate({ limit: (e.currentTarget as HTMLSelectElement).value })}>
      {#each data.options.limits as n (n)}
        <option value={n} selected={n === data.filters.limit}>last {n}</option>
      {/each}
    </select>
  </label>
</section>

{#if data.rows.length === 0}
  <p class="empty">
    {data.filters.kinds.length > 0 ||
    data.filters.statuses.length > 0 ||
    data.filters.actorKinds.length > 0
      ? 'No operations match the active filters. Clear chips above to widen the view.'
      : 'No operations recorded yet. The Loom will write one row here for every sign, verify, publish, install, or runner-dispatch the meta-runtime performs.'}
  </p>
{:else}
  <table class="ops-table">
    <thead>
      <tr>
        <th>When</th>
        <th>Kind</th>
        <th>Status</th>
        <th>Duration</th>
        <th>Actor</th>
        <th>Subject</th>
        <th class="chev"></th>
      </tr>
    </thead>
    <tbody>
      {#each data.rows as r (r.opId)}
        <tr
          class="row"
          tabindex="0"
          role="link"
          onclick={() => (window.location.href = `/admin/operations/${r.opId}`)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              window.location.href = `/admin/operations/${r.opId}`;
            }
          }}
        >
          <td class="time" title={r.startedAt}>{fmtRelative(r.startedAt)}</td>
          <td class="kind"><code>{r.kind}</code></td>
          <td>
            <span class={`pill ${statusClass(r.status)}`}>
              <span class="glyph">{statusGlyph(r.status)}</span>
              {r.status}
            </span>
            {#if r.errorKind}
              <span class="err-kind" title="error kind">{r.errorKind}</span>
            {/if}
          </td>
          <td class="duration">{durationMs(r.startedAt, r.endedAt)}</td>
          <td class="actor">
            <span class="actor-kind">{r.actorKind}</span>
            {r.actorEmail || r.actorId}
          </td>
          <td class="subject">{shortSubject(r.subject)}</td>
          <td class="chev">→</td>
        </tr>
      {/each}
    </tbody>
  </table>

  {#if data.nextCursor}
    <div class="pagination">
      <button
        type="button"
        class="page-btn"
        onclick={() => navigate({ cursor: data.nextCursor as string })}
      >
        Older →
      </button>
    </div>
  {/if}
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
    gap: 1.5rem;
    flex-wrap: wrap;
    margin: 0 0 1.5rem;
    max-width: 96rem;
    align-items: flex-start;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .group-label {
    color: var(--text-mute);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.66rem;
    font-weight: 600;
  }

  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .chip {
    background: var(--bg-1);
    border: 1px solid var(--line);
    color: var(--text-dim);
    padding: 0.3rem 0.7rem;
    border-radius: 999px;
    font-family: var(--font-data);
    font-size: 0.78rem;
    cursor: pointer;
    transition:
      border-color 0.1s ease,
      color 0.1s ease;
  }

  .chip:hover {
    border-color: var(--gold-dim);
    color: var(--text-secondary);
  }

  .chip.active {
    border-color: var(--cyan);
    background: rgba(95, 207, 224, 0.08);
    color: var(--cyan);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .field select {
    background: var(--bg-1);
    border: 1px solid var(--line);
    color: var(--text);
    padding: 0.35rem 0.55rem;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.85rem;
    min-width: 8rem;
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

  .ops-table {
    width: 100%;
    max-width: 96rem;
    border-collapse: collapse;
    font-size: 0.86rem;
    font-family: var(--font-data);
  }

  .ops-table th {
    text-align: left;
    padding: 0.5rem 0.75rem;
    color: var(--gold-dim);
    border-bottom: 1px solid var(--line);
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
  }

  .ops-table td {
    padding: 0.65rem 0.75rem;
    border-bottom: 1px solid var(--line);
    color: var(--text-secondary);
    vertical-align: top;
  }

  .row {
    cursor: pointer;
  }

  .row:hover {
    background: rgba(95, 207, 224, 0.04);
  }

  .row:focus-visible {
    outline: 2px solid var(--cyan);
    outline-offset: -2px;
  }

  .time {
    white-space: nowrap;
    color: var(--text-mute);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    width: 7rem;
  }

  .duration {
    white-space: nowrap;
    color: var(--text-mute);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    width: 5rem;
  }

  .kind code {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--cyan-dim);
    font-family: var(--font-mono);
    font-size: 0.92em;
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

  .err-kind {
    margin-left: 0.4rem;
    color: var(--text-mute);
    font-size: 0.72rem;
    font-family: var(--font-mono);
  }

  .actor-kind {
    display: inline-block;
    color: var(--text-mute);
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-right: 0.45rem;
  }

  .subject {
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 0.85em;
    max-width: 28rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chev {
    color: var(--text-mute);
    text-align: right;
    width: 2rem;
  }

  .pagination {
    display: flex;
    justify-content: center;
    margin: 1.5rem 0;
  }

  .page-btn {
    background: var(--bg-1);
    border: 1px solid var(--line);
    color: var(--text-secondary);
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-family: var(--font-data);
    font-size: 0.9rem;
  }

  .page-btn:hover {
    border-color: var(--cyan);
    color: var(--cyan);
  }
</style>
