<script lang="ts">
  let { data } = $props();
</script>

<header class="head">
  <h1>Weaver's Tension</h1>
  <p class="lede">
    Narrated, gated walkthroughs of the Loom. Pick a scenario; the Loom co-walks you through it,
    asking what was learned at each step. Every observation, every gate, every chat message is
    audited — the run produces a transcript and a design backlog you can use the next iteration.
  </p>
</header>

<section class="block">
  <h2>Scenarios</h2>
  {#if data.scenarios.length === 0}
    <p class="empty">No scenarios on disk. Drop a JSON file into <code>scenarios/</code>.</p>
  {:else}
    <div class="scenario-grid">
      {#each data.scenarios as s (s.slug)}
        <div class="scenario-card">
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a href={`/admin/weavers-tension/${s.slug}`} class="card-body">
            <strong>{s.title}</strong>
            <code class="card-slug">{s.slug}</code>
            <span class="card-summary">{s.summary}</span>
          </a>
          <form
            method="POST"
            action={`/admin/weavers-tension/${s.slug}?/start`}
            class="card-actions"
          >
            <button type="submit" class="card-primary">Start a run</button>
            <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
            <a class="card-secondary" href={`/admin/weavers-tension/${s.slug}`}>Details →</a>
          </form>
        </div>
      {/each}
    </div>
  {/if}
</section>

<section class="block">
  <h2>Recent runs</h2>
  {#if data.runsError}
    <p class="error">Failed to load runs: HTTP {data.runsError.status}</p>
  {:else if data.recentRuns.length === 0}
    <p class="empty">No runs yet. Start one from a scenario above.</p>
  {:else}
    <ul class="run-list">
      {#each data.recentRuns as r (r.runId)}
        <li>
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a href={`/admin/weavers-tension/${r.scenarioSlug}/${r.runId}`} class="run-row">
            <span class="status-badge status-{r.status}">{r.status}</span>
            <span class="scenario">{r.scenarioSlug}</span>
            <span class="step">step {r.currentStepIndex + 1}</span>
            <span class="actor">{r.actorEmail}</span>
            <span class="when">{new Date(r.startedAt).toLocaleString()}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .head {
    margin: 0 0 1.5rem;
    max-width: 64rem;
  }
  h1 {
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    font-size: 2.25rem;
    font-weight: 400;
    color: #f7e2a8;
    margin: 0 0 0.5rem;
    letter-spacing: -0.01em;
  }
  .lede {
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    font-size: 1.1rem;
    line-height: 1.55;
    color: #cfcdc4;
    margin: 0;
    max-width: 56rem;
  }
  h2 {
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    font-size: 1.4rem;
    font-weight: 400;
    color: #f7e2a8;
    margin: 0 0 1rem;
    letter-spacing: -0.005em;
  }
  .block {
    margin: 2rem 0;
    max-width: 72rem;
  }
  .empty {
    color: #888;
    font-style: italic;
  }
  .error {
    color: #d97870;
  }
  .scenario-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
    gap: 1rem;
  }
  .scenario-card {
    display: flex;
    flex-direction: column;
    background: #161616;
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    transition: border-color 150ms ease;
  }
  .scenario-card:hover {
    border-color: #f7e2a8;
  }
  .card-body {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 1rem 1rem 0.6rem;
    color: #cfcdc4;
    text-decoration: none;
  }
  .card-body strong {
    color: #f7e2a8;
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    font-size: 1.15rem;
    font-weight: 500;
  }
  .card-slug {
    font-size: 0.8rem;
    color: #8a8a8a;
  }
  .card-summary {
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    font-size: 0.95rem;
    line-height: 1.45;
    color: #b5b3aa;
  }
  .card-actions {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    padding: 0.6rem 1rem 1rem;
    border-top: 1px solid #1f1f1f;
    margin-top: 0.4rem;
  }
  .card-primary {
    background: #2a2a1a;
    color: #f7e2a8;
    border: 1px solid #f7e2a8;
    padding: 0.4rem 0.9rem;
    border-radius: 3px;
    cursor: pointer;
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    font-size: 0.9rem;
  }
  .card-primary:hover {
    background: #3a3a1a;
  }
  .card-secondary {
    color: #8a8a8a;
    font-size: 0.85rem;
    text-decoration: none;
    margin-left: auto;
  }
  .card-secondary:hover {
    color: #f7e2a8;
  }
  .run-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .run-row {
    display: grid;
    grid-template-columns: 7rem 14rem 5rem 1fr 12rem;
    gap: 0.8rem;
    padding: 0.6rem 1rem;
    background: #161616;
    border: 1px solid #2a2a2a;
    border-radius: 4px;
    color: #cfcdc4;
    text-decoration: none;
    font-size: 0.9rem;
    align-items: center;
  }
  .run-row:hover {
    border-color: #f7e2a8;
  }
  .status-badge {
    text-align: center;
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .status-in-progress {
    background: #2a2a1a;
    color: #f7e2a8;
  }
  .status-completed {
    background: #1a2a1a;
    color: #88c878;
  }
  .status-aborted {
    background: #2a1a1a;
    color: #d97870;
  }
  .scenario {
    color: #f7e2a8;
  }
  .step {
    color: #8a8a8a;
    font-size: 0.85rem;
  }
  .actor {
    color: #b5b3aa;
  }
  .when {
    color: #888;
    font-size: 0.85rem;
    text-align: right;
  }
</style>
