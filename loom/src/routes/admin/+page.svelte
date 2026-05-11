<script lang="ts">
  let { data } = $props();

  function fmtDate(iso: string): string {
    if (!iso || iso === '?') return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  function fmtShortDate(iso: string): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return iso.slice(0, 10);
    }
  }
</script>

<header class="hero">
  <div class="hero-text">
    <h1>Webspinner Foundation Cell</h1>
    <p class="lede">
      Signed in as <strong>{data.user.email}</strong>. The Cell is yours to operate.
    </p>
  </div>
  <div class="hero-stats">
    {#if data.latestTag}
      <div class="stat">
        <span class="value">{data.latestTag}</span>
        <span class="label">Release</span>
      </div>
    {/if}
    <div class="stat">
      <span class="value"><code>{data.head.hash}</code></span>
      <span class="label">commit</span>
    </div>
    <div class="stat">
      <span class="value">{data.spinnerCount}</span>
      <span class="label">Spinner{data.spinnerCount === 1 ? '' : 's'}</span>
    </div>
    <div class="stat">
      <span class="value">{data.journal.total}</span>
      <span class="label">Journal entr{data.journal.total === 1 ? 'y' : 'ies'}</span>
    </div>
    <div class="stat">
      <span class="value">{data.loom.uptimeLabel}</span>
      <span class="label">Loom up</span>
    </div>
  </div>
</header>

<section class="actions">
  <h2>Try this</h2>
  <div class="action-grid">
    <a class="action" href="/admin/spinners/bootstrap">
      <span class="action-eyebrow">Bootstrap Spinner</span>
      <span class="action-title">Ask a question</span>
      <span class="action-body">
        Have a conversation with the Cell about the canon. <code>consult</code> grounds every answer
        in retrieved passages from <code>WARP-CANON.md</code> and the manuscript.
      </span>
      <span class="action-cta">Open Bootstrap →</span>
    </a>

    <a class="action" href="/admin/journal">
      <span class="action-eyebrow">Wizard's Journal · ⌘⇧J</span>
      <span class="action-title">Write an entry</span>
      <span class="action-body">
        Capture an action, a decision, a problem, a learning. The journal is the substrate for next-session
        bootstrap — <code>tools/wj bootstrap --write</code> drops a context block into
        <code>BOOTSTRAP.md</code> for the next Claude session.
      </span>
      <span class="action-cta">Open Journal →</span>
    </a>

    <button class="action" type="button" onclick={() => {
      // Trigger the Pablo button in the ribbon (shared layout state via event)
      const ev = new KeyboardEvent('keydown', { key: 'p', metaKey: true, shiftKey: true });
      window.dispatchEvent(ev);
    }}>
      <span class="action-eyebrow">Pablo · ⌘⇧P</span>
      <span class="action-title">Review this page</span>
      <span class="action-body">
        Send the rendered surface to Pablo — Foundation design-quality reviewer. Severity-tagged
        findings cited to <code>library/contrast.md</code>, <code>typography.md</code>,
        <code>composition.md</code>, and the rest of the cited library.
      </span>
      <span class="action-cta">Send to Pablo →</span>
    </button>
  </div>
</section>

<section class="two-col">
  <article class="commits">
    <h2>Recently shipped</h2>
    {#if data.recentCommits.length === 0}
      <p class="muted">No git history found.</p>
    {:else}
      <ol>
        {#each data.recentCommits as c (c.hash)}
          <li>
            <span class="commit-hash"><code>{c.hash}</code></span>
            <span class="commit-subject">{c.subject}</span>
            <span class="commit-date">{fmtShortDate(c.timestamp)}</span>
          </li>
        {/each}
      </ol>
    {/if}
  </article>

  <article class="journal-preview">
    <h2>Recent journal entries</h2>
    {#if data.journal.recent.length === 0}
      <p class="muted">
        No entries yet. Open <a href="/admin/journal">the Journal</a> and write the first one — your
        founding entry becomes the seed of every next-session bootstrap.
      </p>
    {:else}
      <ul>
        {#each data.journal.recent as e (e.id)}
          <li>
            <span class={`kind kind-${e.kind}`}>{e.kind}</span>
            <span class="entry-title">{e.title}</span>
            <span class="entry-date">{fmtShortDate(e.timestamp)}</span>
          </li>
        {/each}
      </ul>
      <p class="see-more">
        <a href="/admin/journal">Open the Journal →</a>
      </p>
    {/if}
  </article>
</section>

<section class="roster">
  <h2>Spinners in this Skein</h2>
  {#if data.spinnerSummaries.length === 0}
    <p class="muted">No Spinners registered.</p>
  {:else}
    <ul class="roster-list">
      {#each data.spinnerSummaries as s (s.slug)}
        <li>
          <a href={`/admin/spinners/${s.slug}`}>
            <strong>{s.displayName}</strong>
            <span class="capability-count">{s.capabilityCount} capabilit{s.capabilityCount === 1 ? 'y' : 'ies'}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<details class="cell-config">
  <summary>Cell roles + reach + federation</summary>
  <section class="cards">
    <article>
      <h3>Cell roles</h3>
      <dl>
        <dt>Loom</dt>
        <dd>this app — SvelteKit (Node) on Kepler</dd>
        <dt>Weaver</dt>
        <dd>bootstrap Weaver in the Loom (canonical Python+FastAPI pending)</dd>
        <dt>Grimoire</dt>
        <dd>PocketBase 0.38.0 (bootstrap)</dd>
      </dl>
    </article>
    <article>
      <h3>Reach</h3>
      <dl>
        <dt>LAN</dt>
        <dd>Kepler over the home network</dd>
        <dt>Tailnet</dt>
        <dd>Spindle ↔ Kepler when away</dd>
        <dt>Public</dt>
        <dd>None — bootstrap topology</dd>
      </dl>
    </article>
    <article>
      <h3>Federation</h3>
      <dl>
        <dt>Peers</dt>
        <dd>None — single-Cell bootstrap</dd>
        <dt>Capability Bus</dt>
        <dd>spec pending</dd>
        <dt>Public surface</dt>
        <dd>Deferred until summer 2026</dd>
      </dl>
    </article>
  </section>
</details>

<style>
  /* ── Hero ──────────────────────────────────────────────────────── */
  .hero {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2rem;
    align-items: end;
    margin: 0 0 2.5rem;
    padding: 0 0 1.5rem;
    border-bottom: 1px solid var(--line, #1f1f1f);
    max-width: 72rem;
  }

  h1 {
    margin: 0 0 0.4rem;
    font-size: 1.8rem;
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

  .lede strong {
    color: var(--gold-bright);
    font-style: normal;
    font-weight: 600;
  }

  .hero-stats {
    display: flex;
    gap: 1.4rem;
    flex-wrap: wrap;
    align-items: flex-end;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.1rem;
  }

  .stat .value {
    color: var(--gold);
    font-family: var(--font-prose);
    font-size: 1.4rem;
    font-weight: 600;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .stat .value code {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--gold);
    font-family: var(--font-mono);
    font-size: 0.88em;
  }

  .stat .label {
    color: var(--text-mute);
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-weight: 600;
  }

  /* ── Action grid ───────────────────────────────────────────────── */
  section {
    max-width: 72rem;
    margin-bottom: 2.5rem;
  }

  section h2 {
    margin: 0 0 1rem;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--cyan);
    font-weight: 600;
  }

  .action-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.25rem;
  }

  .action {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 1.25rem 1.4rem;
    background: linear-gradient(180deg, #131311 0%, #0e0e0c 100%);
    border: 1px solid #2a2418;
    border-radius: 10px;
    text-decoration: none;
    color: inherit;
    text-align: left;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
  }

  .action:hover {
    border-color: var(--gold-dim);
    transform: translateY(-1px);
    box-shadow: 0 6px 24px -8px rgba(201, 169, 106, 0.18);
  }

  .action-eyebrow {
    color: var(--gold-dim);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-weight: 600;
  }

  .action-title {
    color: var(--gold);
    font-family: var(--font-prose);
    font-size: 1.2rem;
    font-weight: 600;
    line-height: 1.2;
  }

  .action-body {
    color: var(--text-secondary);
    font-size: 0.92rem;
    line-height: 1.55;
    font-family: var(--font-data);
  }

  .action-body code {
    background: var(--bg-1, #111);
    border: 1px solid var(--line, #1f1f1f);
    border-radius: 3px;
    padding: 1px 5px;
    font-family: var(--font-mono);
    font-size: 0.85em;
    color: var(--text-secondary);
  }

  .action-cta {
    color: var(--cyan);
    font-size: 0.85rem;
    margin-top: auto;
    padding-top: 0.4rem;
    letter-spacing: 0.02em;
  }

  /* ── Two-column: commits + journal ─────────────────────────────── */
  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }

  @media (max-width: 800px) {
    .two-col {
      grid-template-columns: 1fr;
    }
  }

  .commits ol, .journal-preview ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .commits li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.65rem;
    align-items: baseline;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--line, #1f1f1f);
    font-size: 0.88rem;
  }

  .commits li:last-child {
    border-bottom: 0;
  }

  .commit-hash code {
    color: var(--gold);
    background: transparent;
    border: 0;
    padding: 0;
    font-family: var(--font-mono);
    font-size: 0.88em;
  }

  .commit-subject {
    color: var(--text-secondary);
    font-family: var(--font-data);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .commit-date {
    color: var(--text-mute);
    font-size: 0.74rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .journal-preview li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.65rem;
    align-items: baseline;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--line, #1f1f1f);
    font-size: 0.88rem;
  }

  .journal-preview li:last-child {
    border-bottom: 0;
  }

  .kind {
    display: inline-block;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
    border: 1px solid currentColor;
    line-height: 1.4;
  }
  .kind-action { color: var(--cyan-dim, #4ba9b8); background: rgba(95, 207, 224, 0.06); }
  .kind-decision { color: var(--gold); background: #1a160a; }
  .kind-problem { color: #f88; background: #2a0808; }
  .kind-learning { color: #9fd99f; background: #0d1a0d; }
  .kind-note { color: var(--text-mute); }

  .entry-title {
    color: var(--text-secondary);
    font-family: var(--font-prose);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-date {
    color: var(--text-mute);
    font-size: 0.74rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .muted {
    color: var(--text-mute);
    font-size: 0.92rem;
    line-height: 1.55;
    font-family: var(--font-prose);
    font-style: italic;
  }

  .muted a {
    color: var(--cyan);
    text-decoration: none;
  }

  .muted a:hover {
    text-decoration: underline;
  }

  .see-more {
    margin: 0.85rem 0 0;
    font-size: 0.85rem;
  }

  .see-more a {
    color: var(--cyan);
    text-decoration: none;
  }

  .see-more a:hover {
    text-decoration: underline;
  }

  /* ── Spinner roster ────────────────────────────────────────────── */
  .roster-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.6rem;
  }

  .roster-list a {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.65rem 0.85rem;
    border: 1px solid var(--line, #1f1f1f);
    border-radius: 6px;
    text-decoration: none;
    background: var(--bg-1, #111);
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .roster-list a:hover {
    border-color: var(--gold-dim);
    background: rgba(201, 169, 106, 0.04);
  }

  .roster-list strong {
    color: var(--gold);
    font-weight: 600;
    font-family: var(--font-prose);
    font-size: 0.95rem;
  }

  .capability-count {
    color: var(--text-mute);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  /* ── Cell config disclosure ────────────────────────────────────── */
  .cell-config {
    margin-top: 2rem;
    max-width: 72rem;
  }

  .cell-config summary {
    cursor: pointer;
    color: var(--text-mute);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--line, #1f1f1f);
    font-weight: 600;
  }

  .cell-config summary:hover {
    color: var(--text);
  }

  .cell-config .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
    margin-top: 1.25rem;
  }

  .cell-config article {
    background: #111;
    border: 1px solid #1f1f1f;
    border-radius: 8px;
    padding: 1.2rem 1.4rem;
  }

  .cell-config h3 {
    margin: 0 0 1rem;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--cyan);
    font-weight: 600;
  }

  .cell-config dl {
    margin: 0;
    display: grid;
    grid-template-columns: 7rem 1fr;
    gap: 0.85rem 1.25rem;
    font-size: 0.92rem;
    line-height: 1.5;
  }

  .cell-config dt {
    color: var(--gold-dim);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
    padding-top: 0.18rem;
    font-family: var(--font-data);
  }

  .cell-config dd {
    margin: 0;
    color: var(--text-secondary);
    font-family: var(--font-data);
  }
</style>
