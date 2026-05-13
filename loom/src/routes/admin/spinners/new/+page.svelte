<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';

  let { data, form } = $props();

  let template = $state(data.templates[0]?.name ?? '');
  let slug = $state(form?.fields?.slug ?? '');
  let displayName = $state(form?.fields?.displayName ?? '');
  let description = $state(form?.fields?.description ?? '');
  let scope = $state(form?.fields?.scope ?? data.defaults.scope);
  let advancedOpen = $state(false);
  let submitting = $state(false);
  let slugCheckState = $state<'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'unknown'>(
    'idle',
  );

  const selectedTemplate = $derived(
    data.templates.find((t) => t.name === template) ?? data.templates[0],
  );

  // Auto-suggest displayName from slug while displayName is empty.
  // Once the Webspinner has typed something into displayName, stop.
  let displayNameTouched = $state(false);
  $effect(() => {
    if (!displayNameTouched && slug.length > 0) {
      displayName = slug
        .split('-')
        .filter((s) => s.length > 0)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');
    }
  });

  async function onSlugBlur() {
    if (slug.length === 0) {
      slugCheckState = 'idle';
      return;
    }
    slugCheckState = 'checking';
    const fd = new FormData();
    fd.append('slug', slug);
    try {
      const res = await fetch('?/checkSlug', { method: 'POST', body: fd });
      const result = (await res.json()) as { data?: unknown };
      // SvelteKit form-action responses wrap returned data in `data`.
      // The `data` is a JSON-encoded string (SvelteKit's serialization).
      const payload = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
      if (
        payload &&
        typeof payload === 'object' &&
        'check' in payload &&
        typeof (payload as { check: unknown }).check === 'string'
      ) {
        const check = (payload as { check: string }).check;
        slugCheckState =
          check === 'available' || check === 'taken' || check === 'invalid' || check === 'unknown'
            ? (check as typeof slugCheckState)
            : 'unknown';
      } else {
        slugCheckState = 'unknown';
      }
    } catch {
      slugCheckState = 'unknown';
    }
  }
</script>

<header class="head">
  <p class="back">
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
    <a href="/admin/spinners">← Spinners</a>
  </p>
  <h1>Author a new Spinner</h1>
  <p class="lede">
    Pick a template, name your Spinner, and let the Loom take it from there: lint, sign with this
    Cell's identity, register in the Skein, and bring you to the new Spinner's detail page —
    runnable in under five seconds.
  </p>
</header>

