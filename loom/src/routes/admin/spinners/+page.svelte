<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';

  let { data } = $props();

  let q = $state('');
  let filter = $state<'all' | 'threadable' | 'verified' | 'pending'>('all');
  // Demos (build-loop test artifacts) hidden by default. Patrons see
  // canonical state. Wizard toggles to inspect / sweep.
  let showDemos = $state(false);
  let sweeping = $state(false);
  let sweepMessage = $state('');

  const demoCount = $derived(data.spinners.filter((s) => s.isDemo).length);

  const visible = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    return data.spinners.filter((s) => {
      if (!showDemos && s.isDemo) return false;
      if (needle.length > 0) {
        const hay = `${s.displayName} ${s.name} ${s.description ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (filter === 'threadable' && !s.threadable) return false;
      if (filter === 'verified' && s.integrityStatus !== 'verified') return false;
      if (filter === 'pending' && s.integrityStatus !== 'pending-install') return false;
      return true;
    });
  });

  // Trust display = (source, integrity) considered together.
  // Genesis Spinners with `unsigned` integrity are technically accurate
  // (the Foundation release key doesn't exist during bootstrap) but
  // UX-wrong: they ship in the canonical warp repo, which IS the
  // Foundation's trust assertion for the bootstrap epoch. Present them
  // as "Foundation" rather than as a warning. Same treatment for
  // explicit foundation-recognized rows once those land post-federation.
  function trustLabel(status: string, source: string): string {
    if ((source === 'genesis' || source === 'foundation-recognized') && status === 'unsigned') {
      return 'Foundation';
    }
    switch (status) {
      case 'verified':
        return 'Verified';
      case 'unsigned':
        return 'Unsigned';
      case 'pending-install':
        return 'Pending install';
      case 'digest-mismatch':
        return 'Tampered';
      case 'signature-invalid':
        return 'Signature invalid';
      default:
        return status;
    }
  }

  function trustClass(status: string, source: string): string {
    if ((source === 'genesis' || source === 'foundation-recognized') && status === 'unsigned') {
      return 'foundation';
    }
    switch (status) {
      case 'verified':
        return 'ok';
      case 'unsigned':
      case 'pending-install':
        return 'warn';
      case 'digest-mismatch':
      case 'signature-invalid':
        return 'bad';
      default:
        return '';
    }
  }

  function sourceLabel(source: string): string {
    switch (source) {
      case 'genesis':
        return 'Genesis';
      case 'cell-authored':
        return 'Cell';
      case 'foundation-recognized':
        return 'Foundation';
      case 'third-party':
        return '3rd-party';
      default:
        return source;
    }
  }
</script>

<header class="head">
  <div class="head-row">
    <h1>Skein</h1>
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
    <a href="/admin/spinners/new" class="new-button">+ New Spinner</a>
  </div>
  <p class="lede">
    {data.spinners.length} Spinner{data.spinners.length === 1 ? '' : 's'} registered with this Cell —
    each integrity-checked, each runnable only through the Weaver.
  </p>
</header>

<div class="controls">
  <div class="search-field">
    <label for="skein-search" class="search-label">Search</label>
    <div class="search">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        id="skein-search"
        type="search"
        bind:value={q}
        placeholder="name, description, capability"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
  </div>

  <div class="filters" role="tablist" aria-label="Filter Spinners">
    <button
      role="tab"
      aria-selected={filter === 'all'}
      class:active={filter === 'all'}
      onclick={() => (filter = 'all')}>All</button
    >
    <button
      role="tab"
      aria-selected={filter === 'verified'}
      class:active={filter === 'verified'}
      onclick={() => (filter = 'verified')}>Verified</button
    >
    <button
      role="tab"
      aria-selected={filter === 'threadable'}
      class:active={filter === 'threadable'}
      onclick={() => (filter = 'threadable')}>Threadable</button
    >
    <button
      role="tab"
      aria-selected={filter === 'pending'}
      class:active={filter === 'pending'}
      onclick={() => (filter = 'pending')}>Pending install</button
    >
  </div>

  <span class="count" aria-live="polite">
    {visible.length} of {data.spinners.length}
  </span>
</div>

{#if demoCount > 0}
  <div class="demos-bar">
    <span class="demos-note">
      {demoCount} demo{demoCount === 1 ? '' : 's'} hidden — build-loop test artifacts from Author runs.
    </span>
    <label class="demos-toggle">
      <input type="checkbox" bind:checked={showDemos} />
      <span>Show demos</span>
    </label>
    <form
      method="POST"
      action="?/sweepDemos"
      use:enhance={() => {
        sweeping = true;
        sweepMessage = '';
        return async ({ result, update }) => {
          sweeping = false;
          if (result.type === 'success' && result.data) {
            const d = result.data as { swept?: number; errors?: number };
            sweepMessage = `Swept ${d.swept ?? 0} demo${d.swept === 1 ? '' : 's'}${d.errors ? ` (${d.errors} errors — see logs)` : ''}.`;
          }
          await update();
          await invalidateAll();
        };
      }}
    >
      <button type="submit" class="sweep-btn" disabled={sweeping}>
        {sweeping ? 'Sweeping…' : 'Sweep demos'}
      </button>
    </form>
    {#if sweepMessage}
      <span class="sweep-msg">{sweepMessage}</span>
    {/if}
  </div>
{/if}

{#if data.spinners.length === 0}
  <p class="empty">
    No Spinners registered. Drop a bundle in <code>~/warp/spinners/&lt;name&gt;/</code> with a
    <code>manifest.json</code>, a <code>mission-lock.md</code>, and a <code>how-it-works.md</code>.
  </p>
{:else if visible.length === 0}
  <p class="empty">No Spinners match this filter.</p>
{:else}
  <ul class="list">
    {#each visible as s (s.slug)}
      <li class:demo-row={s.isDemo}>
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
        <a href={`/admin/spinners/${s.slug}`} class="row">
          <span class="icon" aria-hidden="true">
            <img
              src={`/admin/spinners/${s.slug}/thumbnail`}
              alt=""
              loading="lazy"
              decoding="async"
            />
          </span>
          <span class="main">
            <span class="title-row">
              <strong>{s.displayName}</strong>
              <span class={`pill ${trustClass(s.integrityStatus, s.source)}`}
                >{trustLabel(s.integrityStatus, s.source)}</span
              >
              <span class="source-chip" title={`source: ${s.source}`}>{sourceLabel(s.source)}</span>
              {#if s.isDemo}
                <span class="demo-chip" title="Build-loop test artifact — Author testRun output"
                  >demo</span
                >
              {/if}
            </span>
            <span class="meta">
              <code>{s.name}</code>
              <span class="dot">·</span>
              <span>v{s.version}</span>
              <span class="dot">·</span>
              <span>{s.capabilityCount} capabilit{s.capabilityCount === 1 ? 'y' : 'ies'}</span>
              {#if s.threadable}
                <span class="dot">·</span>
                <span class="threadable">threadable</span>
              {/if}
            </span>
            {#if s.description}
              <span class="desc">{s.description}</span>
            {/if}
          </span>
          <span class="chev" aria-hidden="true">›</span>
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .head {
    margin: 0 0 1.25rem;
    max-width: 64rem;
  }

  .head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .new-button {
    background: var(--bg-1);
    border: 1px solid var(--gold-dim);
    color: var(--gold);
    padding: 0.5rem 0.95rem;
    border-radius: 5px;
    text-decoration: none;
    font-family: inherit;
    font-size: 0.88rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    transition:
      border-color 0.12s ease,
      background 0.12s ease;
  }
  .new-button:hover {
    border-color: var(--gold);
    background: rgba(201, 169, 106, 0.08);
  }

  h1 {
    margin: 0 0 0.3rem;
    font-size: 1.6rem;
    font-weight: 600;
    color: var(--gold);
    letter-spacing: 0.02em;
    font-family: 'Iowan Old Style', 'Hoefler Text', Georgia, serif;
  }

  .lede {
    margin: 0;
    color: var(--text-dim);
    font-size: 0.92rem;
    line-height: 1.55;
    max-width: 60ch;
    font-family: 'Iowan Old Style', 'Hoefler Text', Georgia, serif;
    font-style: italic;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    flex-wrap: wrap;
    margin: 0 0 1rem;
    max-width: 64rem;
    position: sticky;
    top: 0;
    background: var(--bg-0, #0a0a0a);
    padding: 0.5rem 0;
    z-index: 10;
    border-bottom: 1px solid var(--line, #1f1f1f);
  }

  .search-field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    flex: 1 1 22rem;
  }

  .search-label {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-mute);
    font-weight: 600;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--bg-1, #111);
    border: 1px solid var(--line, #1f1f1f);
    border-radius: 6px;
    padding: 0 0.7rem;
    transition: border-color 0.15s ease;
  }

  .search:focus-within {
    border-color: var(--cyan, #5fcfe0);
  }

  .search svg {
    color: var(--text-mute);
    flex-shrink: 0;
  }

  .search input {
    flex: 1;
    background: transparent;
    border: 0;
    color: var(--text);
    font-size: 0.9rem;
    padding: 0.5rem 0;
    font-family: inherit;
  }

  .search input::placeholder {
    color: var(--text-mute);
  }

  .search input:focus {
    outline: none;
  }

  .filters {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }

  .filters button {
    background: transparent;
    border: 1px solid var(--line, #1f1f1f);
    color: var(--text-mute);
    padding: 0.4rem 0.75rem;
    font-size: 0.78rem;
    border-radius: 999px;
    cursor: pointer;
    font-family: inherit;
    letter-spacing: 0.02em;
    transition:
      color 0.15s ease,
      border-color 0.15s ease,
      background 0.15s ease;
  }

  .filters button:hover {
    color: var(--text);
    border-color: #2a2a2a;
  }

  .filters button.active {
    color: var(--cyan, #5fcfe0);
    border-color: var(--cyan-dim, #4ba9b8);
    background: rgba(95, 207, 224, 0.06);
  }

  .count {
    color: var(--text-mute);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    margin-left: auto;
  }

  .empty {
    color: var(--text-mute);
    font-size: 0.92rem;
    margin: 1.5rem 0;
    max-width: 60ch;
    line-height: 1.55;
  }

  .empty code {
    background: var(--bg-1, #111);
    border: 1px solid var(--line, #1f1f1f);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 0.85em;
    color: var(--text-secondary, #cfcfcf);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-width: 64rem;
    border-top: 1px solid var(--line, #1f1f1f);
  }

  .list li {
    border-bottom: 1px solid var(--line, #1f1f1f);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.7rem 0.6rem;
    text-decoration: none;
    color: inherit;
    transition: background 0.12s ease;
    line-height: 1.5;
  }

  .row:hover {
    background: rgba(95, 207, 224, 0.04);
  }

  .row:focus-visible {
    outline: 2px solid var(--cyan, #5fcfe0);
    outline-offset: -2px;
    border-radius: 4px;
  }

  .icon {
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg-1, #111);
    border: 1px solid var(--line, #1f1f1f);
    display: block;
  }

  .icon img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }

  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    min-width: 0;
  }

  .title-row {
    display: flex;
    align-items: baseline;
    gap: 0.65rem;
    flex-wrap: wrap;
  }

  .title-row strong {
    color: var(--gold, #c9a96a);
    font-weight: 600;
    font-size: 0.98rem;
    letter-spacing: 0.005em;
    font-family: 'Iowan Old Style', 'Hoefler Text', Georgia, serif;
  }

  .meta {
    color: var(--text-mute);
    font-size: 0.76rem;
    line-height: 1.45;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: baseline;
    overflow: hidden;
  }

  .meta code {
    color: var(--text-dim);
    font-family: ui-monospace, 'SF Mono', monospace;
    font-size: 0.95em;
  }

  .meta .dot {
    color: var(--text-faint);
  }

  .meta .threadable {
    color: var(--cyan-dim, #4ba9b8);
  }

  .desc {
    color: var(--text-secondary, #cfcfcf);
    font-size: 0.9rem;
    line-height: 1.5;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
  }

  .pill {
    display: inline-block;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    font-size: 0.66rem;
    border: 1px solid var(--line, #1f1f1f);
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .source-chip {
    display: inline-block;
    padding: 0.05rem 0.45rem;
    border-radius: 4px;
    font-size: 0.65rem;
    border: 1px solid var(--line, #1f1f1f);
    color: var(--text-mute);
    letter-spacing: 0.04em;
    white-space: nowrap;
    flex-shrink: 0;
    font-family: ui-monospace, 'SF Mono', monospace;
  }

  .pill.ok {
    color: #8fb88f;
    border-color: #2a4020;
    background: #0d1a0d;
  }

  /* Foundation pill — Genesis Spinners with no signature yet, OR
     future foundation-recognized Spinners. Visually distinct from
     both 'verified' (cell-authored green) and 'unsigned' (warn gold)
     — patrons should read these as the canonical, trusted-by-publisher
     entries, not as a warning. */
  .pill.foundation {
    color: #f0c850;
    border-color: #5a4a18;
    background: #1a1408;
  }

  .demo-chip {
    display: inline-block;
    padding: 0.05rem 0.45rem;
    border-radius: 4px;
    font-size: 0.65rem;
    border: 1px dashed #4a3a18;
    color: #c9a96a;
    background: #14100a;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }

  .demo-row {
    opacity: 0.6;
  }
  .demo-row:hover {
    opacity: 1;
  }

  .demos-bar {
    display: flex;
    gap: 0.8rem;
    align-items: center;
    margin: 0.5rem 0 1rem;
    padding: 0.4rem 0.7rem;
    background: #0e0e08;
    border: 1px dashed #2a2418;
    border-radius: 4px;
    font-size: 0.85rem;
    flex-wrap: wrap;
  }
  .demos-note {
    color: #8a8a8a;
    flex: 1 1 auto;
    min-width: 0;
  }
  .demos-toggle {
    color: #c9a96a;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .sweep-btn {
    background: transparent;
    color: #c9a96a;
    border: 1px solid #3a3220;
    padding: 0.25rem 0.7rem;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.8rem;
  }
  .sweep-btn:hover {
    background: #1a160a;
  }
  .sweep-btn:disabled {
    opacity: 0.5;
    cursor: wait;
  }
  .sweep-msg {
    color: #88c878;
    font-size: 0.8rem;
  }

  .pill.warn {
    color: var(--gold, #c9a96a);
    border-color: #3a3220;
    background: #1a160a;
  }

  .pill.bad {
    color: #f88;
    border-color: #602020;
    background: #2a0808;
  }

  .chev {
    color: var(--text-faint);
    font-size: 1.4rem;
    font-weight: 300;
    flex-shrink: 0;
    transition:
      color 0.12s ease,
      transform 0.12s ease;
    line-height: 1;
  }

  .row:hover .chev {
    color: var(--cyan, #5fcfe0);
    transform: translateX(2px);
  }

  @media (max-width: 640px) {
    .row {
      flex-wrap: wrap;
    }
    .icon {
      width: 36px;
      height: 36px;
    }
    .desc {
      flex-basis: 100%;
    }
    .chev {
      display: none;
    }
  }
</style>
