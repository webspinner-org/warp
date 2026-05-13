<script lang="ts">
  let { data, form } = $props();
</script>

<header class="head">
  <p class="back">
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
    <a href="/admin/weavers-tension">← Weaver's Tension</a>
  </p>
  <h1>{data.scenario.title}</h1>
  <p class="lede">{data.scenario.summary}</p>
</header>

{#if form?.topLevelError}
  <div class="banner error" role="alert">
    <strong>{form.topLevelError.kind}</strong>
    {#if form.topLevelError.detail}
      <p>{form.topLevelError.detail}</p>
    {/if}
  </div>
{/if}

<section class="block">
  <h2>{data.scenario.stepCount} steps</h2>
  <ol class="step-preview">
    {#each data.scenario.steps as s, i (s.key)}
      <li>
        <span class="step-num">{i + 1}</span>
        <span class="step-title">{s.title}</span>
      </li>
    {/each}
  </ol>
</section>

<form method="POST" action="?/start" class="start-form">
  <button type="submit" class="primary">Start a new run</button>
  <p class="hint">
    Each run is durable. You can leave it and return — the player resumes where you left off.
  </p>
</form>

<style>
  .head {
    margin: 0 0 1.5rem;
    max-width: 64rem;
  }
  .back {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
  }
  .back a {
    color: #8a8a8a;
    text-decoration: none;
  }
  .back a:hover {
    color: #f7e2a8;
  }
  h1 {
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    font-size: 2.25rem;
    font-weight: 400;
    color: #f7e2a8;
    margin: 0 0 0.5rem;
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
    font-size: 1.2rem;
    font-weight: 400;
    color: #f7e2a8;
    margin: 0 0 1rem;
  }
  .block {
    margin: 2rem 0;
    max-width: 56rem;
  }
  .step-preview {
    list-style: none;
    padding: 0;
    margin: 0;
    counter-reset: step;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .step-preview li {
    display: grid;
    grid-template-columns: 2.5rem 1fr;
    gap: 0.8rem;
    padding: 0.5rem 0.8rem;
    border-left: 2px solid #2a2a2a;
    color: #b5b3aa;
  }
  .step-num {
    color: #8a8a8a;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .step-title {
    color: #cfcdc4;
  }
  .start-form {
    margin: 2rem 0;
    max-width: 56rem;
  }
  .primary {
    background: #2a2a1a;
    color: #f7e2a8;
    border: 1px solid #f7e2a8;
    padding: 0.7rem 1.4rem;
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    font-size: 1.05rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .primary:hover {
    background: #3a3a1a;
  }
  .hint {
    color: #8a8a8a;
    font-size: 0.9rem;
    margin: 0.6rem 0 0;
  }
  .banner.error {
    background: #2a1a1a;
    border: 1px solid #d97870;
    color: #d97870;
    padding: 1rem;
    border-radius: 4px;
    margin: 0 0 1.5rem;
  }
</style>