{#if form?.topLevelError}
  <div class="banner error" role="alert">
    <strong>{form.topLevelError.kind}</strong>
    {#if form.topLevelError.detail}
      <p>{form.topLevelError.detail}</p>
    {/if}
  </div>
{/if}

<form
  method="POST"
  action="?/author"
  class="author-form"
  use:enhance={() => {
    submitting = true;
    return async ({ result, update }) => {
      submitting = false;
      // For redirects (success) and failures, let SvelteKit handle the
      // response. We just need to re-render with form data.
      await update();
      if (result.type !== 'redirect') {
        await invalidateAll();
      }
    };
  }}
>
  <!-- Template picker -->
  <section class="block">
    <h2>Template</h2>
    <p class="hint">
      Each template is a starting point. {data.templates.length} template{data.templates.length ===
      1
        ? ''
        : 's'} available.
    </p>
    <div class="template-grid">
      {#each data.templates as t (t.name)}
        <label class="template-card" class:active={template === t.name}>
          <input
            type="radio"
            name="template"
            value={t.name}
            checked={template === t.name}
            onchange={() => (template = t.name)}
          />
          <span class="card-body">
            <strong>{t.displayName}</strong>
            <code class="card-name">{t.name}</code>
            <span class="card-desc">{t.description}</span>
          </span>
        </label>
      {/each}
    </div>
    {#if form?.errors?.template}
      <p class="field-error">{form.errors.template}</p>
    {/if}
  </section>

  <!-- Slug -->
  <section class="block">
    <label class="field" for="slug-input">
      <span class="field-label">Slug</span>
      <span class="field-hint">
        Kebab-case identifier. Becomes the directory name + URL segment. Cannot be changed later.
      </span>
      <input
        id="slug-input"
        name="slug"
        type="text"
        bind:value={slug}
        onblur={onSlugBlur}
        placeholder="my-bakery"
        autocomplete="off"
        spellcheck="false"
        required
      />
      {#if slugCheckState === 'available'}
        <span class="slug-status ok">✓ available</span>
      {:else if slugCheckState === 'taken'}
        <span class="slug-status bad">✗ already installed</span>
      {:else if slugCheckState === 'invalid'}
        <span class="slug-status bad">✗ invalid pattern</span>
      {:else if slugCheckState === 'checking'}
        <span class="slug-status">checking…</span>
      {/if}
    </label>
    {#if form?.errors?.slug}
      <p class="field-error">{form.errors.slug}</p>
    {/if}
  </section>

  <!-- Display name -->
  <section class="block">
    <label class="field" for="dn-input">
      <span class="field-label">Display name</span>
      <span class="field-hint">
        Human-readable name shown in the Skein and on the Spinner detail page.
      </span>
      <input
        id="dn-input"
        name="displayName"
        type="text"
        bind:value={displayName}
        oninput={() => (displayNameTouched = true)}
        placeholder="My Bakery"
        maxlength="64"
        required
      />
    </label>
    {#if form?.errors?.displayName}
      <p class="field-error">{form.errors.displayName}</p>
    {/if}
  </section>

  <!-- Description -->
  <section class="block">
    <label class="field" for="desc-input">
      <span class="field-label">Description</span>
      <span class="field-hint"> One paragraph about what this Spinner does. </span>
      <textarea
        id="desc-input"
        name="description"
        bind:value={description}
        rows="4"
        maxlength="2048"
        placeholder="A Spinner that greets customers of my bakery in Asheville."
        required
      ></textarea>
    </label>
    {#if form?.errors?.description}
      <p class="field-error">{form.errors.description}</p>
    {/if}
  </section>

  <!-- Advanced -->
  <details class="advanced" bind:open={advancedOpen}>
    <summary>Advanced</summary>
    <section class="block">
      <label class="field" for="scope-input">
        <span class="field-label">Scope</span>
        <span class="field-hint">
          Namespace prefix for the Spinner name. Default is <code>@local</code>. Use a different
          scope if you plan to publish this Spinner outside this Cell.
        </span>
        <input
          id="scope-input"
          name="scope"
          type="text"
          bind:value={scope}
          placeholder="@local"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      {#if form?.errors?.scope}
        <p class="field-error">{form.errors.scope}</p>
      {/if}
    </section>
  </details>

  {#if selectedTemplate}
    <section class="block preview">
      <h2>Preview</h2>
      <p class="hint">What will land on disk + in the Skein:</p>
      <dl class="preview-fields">
        <dt>Name</dt>
        <dd><code>{scope}/{slug || '<slug>'}</code></dd>
        <dt>Bundle path</dt>
        <dd><code>~/Cells/spinners/{slug || '<slug>'}/</code></dd>
        <dt>Template</dt>
        <dd>{selectedTemplate.displayName} <code>v{selectedTemplate.version}</code></dd>
        <dt>Capability</dt>
        <dd>Whatever the template defines (hello-spinner: <code>greet</code>)</dd>
      </dl>
    </section>
  {/if}

  <div class="actions">
    <button type="submit" class="primary" disabled={submitting}>
      {submitting ? 'Authoring…' : 'Author the Spinner'}
    </button>
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
    <a class="secondary" href={submitting ? undefined : '/admin/spinners'}>Cancel</a>
  </div>
</form>

<style>
  .head {
    margin: 0 0 1.5rem;
    max-width: 64rem;
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

  .banner {
    border: 1px solid;
    border-radius: 6px;
    padding: 0.85rem 1rem;
    margin: 0 0 1rem;
    max-width: 64rem;
  }
  .banner.error {
    background: #2a0808;
    border-color: #602020;
    color: #fbb;
  }
  .banner strong {
    font-family: var(--font-mono);
    font-size: 0.88rem;
  }
  .banner p {
    margin: 0.3rem 0 0;
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .author-form {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    max-width: 64rem;
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .block h2 {
    margin: 0;
    color: var(--gold-dim);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
  }

  .hint {
    margin: 0;
    color: var(--text-mute);
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .template-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
    gap: 0.75rem;
  }
  .template-card {
    cursor: pointer;
    display: block;
    background: var(--bg-1);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0.85rem 1rem;
    transition: border-color 0.12s ease;
  }
  .template-card:hover {
    border-color: var(--gold-dim);
  }
  .template-card.active {
    border-color: var(--cyan);
    background: rgba(95, 207, 224, 0.06);
  }
  .template-card input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .card-body {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .card-body strong {
    color: var(--gold);
    font-family: var(--font-prose);
    font-size: 1rem;
  }
  .card-name {
    color: var(--text-mute);
    font-family: var(--font-mono);
    font-size: 0.78rem;
  }
  .card-desc {
    color: var(--text-secondary);
    font-size: 0.86rem;
    line-height: 1.5;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .field-label {
    color: var(--text-mute);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.7rem;
    font-weight: 600;
  }
  .field-hint {
    color: var(--text-mute);
    font-size: 0.82rem;
    line-height: 1.5;
  }
  .field-hint code {
    background: var(--bg-1);
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 1px 5px;
    font-family: var(--font-mono);
    font-size: 0.9em;
  }
  input[type='text'],
  textarea {
    background: var(--bg-1);
    border: 1px solid var(--line);
    color: var(--text);
    padding: 0.55rem 0.8rem;
    border-radius: 5px;
    font-family: inherit;
    font-size: 0.92rem;
    transition: border-color 0.12s ease;
  }
  input[type='text']:focus,
  textarea:focus {
    outline: none;
    border-color: var(--cyan);
  }
  textarea {
    resize: vertical;
    line-height: 1.55;
  }

  .field-error {
    margin: 0;
    color: #f88;
    font-size: 0.85rem;
    font-family: var(--font-mono);
  }
  .slug-status {
    font-size: 0.78rem;
    color: var(--text-mute);
    margin-top: 0.2rem;
  }
  .slug-status.ok {
    color: var(--cyan);
  }
  .slug-status.bad {
    color: #f88;
  }

  .advanced summary {
    cursor: pointer;
    color: var(--text-mute);
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.4rem 0;
  }
  .advanced[open] summary {
    color: var(--gold-dim);
    margin-bottom: 0.8rem;
  }

  .preview-fields {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.3rem 1.2rem;
    margin: 0;
    font-size: 0.88rem;
  }
  .preview-fields dt {
    color: var(--text-mute);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.7rem;
    align-self: baseline;
  }
  .preview-fields dd {
    margin: 0;
    color: var(--text-secondary);
  }
  .preview-fields dd code {
    background: var(--bg-1);
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 1px 6px;
    font-family: var(--font-mono);
    font-size: 0.88em;
  }

  .actions {
    display: flex;
    gap: 0.85rem;
    align-items: center;
    margin-top: 1rem;
  }
  .primary {
    background: var(--gold);
    color: var(--bg-0);
    border: 0;
    padding: 0.7rem 1.4rem;
    border-radius: 5px;
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition:
      background 0.12s ease,
      transform 0.12s ease;
  }
  .primary:hover:not(:disabled) {
    background: #d8b876;
  }
  .primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .secondary {
    color: var(--text-mute);
    text-decoration: none;
    font-size: 0.9rem;
    padding: 0.4rem 0.6rem;
  }
  .secondary:hover {
    color: var(--cyan);
  }
</style>
