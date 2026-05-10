<script lang="ts">
  let { data } = $props();

  let tab = $state<'how-it-works' | 'mission-lock' | 'manifest' | 'readme'>('how-it-works');
  let activeCapability = $state(data.manifest.capabilities[0]?.name ?? '');
  let inputJson = $state('{}');
  let invoking = $state(false);
  let invokeResult = $state<unknown>(null);
  let invokeError = $state<string | null>(null);

  async function runInvocation(e: SubmitEvent) {
    e.preventDefault();
    if (!activeCapability) return;
    invoking = true;
    invokeError = null;
    invokeResult = null;
    let parsedInput: unknown;
    try {
      parsedInput = inputJson.trim() === '' ? {} : JSON.parse(inputJson);
    } catch (err) {
      invokeError = `Input is not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
      invoking = false;
      return;
    }
    try {
      const res = await fetch(`/admin/spinners/${data.slug}/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capability: activeCapability,
          input: parsedInput,
        }),
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        invokeError = body.message ?? `Invocation failed (${res.status}).`;
        invokeResult = body;
      } else {
        invokeResult = body;
      }
    } catch (err) {
      invokeError = err instanceof Error ? err.message : String(err);
    } finally {
      invoking = false;
    }
  }

  function integrityDescription(integrity: { kind: string }): string {
    switch (integrity.kind) {
      case 'verified':
        return 'Bundle digest matches the install record. Signatures verify.';
      case 'unsigned':
        return 'Bundle digest matches the install record. No signatures recorded.';
      case 'pending-install':
        return 'Spinner has not been installed yet. The digest below is observed from the bytes on disk; no install record to compare against.';
      case 'digest-mismatch':
        return 'Bundle digest does not match the install record. Tampering signal — invocation gated.';
      case 'signature-invalid':
        return 'A recorded signature does not verify. Invocation gated.';
      case 'unknown-signer':
        return 'A signature names a signer the Cell has no public key for. Invocation gated.';
      default:
        return integrity.kind;
    }
  }

  function fmtTime(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  function fmtDuration(ms: number): string {
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  }

  function placeholderForCapability(cap: string): string {
    switch (cap) {
      case 'consult':
        return '{\n  "question": "What does the Pledge say about hyperscale operation?"\n}';
      case 'audit':
        return '{\n  "subject": "DECISIONS.md",\n  "kind": "file"\n}';
      case 'record':
        return '{\n  "title": "Short title here",\n  "body": "Decision body\\nWhy: …"\n}';
      case 'surface':
        return '{}';
      default:
        return '{}';
    }
  }
</script>

<svelte:head>
  <title>{data.manifest.displayName} · Spinner · Warp</title>
</svelte:head>

<a class="back" href="/admin/spinners">← Spinners</a>

<header class="hero">
  <div class="hero-thumb">
    <img src={`/admin/spinners/${data.slug}/thumbnail`} alt="" />
  </div>
  <div class="hero-text">
    <h1>{data.manifest.displayName}</h1>
    <p class="name">
      <code>{data.manifest.name}</code>
      <span class="dot">·</span>
      <span class="version">v{data.manifest.version}</span>
      {#if data.manifest.threadable}
        <span class="dot">·</span>
        <span class="threadable">threadable</span>
      {/if}
    </p>
    <p class="desc">{data.manifest.description}</p>
  </div>
</header>

{#if data.silkPattern}
  <section class="silk">
    <h2>Silk Pattern</h2>
    <div class="silk-grid">
      <div class="metric">
        <span class="label">Invocations</span>
        <span class="value">{data.silkPattern.metrics.invocations}</span>
      </div>
      <div class="metric">
        <span class="label">Successes</span>
        <span class="value good">{data.silkPattern.metrics.successes}</span>
      </div>
      <div class="metric">
        <span class="label">Errors</span>
        <span class="value bad">{data.silkPattern.metrics.errors}</span>
      </div>
      <div class="metric">
        <span class="label">Avg duration</span>
        <span class="value">{fmtDuration(data.silkPattern.metrics.avgDurationMs)}</span>
      </div>
      <div class="metric">
        <span class="label">Last invoked</span>
        <span class="value"
          >{data.silkPattern.metrics.lastInvokedAt
            ? fmtTime(data.silkPattern.metrics.lastInvokedAt)
            : '—'}</span
        >
      </div>
    </div>
    {#if data.silkPattern.recent.length > 0}
      <table class="recent">
        <thead>
          <tr>
            <th>When</th>
            <th>Capability</th>
            <th>Result</th>
            <th>Duration</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          {#each data.silkPattern.recent as e (e.id)}
            <tr>
              <td class="time">{fmtTime(e.invokedAt)}</td>
              <td><code>{e.capability}</code></td>
              <td><span class={`pill ${e.result}`}>{e.result}</span></td>
              <td>{fmtDuration(e.durationMs)}</td>
              <td class="summary">{e.outputSummary || e.errorMessage || ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="muted">No invocations yet.</p>
    {/if}
  </section>
{/if}

<section class="integrity">
  <h2>Integrity</h2>
  <div class={`status ${data.integrity.kind}`}>
    <strong>{data.integrity.kind}</strong>
    <p>{integrityDescription(data.integrity)}</p>
    {#if 'observedDigest' in data.integrity}
      <p class="digest"><code>{data.integrity.observedDigest}</code></p>
    {:else if 'digest' in data.integrity}
      <p class="digest"><code>{data.integrity.digest}</code></p>
    {/if}
  </div>
</section>

<section class="capabilities">
  <h2>Capabilities</h2>
  <table>
    <thead>
      <tr>
        <th>Capability</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      {#each data.manifest.capabilities as c (c.name)}
        <tr>
          <td>
            <strong>{c.displayName}</strong>
            <span class="cap-name"><code>{c.name}</code></span>
          </td>
          <td>{c.description}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<section class="vault">
  <h2>Vault references</h2>
  {#if data.manifest.vault.length === 0}
    <p class="muted">None.</p>
  {:else}
    <ul>
      {#each data.manifest.vault as v (v.name)}
        <li>
          <code>{v.name}</code> ← <code>{v.uri}</code>
          {v.required ? '(required)' : '(optional)'}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="spools">
  <h2>Spools</h2>
  {#if data.spoolDisplay.length === 0}
    <p class="muted">None declared.</p>
  {:else}
    <ul>
      {#each data.spoolDisplay as s (s.name)}
        <li>
          <code>{s.name}</code> ← <strong>{s.spoolDisplayName}</strong>
          <span class="muted">(<code>{s.spool}</code>, {s.required ? 'required' : 'optional'})</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="docs">
  <h2>Documentation</h2>
  <nav class="tabs">
    <button class:active={tab === 'how-it-works'} onclick={() => (tab = 'how-it-works')}>
      How It Works
    </button>
    {#if data.docs.missionLockHtml}
      <button class:active={tab === 'mission-lock'} onclick={() => (tab = 'mission-lock')}>
        Mission Lock
      </button>
    {/if}
    {#if data.docs.readmeHtml}
      <button class:active={tab === 'readme'} onclick={() => (tab = 'readme')}>README</button>
    {/if}
    <button class:active={tab === 'manifest'} onclick={() => (tab = 'manifest')}>Manifest</button>
  </nav>

  <article class="rendered">
    {#if tab === 'how-it-works'}
      {#if data.docs.howItWorksHtml}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html data.docs.howItWorksHtml}
      {:else}
        <p class="muted">
          No <code>how-it-works.md</code> on disk. Per the Operating Principles, every Spinner must
          ship a How It Works document — surface this as a drift report.
        </p>
      {/if}
    {:else if tab === 'mission-lock'}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html data.docs.missionLockHtml ?? ''}
    {:else if tab === 'readme'}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html data.docs.readmeHtml ?? ''}
    {:else}
      <pre><code>{JSON.stringify(data.manifest, null, 2)}</code></pre>
    {/if}
  </article>
</section>

<section class="invoke">
  <h2>Invoke</h2>
  <p class="muted">
    Capability invocation routes through the bootstrap Weaver in this Loom (per <code
      >DECISIONS.md</code
    >
    2026-05-10 — <em>Bootstrap Weaver runs inside the Loom</em>). The canonical Weaver lives in
    Python+FastAPI and supersedes when ready.
  </p>

  <form onsubmit={runInvocation}>
    <label>
      <span>Capability</span>
      <select bind:value={activeCapability}>
        {#each data.manifest.capabilities as c (c.name)}
          <option value={c.name}>{c.displayName} ({c.name})</option>
        {/each}
      </select>
    </label>

    <label>
      <span>Input (JSON)</span>
      <textarea
        bind:value={inputJson}
        placeholder={placeholderForCapability(activeCapability)}
        rows="6"
        spellcheck="false"
      ></textarea>
    </label>

    <div class="actions">
      <button type="submit" disabled={invoking}>
        {invoking ? 'Running…' : 'Run'}
      </button>
    </div>
  </form>

  {#if invokeError}
    <div class="result error">
      <strong>Error</strong>
      <p>{invokeError}</p>
      {#if invokeResult}
        <pre><code>{JSON.stringify(invokeResult, null, 2)}</code></pre>
      {/if}
    </div>
  {:else if invokeResult}
    <div class="result success">
      <strong>Result</strong>
      <pre><code>{JSON.stringify(invokeResult, null, 2)}</code></pre>
    </div>
  {/if}
</section>

<style>
  .back {
    color: var(--cyan);
    font-size: 0.85rem;
    text-decoration: none;
  }
  .back:hover {
    color: var(--gold);
  }

  .hero {
    margin: 1rem 0 2.5rem;
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 1.5rem;
    align-items: center;
    max-width: 64rem;
    opacity: 0;
    animation: hero-in 0.6s cubic-bezier(0.2, 0.6, 0.1, 1) forwards 0.05s;
  }

  @keyframes hero-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .hero-thumb {
    aspect-ratio: 1;
    border-radius: 12px;
    border: 1px solid #1a1a1a;
    overflow: hidden;
    background: #0a0a0a;
    box-shadow: 0 8px 32px -16px rgba(201, 169, 106, 0.18);
  }

  .hero-thumb img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }

  .hero-text h1 {
    margin: 0 0 0.4rem;
    font-size: 1.9rem;
    color: var(--gold);
    letter-spacing: 0.02em;
    font-family: 'Iowan Old Style', 'Hoefler Text', 'Constantia', Georgia, serif;
    font-weight: 600;
  }

  .hero-text .name {
    margin: 0 0 0.85rem;
    color: var(--text-mute);
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .hero-text .name .dot {
    color: #444;
  }

  .hero-text .name .version {
    color: var(--text-dim);
  }

  .hero-text .name .threadable {
    color: var(--cyan-dim, #3b8a93);
  }

  .hero-text .desc {
    margin: 0;
    color: #c5c5c5;
    font-size: 1rem;
    max-width: 64ch;
    line-height: 1.6;
  }

  @media (max-width: 720px) {
    .hero {
      grid-template-columns: 1fr;
      text-align: center;
    }
    .hero-thumb {
      max-width: 220px;
      margin: 0 auto;
    }
  }

  section {
    margin-bottom: 2rem;
    max-width: 64rem;
  }

  h2 {
    margin: 0 0 0.75rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--cyan);
    font-weight: 600;
  }

  .silk-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .metric {
    background: #111;
    border: 1px solid #1f1f1f;
    border-radius: 6px;
    padding: 0.6rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .metric .label {
    color: var(--text-mute);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .metric .value {
    color: #ddd;
    font-size: 1.1rem;
    font-variant-numeric: tabular-nums;
  }
  .metric .value.good {
    color: #8f8;
  }
  .metric .value.bad {
    color: #f88;
  }

  table.recent {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }
  table.recent th,
  table.recent td {
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid #141414;
    text-align: left;
  }
  table.recent th {
    color: var(--text-mute);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.7rem;
    border-bottom-color: #1f1f1f;
  }
  table.recent td {
    color: #ccc;
    vertical-align: top;
  }
  table.recent .time {
    color: var(--text-mute);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  table.recent .summary {
    color: var(--text-dim);
    font-size: 0.78rem;
    max-width: 32rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pill {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-size: 0.7rem;
    border: 1px solid #2a2a2a;
    color: var(--text-dim);
  }
  .pill.success {
    color: #8f8;
    border-color: #2a4020;
    background: #0d1a0d;
  }
  .pill.error {
    color: #f88;
    border-color: #602020;
    background: #2a0808;
  }
  .pill.denied {
    color: var(--gold);
    border-color: #3a3220;
    background: #1a160a;
  }

  .status {
    border: 1px solid #2a2a2a;
    background: #111;
    border-radius: 6px;
    padding: 0.85rem 1rem;
  }
  .status strong {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.75rem;
  }
  .status.verified strong {
    color: #8f8;
  }
  .status.unsigned strong,
  .status.pending-install strong {
    color: var(--gold);
  }
  .status.digest-mismatch strong,
  .status.signature-invalid strong,
  .status.unknown-signer strong {
    color: #f88;
  }
  .status p {
    margin: 0.4rem 0 0;
    color: #ccc;
    font-size: 0.9rem;
    line-height: 1.5;
  }
  .status .digest code {
    color: var(--text-mute);
    font-size: 0.78rem;
    word-break: break-all;
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
    vertical-align: top;
  }
  td strong {
    color: var(--gold);
    font-weight: 600;
  }
  .cap-name {
    margin-left: 0.5rem;
    color: var(--text-mute);
    font-size: 0.78rem;
  }

  ul {
    margin: 0;
    padding: 0 0 0 1.25rem;
    color: #ccc;
    font-size: 0.88rem;
    line-height: 1.6;
  }

  .muted {
    color: var(--text-mute);
    font-size: 0.88rem;
  }

  .tabs {
    display: flex;
    gap: 0.4rem;
    margin-bottom: 1rem;
    border-bottom: 1px solid #1f1f1f;
  }
  .tabs button {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-mute);
    padding: 0.4rem 0.8rem;
    font-size: 0.85rem;
    cursor: pointer;
    font-family: inherit;
  }
  .tabs button:hover {
    color: #ccc;
  }
  .tabs button.active {
    color: var(--cyan);
    border-bottom-color: var(--cyan);
  }

  .rendered :global(h1),
  .rendered :global(h2),
  .rendered :global(h3) {
    color: var(--gold);
  }
  .rendered :global(p) {
    color: #ccc;
    line-height: 1.6;
    max-width: 64ch;
  }
  .rendered :global(code) {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 0.85em;
    color: #ddd;
  }
  .rendered :global(pre code) {
    display: block;
    padding: 0.75rem 1rem;
    overflow-x: auto;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 48rem;
  }
  form label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
  }
  form label span {
    color: var(--text-dim);
  }
  form select,
  form textarea {
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    color: #eee;
    padding: 0.55rem 0.7rem;
    border-radius: 4px;
    font-size: 0.9rem;
    font-family: ui-monospace, monospace;
  }
  form textarea {
    resize: vertical;
  }
  form select:focus,
  form textarea:focus {
    outline: none;
    border-color: var(--cyan);
  }
  form .actions {
    display: flex;
    align-items: center;
  }
  form button {
    background: var(--gold);
    color: #1a1306;
    border: none;
    padding: 0.55rem 1.25rem;
    border-radius: 4px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
  }
  form button:hover:not(:disabled) {
    background: var(--gold-bright);
  }
  form button:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  .result {
    margin-top: 1.25rem;
    border-radius: 6px;
    padding: 0.85rem 1rem;
    border: 1px solid #2a2a2a;
    background: #111;
  }
  .result strong {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.75rem;
  }
  .result.error {
    border-color: #602020;
    background: #2a0808;
  }
  .result.error strong {
    color: #f88;
  }
  .result.success {
    border-color: #2a4020;
    background: #0d1a0d;
  }
  .result.success strong {
    color: #8f8;
  }
  .result pre {
    margin: 0.6rem 0 0;
    background: #0a0a0a;
    border: 1px solid #1a1a1a;
    border-radius: 4px;
    padding: 0.75rem 1rem;
    overflow-x: auto;
  }
  .result pre code {
    color: #ddd;
    font-size: 0.78rem;
  }

  code {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 0.85em;
    color: #ddd;
  }
</style>
