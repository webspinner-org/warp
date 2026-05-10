<script lang="ts">
  let { data } = $props();

  let tab = $state<'how-it-works' | 'mission-lock' | 'manifest' | 'readme'>('how-it-works');
  let activeCapability = $state(data.manifest.capabilities[0]?.name ?? '');
  let invoking = $state(false);
  let invokeResult = $state<any>(null);
  let invokeError = $state<string | null>(null);
  let devView = $state(false);

  // Per-capability input slots — kept separate so a Wizard can flip
  // between capabilities on one Spinner without losing their typing.
  let consultQuestion = $state('');
  let recordTitle = $state('');
  let recordBody = $state('');
  let recordSupersedes = $state('');
  let auditSubject = $state('');
  let auditKind = $state<'file' | 'text'>('file');
  let reviewHtml = $state('');
  let reviewLabel = $state('');
  let reviewTopic = $state('');
  let fallbackJson = $state('{}');

  function buildInput(): { ok: true; value: unknown } | { ok: false; error: string } {
    switch (activeCapability) {
      case 'consult': {
        if (consultQuestion.trim().length === 0)
          return { ok: false, error: 'Type a question first.' };
        return { ok: true, value: { question: consultQuestion } };
      }
      case 'record': {
        if (recordTitle.trim().length === 0)
          return { ok: false, error: 'Title is required.' };
        if (recordBody.trim().length === 0) return { ok: false, error: 'Body is required.' };
        const v: Record<string, string> = { title: recordTitle, body: recordBody };
        if (recordSupersedes.trim().length > 0) v.supersedes = recordSupersedes;
        return { ok: true, value: v };
      }
      case 'audit': {
        if (auditSubject.trim().length === 0)
          return { ok: false, error: 'Subject is required.' };
        return { ok: true, value: { subject: auditSubject, kind: auditKind } };
      }
      case 'surface':
        return { ok: true, value: {} };
      case 'review': {
        if (reviewHtml.trim().length === 0)
          return { ok: false, error: 'Paste some HTML for Pablo to review.' };
        const v: Record<string, string> = { html: reviewHtml };
        if (reviewLabel.trim().length > 0) v.label = reviewLabel;
        if (reviewTopic.trim().length > 0) v.topic = reviewTopic;
        return { ok: true, value: v };
      }
      default: {
        try {
          const parsed = fallbackJson.trim().length === 0 ? {} : JSON.parse(fallbackJson);
          return { ok: true, value: parsed };
        } catch (e) {
          return { ok: false, error: `Input is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
        }
      }
    }
  }

  async function runInvocation(e: SubmitEvent) {
    e.preventDefault();
    if (!activeCapability) return;
    const built = buildInput();
    if (!built.ok) {
      invokeError = built.error;
      return;
    }
    invoking = true;
    invokeError = null;
    invokeResult = null;
    try {
      const res = await fetch(`/admin/spinners/${data.slug}/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability: activeCapability, input: built.value }),
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

  function paragraphs(text: string): string[] {
    return text.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // best-effort
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

  <form onsubmit={runInvocation} class="invoke-form">
    {#if data.manifest.capabilities.length > 1}
      <div class="cap-tabs" role="tablist" aria-label="Capability">
        {#each data.manifest.capabilities as c (c.name)}
          <button
            type="button"
            role="tab"
            aria-selected={activeCapability === c.name}
            class:active={activeCapability === c.name}
            onclick={() => (activeCapability = c.name)}
          >
            {c.displayName}
          </button>
        {/each}
      </div>
    {/if}

    {#if activeCapability === 'consult'}
      <label class="field">
        <span>Your question</span>
        <textarea
          bind:value={consultQuestion}
          placeholder="What does the Pledge say about hyperscale operation?"
          rows="3"
          spellcheck="true"
        ></textarea>
        <span class="hint">Grounded in the Spinner's declared Spools. Citations come back with the answer.</span>
      </label>
    {:else if activeCapability === 'record'}
      <label class="field">
        <span>Title</span>
        <input bind:value={recordTitle} placeholder="Short title for the decision" maxlength="120" />
      </label>
      <label class="field">
        <span>Body</span>
        <textarea
          bind:value={recordBody}
          placeholder="Decision body — what is being decided, with a Why: line and any constraints."
          rows="5"
        ></textarea>
      </label>
      <label class="field">
        <span>Supersedes <span class="opt">(optional)</span></span>
        <input bind:value={recordSupersedes} placeholder="2026-04-15 — *Old decision title*" />
      </label>
    {:else if activeCapability === 'audit'}
      <label class="field">
        <span>Subject</span>
        <input bind:value={auditSubject} placeholder="File path (e.g. CLAUDE.md) or inline text" />
      </label>
      <fieldset class="field radio-group">
        <legend>Kind</legend>
        <label class="radio">
          <input type="radio" name="audit-kind" value="file" bind:group={auditKind} />
          <span>File path (relative to <code>~/warp/</code>)</span>
        </label>
        <label class="radio">
          <input type="radio" name="audit-kind" value="text" bind:group={auditKind} />
          <span>Inline text</span>
        </label>
      </fieldset>
    {:else if activeCapability === 'surface'}
      <p class="hint">
        No input needed. Click <strong>Run</strong> to surface unfinished threads — uncommitted
        work, open questions, spec-pending entries, and dated TODOs in the Cell.
      </p>
    {:else if activeCapability === 'review'}
      <label class="field">
        <span>Surface label <span class="opt">(optional)</span></span>
        <input bind:value={reviewLabel} placeholder="e.g. Skein listing page" />
      </label>
      <label class="field">
        <span>Wizard intent <span class="opt">(optional)</span></span>
        <input bind:value={reviewTopic} placeholder="What you want Pablo to look for, in patron-facing words" />
      </label>
      <label class="field">
        <span>Rendered HTML</span>
        <textarea
          bind:value={reviewHtml}
          placeholder="Paste the rendered HTML for Pablo to walk. Truncated to ~12K characters on the server."
          rows="10"
          spellcheck="false"
        ></textarea>
        <span class="hint">Or run <code>tools/pablo &lt;route&gt;</code> from the repo for a one-command critique loop.</span>
      </label>
    {:else}
      <label class="field">
        <span>Input (JSON) <span class="opt">— fallback for unrecognised capabilities</span></span>
        <textarea bind:value={fallbackJson} rows="6" spellcheck="false"></textarea>
      </label>
    {/if}

    <div class="actions">
      <button type="submit" disabled={invoking || !activeCapability}>
        {invoking ? 'Running…' : 'Run'}
      </button>
      {#if invokeResult || invokeError}
        <label class="dev-toggle">
          <input type="checkbox" bind:checked={devView} />
          <span>Developer view</span>
        </label>
      {/if}
    </div>
  </form>

  {#if invokeError}
    <div class="result-error" role="alert">
      <strong>Error</strong>
      <p>{invokeError}</p>
    </div>
  {/if}

  {#if invokeResult?.ok && invokeResult.output}
    {@const out = invokeResult.output}

    {#if activeCapability === 'consult' && typeof out.answer === 'string'}
      <article class="prose-result">
        <header class="prose-header">
          <span class="pill ok">Answered</span>
          {#if invokeResult.durationMs}
            <span class="duration">{fmtDuration(invokeResult.durationMs)}</span>
          {/if}
        </header>
        <div class="answer">
          {#each paragraphs(out.answer) as p}
            <p>{p}</p>
          {/each}
        </div>
        {#if Array.isArray(out.citations) && out.citations.length > 0}
          <div class="citations">
            <h3>Citations</h3>
            <ul>
              {#each out.citations as c}
                <li><code>{c}</code></li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if out.provenance}
          <p class="provenance">
            {out.provenance.provider ?? ''}
            {#if out.provenance.model}· <code>{out.provenance.model.split('/').pop()}</code>{/if}
            {#if out.provenance.retrieval}· {out.provenance.retrieval.returnedPassages} of {out.provenance.retrieval.totalChunks} passages
              {#if out.provenance.retrieval.cacheHit}<span class="hit">cache hit</span>{/if}
            {/if}
          </p>
        {/if}
      </article>
    {:else if activeCapability === 'review' && typeof out.verdict === 'string'}
      <article class="review-result">
        <header class="review-header">
          <span class={`pill review-verdict ${out.verdict}`}>{out.verdict}</span>
          {#if out.verdict_text}
            <p class="verdict-text">{out.verdict_text}</p>
          {/if}
        </header>
        {#if out.in_pablo_voice}
          <blockquote class="pablo-voice">{out.in_pablo_voice}</blockquote>
        {/if}
        {#if Array.isArray(out.findings) && out.findings.length > 0}
          <ol class="findings">
            {#each out.findings as f, i}
              <li class={`finding sev-${f.severity ?? 'medium'}`}>
                <header>
                  <span class={`sev-pill sev-${f.severity ?? 'medium'}`}>{f.severity ?? 'medium'}</span>
                  <span class="category">{f.category ?? 'other'}</span>
                  <span class="source"><code>{f.source ?? 'pablos-eye'}</code></span>
                </header>
                <p class="finding-body">{f.finding ?? ''}</p>
                {#if f.evidence}
                  <pre class="evidence"><code>{f.evidence}</code></pre>
                {/if}
                {#if f.fix}
                  <p class="fix"><strong>Fix:</strong> {f.fix}</p>
                {/if}
              </li>
            {/each}
          </ol>
        {:else}
          <p class="muted">No findings. Pablo blesses this surface.</p>
        {/if}
      </article>
    {:else if activeCapability === 'record' && typeof out.entry === 'string'}
      <article class="entry-result">
        <header>
          <strong>Drafted DECISIONS.md entry</strong>
          <button type="button" class="copy" onclick={() => copyToClipboard(out.entry)}>Copy</button>
        </header>
        <pre><code>{out.entry}</code></pre>
        <p class="hint">Append this to <code>DECISIONS.md</code> — do not rewrite existing entries.</p>
      </article>
    {:else if activeCapability === 'audit' && Array.isArray(out.drift)}
      <article class="drift-result">
        <header><strong>Drift report</strong></header>
        {#if out.drift.length === 0}
          <p class="muted">No drift detected.</p>
        {:else}
          <ol class="findings">
            {#each out.drift as d}
              <li class={`finding sev-${d.severity ?? 'info'}`}>
                <header>
                  <span class={`sev-pill sev-${d.severity ?? 'info'}`}>{d.severity ?? 'info'}</span>
                  {#if d.rule}<span class="category">{d.rule}</span>{/if}
                </header>
                {#if d.evidence}<pre class="evidence"><code>{d.evidence}</code></pre>{/if}
                {#if d.suggestion}<p class="fix"><strong>Suggestion:</strong> {d.suggestion}</p>{/if}
              </li>
            {/each}
          </ol>
        {/if}
      </article>
    {:else if activeCapability === 'surface' && Array.isArray(out.threads)}
      <article class="threads-result">
        <header><strong>{out.threads.length} unfinished thread{out.threads.length === 1 ? '' : 's'}</strong></header>
        {#if out.threads.length === 0}
          <p class="muted">All threads resolved. Tight Cell.</p>
        {:else}
          <ul>
            {#each out.threads as t}
              <li>
                <span class={`thread-kind ${t.kind}`}>{t.kind}</span>
                <span class="thread-subject">{t.subject}</span>
                {#if typeof t.ageDays === 'number'}
                  <span class="age">{t.ageDays}d</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </article>
    {:else}
      <article class="entry-result">
        <header><strong>Result</strong></header>
        <pre><code>{JSON.stringify(out, null, 2)}</code></pre>
      </article>
    {/if}

    {#if devView}
      <details class="dev-view" open>
        <summary>Developer view — full envelope</summary>
        <pre><code>{JSON.stringify(invokeResult, null, 2)}</code></pre>
      </details>
    {/if}
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

  /* ── Capability tabs ──────────────────────────────────────────────── */
  .invoke-form {
    max-width: 48rem;
  }

  .cap-tabs {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    margin: 0 0 1.25rem;
    border-bottom: 1px solid var(--line, #1f1f1f);
    padding-bottom: 0.5rem;
  }

  .cap-tabs button {
    background: transparent;
    border: 1px solid var(--line, #1f1f1f);
    color: var(--text-mute);
    padding: 0.4rem 0.85rem;
    font-size: 0.82rem;
    border-radius: 999px;
    cursor: pointer;
    font-family: inherit;
    letter-spacing: 0.01em;
    transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  }

  .cap-tabs button:hover {
    color: var(--text);
    border-color: #2a2a2a;
  }

  .cap-tabs button.active {
    color: var(--cyan, #5fcfe0);
    border-color: var(--cyan-dim, #4ba9b8);
    background: rgba(95, 207, 224, 0.06);
  }

  /* ── Capability field rendering ──────────────────────────────────── */
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-bottom: 1rem;
  }

  .field > span {
    color: var(--text-dim, #b4b4b4);
    font-size: 0.82rem;
    letter-spacing: 0.01em;
  }

  .field .opt {
    color: var(--text-mute);
    font-weight: 400;
    font-size: 0.92em;
  }

  .field input,
  .field textarea,
  .field select {
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    color: var(--text, #f0f0f0);
    padding: 0.6rem 0.75rem;
    border-radius: 6px;
    font-size: 0.95rem;
    font-family: inherit;
    line-height: 1.5;
    width: 100%;
    box-sizing: border-box;
  }

  .field textarea {
    font-family: 'Iowan Old Style', 'Hoefler Text', Georgia, serif;
    resize: vertical;
  }

  /* Review's HTML field is monospace so the patron can see structure. */
  textarea[placeholder*="HTML"] {
    font-family: ui-monospace, 'SF Mono', monospace !important;
    font-size: 0.85rem !important;
  }

  .field input:focus,
  .field textarea:focus,
  .field select:focus {
    outline: none;
    border-color: var(--cyan, #5fcfe0);
  }

  .field .hint {
    color: var(--text-mute);
    font-size: 0.78rem;
    line-height: 1.5;
    margin-top: 0.1rem;
  }

  .radio-group {
    border: 1px solid var(--line, #1f1f1f);
    background: transparent;
    border-radius: 6px;
    padding: 0.6rem 0.8rem;
  }

  .radio-group legend {
    color: var(--text-dim);
    font-size: 0.82rem;
    padding: 0 0.4rem;
  }

  .radio {
    display: flex;
    align-items: baseline;
    gap: 0.55rem;
    font-size: 0.9rem;
    color: var(--text-secondary);
    padding: 0.2rem 0;
    cursor: pointer;
  }

  .radio input {
    accent-color: var(--cyan);
  }

  .dev-toggle {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-left: auto;
    color: var(--text-mute);
    font-size: 0.78rem;
    cursor: pointer;
  }

  .dev-toggle input {
    accent-color: var(--cyan);
  }

  .dev-view {
    margin-top: 1rem;
    border: 1px solid var(--line, #1f1f1f);
    border-radius: 6px;
    background: #0a0a0a;
  }

  .dev-view summary {
    cursor: pointer;
    padding: 0.55rem 0.85rem;
    color: var(--text-mute);
    font-size: 0.78rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .dev-view pre {
    margin: 0;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--line, #1f1f1f);
    overflow-x: auto;
    font-size: 0.78rem;
    color: var(--text-secondary);
  }

  .result-error {
    margin-top: 1.25rem;
    padding: 0.85rem 1rem;
    border-radius: 6px;
    border: 1px solid #602020;
    background: #2a0808;
    color: #fbb;
    max-width: 48rem;
  }

  .result-error strong {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.74rem;
    color: #f88;
  }

  .result-error p {
    margin: 0.4rem 0 0;
    color: #fbb;
    font-size: 0.92rem;
    line-height: 1.55;
  }

  /* ── Consult / prose result ──────────────────────────────────────── */
  .prose-result {
    margin-top: 1.5rem;
    max-width: 48rem;
    padding: 1.25rem 1.5rem;
    border: 1px solid var(--line, #1f1f1f);
    background: linear-gradient(180deg, #0e0e0e, #0a0a0a);
    border-radius: 8px;
  }

  .prose-header {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    margin-bottom: 0.85rem;
  }

  .prose-header .duration {
    color: var(--text-mute);
    font-size: 0.76rem;
    font-variant-numeric: tabular-nums;
    margin-left: auto;
  }

  .answer p {
    color: var(--text, #f0f0f0);
    font-family: 'Iowan Old Style', 'Hoefler Text', Georgia, serif;
    font-size: 1.02rem;
    line-height: 1.65;
    margin: 0 0 0.85rem;
    max-width: 64ch;
  }

  .answer p:last-child {
    margin-bottom: 0;
  }

  .citations {
    margin-top: 1.25rem;
    padding-top: 1rem;
    border-top: 1px solid var(--line, #1f1f1f);
  }

  .citations h3 {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--cyan);
    margin: 0 0 0.5rem;
    font-weight: 600;
  }

  .citations ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .citations li code {
    display: inline-block;
    color: var(--text-secondary);
    font-size: 0.78rem;
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
  }

  .provenance {
    margin: 1rem 0 0;
    color: var(--text-mute);
    font-size: 0.72rem;
    letter-spacing: 0.02em;
  }

  .provenance code {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--text-dim);
    font-size: inherit;
  }

  .provenance .hit {
    color: var(--cyan);
    margin-left: 0.4rem;
  }

  /* ── Review (Pablo) result ───────────────────────────────────────── */
  .review-result {
    margin-top: 1.5rem;
    max-width: 56rem;
    padding: 1.25rem 1.5rem;
    border: 1px solid var(--line, #1f1f1f);
    border-radius: 8px;
    background: linear-gradient(180deg, #0e0e0e, #0a0a0a);
  }

  .review-header {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    flex-wrap: wrap;
    margin-bottom: 0.6rem;
  }

  .review-verdict {
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.2rem 0.7rem;
  }

  .review-verdict.passes {
    background: #0d1a0d;
    border-color: #2a4020;
    color: #9fd99f;
  }

  .review-verdict.concerns {
    background: #1a160a;
    border-color: #3a3220;
    color: var(--gold);
  }

  .review-verdict.fails {
    background: #2a0808;
    border-color: #602020;
    color: #f88;
  }

  .review-header .verdict-text {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.92rem;
    line-height: 1.5;
  }

  .pablo-voice {
    margin: 0.85rem 0 1.5rem;
    padding: 0.75rem 1rem;
    border-left: 3px solid var(--gold);
    background: rgba(201, 169, 106, 0.04);
    color: var(--text);
    font-family: 'Iowan Old Style', 'Hoefler Text', Georgia, serif;
    font-style: italic;
    font-size: 1.02rem;
    line-height: 1.55;
  }

  .findings {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .finding {
    border: 1px solid var(--line, #1f1f1f);
    border-left-width: 3px;
    border-radius: 6px;
    padding: 0.75rem 1rem;
    background: var(--bg-1, #111);
  }

  .finding.sev-high,
  .finding.sev-error {
    border-left-color: #f88;
  }

  .finding.sev-medium,
  .finding.sev-warning {
    border-left-color: var(--gold);
  }

  .finding.sev-low,
  .finding.sev-info {
    border-left-color: var(--cyan-dim, #4ba9b8);
  }

  .finding > header {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
  }

  .sev-pill {
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

  .sev-pill.sev-high,
  .sev-pill.sev-error {
    color: #f88;
    background: #2a0808;
  }

  .sev-pill.sev-medium,
  .sev-pill.sev-warning {
    color: var(--gold);
    background: #1a160a;
  }

  .sev-pill.sev-low,
  .sev-pill.sev-info {
    color: var(--cyan-dim, #4ba9b8);
    background: rgba(95, 207, 224, 0.06);
  }

  .finding .category {
    color: var(--text-dim);
    font-size: 0.76rem;
    letter-spacing: 0.02em;
  }

  .finding .source {
    color: var(--text-mute);
    font-size: 0.72rem;
    margin-left: auto;
  }

  .finding .source code {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--text-mute);
    font-size: inherit;
  }

  .finding-body {
    margin: 0 0 0.55rem;
    color: var(--text-secondary, #cfcfcf);
    font-size: 0.92rem;
    line-height: 1.55;
  }

  .finding .evidence {
    margin: 0 0 0.55rem;
    padding: 0.55rem 0.75rem;
    background: #0a0a0a;
    border: 1px solid #1a1a1a;
    border-radius: 4px;
    overflow-x: auto;
    max-width: 100%;
  }

  .finding .evidence code {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--text-dim);
    font-size: 0.74rem;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .finding .fix {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.86rem;
    line-height: 1.5;
  }

  .finding .fix strong {
    color: var(--gold);
    font-weight: 600;
    margin-right: 0.3rem;
  }

  /* ── Record entry result ─────────────────────────────────────────── */
  .entry-result {
    margin-top: 1.5rem;
    max-width: 56rem;
    padding: 1rem 1.25rem;
    border: 1px solid var(--line, #1f1f1f);
    border-radius: 8px;
    background: var(--bg-1, #111);
  }

  .entry-result > header {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin-bottom: 0.75rem;
  }

  .entry-result > header strong {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.72rem;
    color: var(--cyan);
  }

  .entry-result .copy {
    margin-left: auto;
    background: transparent;
    color: var(--gold);
    border: 1px solid var(--gold-dim, #a08658);
    border-radius: 4px;
    padding: 0.25rem 0.7rem;
    font-size: 0.78rem;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.15s ease;
  }

  .entry-result .copy:hover {
    background: rgba(201, 169, 106, 0.1);
  }

  .entry-result pre {
    margin: 0;
    padding: 0.75rem 1rem;
    background: #0a0a0a;
    border: 1px solid #1a1a1a;
    border-radius: 4px;
    overflow-x: auto;
  }

  .entry-result pre code {
    color: var(--text);
    font-size: 0.86rem;
    line-height: 1.55;
    font-family: ui-monospace, 'SF Mono', monospace;
    white-space: pre-wrap;
  }

  .entry-result .hint {
    margin: 0.75rem 0 0;
    color: var(--text-mute);
    font-size: 0.78rem;
    line-height: 1.5;
  }

  /* ── Drift result reuses .finding ────────────────────────────────── */
  .drift-result {
    margin-top: 1.5rem;
    max-width: 56rem;
  }

  .drift-result > header {
    margin-bottom: 0.75rem;
  }

  .drift-result > header strong {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.72rem;
    color: var(--cyan);
  }

  /* ── Surface threads result ──────────────────────────────────────── */
  .threads-result {
    margin-top: 1.5rem;
    max-width: 56rem;
  }

  .threads-result > header {
    margin-bottom: 0.75rem;
  }

  .threads-result > header strong {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.72rem;
    color: var(--cyan);
  }

  .threads-result ul {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line, #1f1f1f);
  }

  .threads-result li {
    display: flex;
    align-items: baseline;
    gap: 0.85rem;
    padding: 0.55rem 0.6rem;
    border-bottom: 1px solid var(--line, #1f1f1f);
    font-size: 0.88rem;
  }

  .thread-kind {
    flex-shrink: 0;
    padding: 0.05rem 0.5rem;
    border-radius: 999px;
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--gold);
    background: #1a160a;
    border: 1px solid #3a3220;
  }

  .thread-kind.uncommitted {
    color: #f88;
    background: #2a0808;
    border-color: #602020;
  }

  .thread-subject {
    flex: 1;
    color: var(--text-secondary);
  }

  .threads-result .age {
    color: var(--text-mute);
    font-size: 0.76rem;
    font-variant-numeric: tabular-nums;
  }
</style>
