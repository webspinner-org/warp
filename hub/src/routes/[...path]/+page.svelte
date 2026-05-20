<script lang="ts">
  import type { PageData } from './$types.js';
  let { data }: { data: PageData } = $props();

  // ── View Files modal state ──────────────────────────────────
  interface FilesEntry {
    name: string;
    kind: 'dir' | 'file';
    size: number;
    mtime: string;
    mode: string;
  }
  let viewFilesOpen = $state(false);
  let viewListing = $state<{ relPath: string; entries: FilesEntry[] } | null>(null);
  let viewFile = $state<{
    relPath: string;
    size: number;
    mtime: string;
    binary: boolean;
    content?: string;
    placeholder?: string;
  } | null>(null);
  let viewError = $state<string | null>(null);

  async function openViewFiles(relPath: string) {
    viewFilesOpen = true;
    viewFile = null;
    viewError = null;
    viewListing = null;
    try {
      const r = await fetch('/api/storage/files?path=' + encodeURIComponent(relPath));
      const b = (await r.json()) as
        | { ok: true; listing: { relPath: string; entries: FilesEntry[] } }
        | { ok: false; reason: string };
      if (!r.ok || !('ok' in b) || b.ok !== true) {
        viewError = ('reason' in b ? b.reason : null) ?? `HTTP ${r.status}`;
        return;
      }
      viewListing = b.listing;
    } catch (err) {
      viewError = (err as Error).message;
    }
  }

  async function selectFile(name: string) {
    if (!viewListing) return;
    const rel = viewListing.relPath + '/' + name;
    viewError = null;
    viewFile = null;
    try {
      const r = await fetch('/api/storage/file?path=' + encodeURIComponent(rel));
      const b = (await r.json()) as
        | {
            ok: true;
            relPath: string;
            size: number;
            mtime: string;
            binary: boolean;
            content?: string;
            placeholder?: string;
          }
        | { ok: false; reason: string };
      if (!r.ok || !('ok' in b) || b.ok !== true) {
        viewError = ('reason' in b ? b.reason : null) ?? `HTTP ${r.status}`;
        return;
      }
      viewFile = b;
    } catch (err) {
      viewError = (err as Error).message;
    }
  }

  function closeViewFiles() {
    viewFilesOpen = false;
    viewFile = null;
    viewListing = null;
    viewError = null;
  }

  function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  let theme = $state<'light' | 'dark'>('dark');
  $effect(() => {
    if (typeof window !== 'undefined') {
      const t = (window as unknown as { __hubTheme?: { theme: 'light' | 'dark' } }).__hubTheme;
      if (t) theme = t.theme;
    }
  });
  function toggleTheme() {
    const t = (
      window as unknown as { __hubTheme?: { toggle: () => void; theme: 'light' | 'dark' } }
    ).__hubTheme;
    if (t) {
      t.toggle();
      theme = t.theme === 'dark' ? 'light' : 'dark';
    }
  }
  async function logout() {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.href = '/';
  }

  function bytesRelative(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(ms)) return '';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    return `${d}d ago`;
  }
</script>

<svelte:head>
  <title
    >Webspinner Hub · {data.result.kind === 'project' || data.result.kind === 'published-webbase'
      ? data.result.meta.appName
      : 'root'}</title
  >
</svelte:head>

<div class="hub-shell">
  <header class="hub-bar">
    <div class="hub-bar-l">
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a class="hub-brand" href="/">
        <span class="word-w">Webspinner</span><span class="word-h">Hub</span>
      </a>
    </div>
    <div class="hub-bar-r">
      <button class="theme-toggle" type="button" onclick={toggleTheme} aria-label="Toggle theme">
        {#if theme === 'dark'}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4" />
            <path
              d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
            />
          </svg>
          <span>Light</span>
        {:else}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
          </svg>
          <span>Dark</span>
        {/if}
      </button>
      <div class="hub-user">
        <span>{data.user!.email}</span>
        {#if data.user!.isWizard}<span class="wizard-tag">wizard</span>{/if}
        <button type="button" class="signout" onclick={logout}>sign out</button>
      </div>
    </div>
  </header>

  <main class="hub-main">
    <div class="hub-content">
      <nav class="crumbs" aria-label="Breadcrumb">
        <!-- eslint-disable svelte/no-navigation-without-resolve -->
        {#each data.result.breadcrumbs as bc, i (bc.href)}
          {#if i > 0}<span class="sep" aria-hidden="true">/</span>{/if}
          {#if bc.slug === '/'}
            <a
              class="crumb crumb-home"
              class:active={i === data.result.breadcrumbs.length - 1}
              href={bc.href}
              aria-label="Hub root"
              title="Hub root"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M3 11.5 12 4l9 7.5" />
                <path d="M5 10v9.5h4.5V14h5v5.5H19V10" />
              </svg>
            </a>
          {:else}
            <a class="crumb" class:active={i === data.result.breadcrumbs.length - 1} href={bc.href}
              >{bc.displayName}</a
            >
          {/if}
        {/each}
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
      </nav>

      {#if data.result.kind === 'folder'}
        {#if data.result.children.length === 0}
          <section class="empty-archive">
            <svg
              class="empty-mark"
              viewBox="0 0 64 64"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 50 L32 18 L52 50 Z" opacity="0.35" />
              <path d="M18 50 L32 26 L46 50" />
              <path d="M32 50 V58" />
              <path d="M26 58 H38" />
            </svg>
            <h1>Nothing here yet.</h1>
            <p>This folder is empty. Artifacts arrive when they're pushed.</p>
          </section>
        {:else}
          <ul class="tree-list">
            {#each data.result.children as child (child.slug)}
              {@const childHref =
                (data.result.segments.length > 0 ? '/' + data.result.segments.join('/') : '') +
                '/' +
                child.slug}
              <li class="tree-row">
                <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
                <a class="tree-row-link" href={childHref}>
                  {#if child.kind === 'folder'}
                    <span class="tree-icon">📁</span>
                  {:else}
                    <span class="tree-icon">📦</span>
                  {/if}
                  <span class="tree-name">{child.displayName}</span>
                  {#if child.kind === 'folder'}
                    <span class="tree-count mono"
                      >{child.childCount} {child.childCount === 1 ? 'item' : 'items'}</span
                    >
                  {:else if child.projectMeta}
                    <span class="tree-meta mono"
                      >{child.projectMeta.status} · {bytesRelative(
                        child.projectMeta.updatedAt,
                      )}</span
                    >
                  {:else if child.publishedMeta}
                    <span class="tree-meta mono"
                      >v{child.publishedMeta.version} · {bytesRelative(
                        child.publishedMeta.updatedAt,
                      )}</span
                    >
                  {/if}
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      {:else if data.result.kind === 'project'}
        <!-- Project leaf detail — work-in-process Webbase source -->
        {@const parentHref = '/' + data.result.segments.slice(0, -1).join('/')}
        <article class="webbase-detail">
          <header class="wb-head">
            <div class="wb-head-l">
              <h1>{data.result.meta.appName}</h1>
              <div class="wb-badges">
                {#if data.result.meta.domain}
                  <span class="badge-domain mono">{data.result.meta.domain}</span>
                {/if}
                <span class="badge-status mono" data-status={data.result.meta.status}>
                  {data.result.meta.status}
                </span>
              </div>
            </div>
            <div class="wb-head-actions">
              <button
                class="wb-files"
                type="button"
                onclick={() => openViewFiles(data.result.segments.join('/'))}
              >
                <span aria-hidden="true">📂</span>
                <span>View Files</span>
              </button>
              <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
              <a class="wb-close" href={parentHref} aria-label="Close — back to Webbase App">
                <span class="wb-close-x" aria-hidden="true">×</span>
                <span class="wb-close-label">Close</span>
              </a>
            </div>
          </header>

          {#if data.result.meta.patronSentence}
            <p class="wb-sentence">"{data.result.meta.patronSentence}"</p>
          {/if}

          <div class="wb-resume">
            <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
            <a class="btn-resume" href={data.result.meta.resumeUrl} target="_blank" rel="noopener">
              Resume in Try Webspinner →
            </a>
            <span class="resume-hint mono">{data.result.meta.resumeUrl}</span>
          </div>

          <dl class="wb-meta">
            <dt>Session id</dt>
            <dd><code>{data.result.meta.sessionId}</code></dd>
            {#if data.result.meta.appId}
              <dt>App id</dt>
              <dd><code>{data.result.meta.appId}</code></dd>
            {/if}
            {#if data.result.meta.entityCount !== undefined}
              <dt>Entities</dt>
              <dd>{data.result.meta.entityCount}</dd>
            {/if}
            {#if data.result.meta.screenCount !== undefined}
              <dt>Screens</dt>
              <dd>{data.result.meta.screenCount}</dd>
            {/if}
            {#if data.result.meta.builtAt}
              <dt>Built at</dt>
              <dd>
                {new Date(data.result.meta.builtAt).toLocaleString()} ({bytesRelative(
                  data.result.meta.builtAt,
                )})
              </dd>
            {/if}
            <dt>Last updated</dt>
            <dd>
              {new Date(data.result.meta.updatedAt).toLocaleString()} ({bytesRelative(
                data.result.meta.updatedAt,
              )})
            </dd>
          </dl>
        </article>
      {:else}
        <!-- Published Webbase leaf detail — publish-time artifact -->
        {@const parentHref = '/' + data.result.segments.slice(0, -1).join('/')}
        <article class="webbase-detail">
          <header class="wb-head">
            <div class="wb-head-l">
              <h1>{data.result.meta.appName}</h1>
              <div class="wb-badges">
                {#if data.result.meta.domain}
                  <span class="badge-domain mono">{data.result.meta.domain}</span>
                {/if}
                <span class="badge-version mono">v{data.result.meta.version}</span>
                {#if data.result.meta.hasPassphrase}
                  <span class="badge-locked" title="Protected by a passphrase">🔒</span>
                {/if}
              </div>
            </div>
            <div class="wb-head-actions">
              <button
                class="wb-files"
                type="button"
                onclick={() => openViewFiles(data.result.segments.join('/'))}
              >
                <span aria-hidden="true">📂</span>
                <span>View Files</span>
              </button>
              <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
              <a class="wb-close" href={parentHref} aria-label="Close — back to Webbase App">
                <span class="wb-close-x" aria-hidden="true">×</span>
                <span class="wb-close-label">Close</span>
              </a>
            </div>
          </header>

          {#if data.result.meta.patronSentence}
            <p class="wb-sentence">"{data.result.meta.patronSentence}"</p>
          {/if}

          <div class="wb-resume">
            <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
            <a class="btn-resume" href={data.result.meta.openUrl} target="_blank" rel="noopener">
              Open Webbase →
            </a>
            <span class="resume-hint mono">{data.result.meta.openUrl}</span>
          </div>

          <dl class="wb-meta">
            <dt>Short code</dt>
            <dd><code>{data.result.meta.shortCode}</code></dd>
            <dt>Published by</dt>
            <dd>{data.result.meta.senderEmail}</dd>
            <dt>Author Cell</dt>
            <dd>{data.result.meta.cellName}</dd>
            <dt>Cell key fingerprint</dt>
            <dd><code>{data.result.meta.cellKeyFingerprint}</code></dd>
            <dt>Origin app id</dt>
            <dd><code>{data.result.meta.originAppId}</code></dd>
            <dt>Installs</dt>
            <dd>{data.result.meta.installCount} / {data.result.meta.maxInstalls}</dd>
            <dt>Expires</dt>
            <dd>{new Date(data.result.meta.expiresAt).toLocaleDateString()}</dd>
            <dt>First published</dt>
            <dd>
              {new Date(data.result.meta.createdAt).toLocaleString()} ({bytesRelative(
                data.result.meta.createdAt,
              )})
            </dd>
            <dt>Last updated</dt>
            <dd>
              {new Date(data.result.meta.updatedAt).toLocaleString()} ({bytesRelative(
                data.result.meta.updatedAt,
              )})
            </dd>
          </dl>
        </article>
      {/if}
    </div>
  </main>
</div>

<!-- View Files modal — Finder-like browser, two panes: file list + content -->
{#if viewFilesOpen}
  <div
    class="vf-backdrop"
    role="button"
    tabindex="0"
    onclick={closeViewFiles}
    onkeydown={(e) => {
      if (e.key === 'Escape') closeViewFiles();
    }}
  >
    <div
      class="vf-modal"
      role="dialog"
      aria-label="File browser"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <header class="vf-bar">
        <span class="vf-title mono">{viewListing?.relPath ?? '…'}</span>
        <button class="vf-close" type="button" onclick={closeViewFiles} aria-label="Close">×</button
        >
      </header>
      <div class="vf-body">
        <aside class="vf-list">
          {#if viewListing}
            <ul>
              {#each viewListing.entries as e (e.name)}
                <li>
                  <button
                    class="vf-row"
                    type="button"
                    disabled={e.kind === 'dir'}
                    onclick={() => selectFile(e.name)}
                  >
                    <span class="vf-icon">{e.kind === 'dir' ? '📁' : '📄'}</span>
                    <span class="vf-name">{e.name}</span>
                    <span class="vf-size mono">{fmtBytes(e.size)}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {:else if viewError}
            <p class="vf-error">Couldn't list files: {viewError}</p>
          {:else}
            <p class="vf-empty">Loading…</p>
          {/if}
        </aside>
        <section class="vf-content">
          {#if viewFile}
            <header class="vf-content-head mono">
              <span>{viewFile.relPath}</span>
              <span>{fmtBytes(viewFile.size)} · {viewFile.binary ? 'binary' : 'text'}</span>
            </header>
            {#if viewFile.binary}
              <p class="vf-binary">
                <span aria-hidden="true">🔒</span>
                {viewFile.placeholder ?? 'binary file'}
              </p>
            {:else}
              <pre class="vf-pre"><code>{viewFile.content}</code></pre>
            {/if}
          {:else}
            <p class="vf-hint">Select a file on the left to view its contents.</p>
          {/if}
        </section>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Tree list styling */
  .tree-list {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow: var(--shadow-card);
  }
  .tree-row + .tree-row {
    border-top: 1px solid var(--rule-soft);
  }
  .tree-row-link {
    display: grid;
    grid-template-columns: 1.4rem 1fr auto;
    align-items: center;
    gap: 0.7rem;
    padding: 0.8rem 1.1rem;
    color: var(--ink);
    border-bottom: 0;
    transition: background 100ms ease;
  }
  .tree-row-link:hover {
    background: var(--highlight);
    border-bottom: 0;
  }
  .tree-icon {
    font-size: 1rem;
    opacity: 0.9;
  }
  .tree-name {
    font-size: 0.96rem;
    font-weight: 500;
  }
  .tree-count,
  .tree-meta {
    color: var(--ink-muted);
    font-size: 0.78rem;
  }

  /* Webbase detail */
  .webbase-detail {
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    padding: 1.6rem 1.8rem;
  }
  .wb-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 0.6rem;
  }
  .wb-head-l {
    display: flex;
    align-items: baseline;
    gap: 0.9rem;
    flex-wrap: wrap;
    flex: 1 1 auto;
    min-width: 0;
  }
  .wb-head h1 {
    margin: 0;
    font-size: 1.4rem;
    color: var(--ink);
    font-weight: 600;
  }
  .wb-close {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--ink-muted);
    border: 1px solid var(--rule);
    border-radius: 999px;
    padding: 0.32rem 0.7rem 0.32rem 0.55rem;
    text-decoration: none;
    border-bottom: 1px solid var(--rule);
    font-family: var(--font-mono);
    font-size: 0.74rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    transition:
      color 120ms ease,
      border-color 120ms ease,
      background 120ms ease;
    flex: 0 0 auto;
  }
  .wb-close:hover {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--highlight);
  }
  .wb-close-x {
    font-size: 1.05rem;
    line-height: 1;
    text-transform: none;
  }

  .wb-head-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    flex: 0 0 auto;
  }
  .wb-files {
    appearance: none;
    background: transparent;
    color: var(--ink-soft);
    border: 1px solid var(--rule);
    border-radius: 999px;
    padding: 0.32rem 0.75rem 0.32rem 0.6rem;
    font-family: var(--font-mono);
    font-size: 0.74rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    transition:
      color 120ms ease,
      border-color 120ms ease,
      background 120ms ease;
  }
  .wb-files:hover {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--highlight);
  }

  /* View Files modal */
  .vf-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(13, 20, 14, 0.55);
    backdrop-filter: blur(2px);
    display: grid;
    place-items: center;
    padding: clamp(1rem, 4vw, 2.4rem);
    cursor: pointer;
  }
  :global([data-theme='light']) .vf-backdrop {
    background: rgba(31, 46, 30, 0.35);
  }
  .vf-modal {
    width: min(1100px, 96vw);
    height: min(720px, 88vh);
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    display: grid;
    grid-template-rows: auto 1fr;
    overflow: hidden;
    cursor: default;
  }
  .vf-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.65rem 1rem;
    border-bottom: 1px solid var(--rule);
    background: var(--surface-alt);
  }
  .vf-title {
    color: var(--ink-soft);
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vf-close {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--ink-muted);
    font-size: 1.4rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 0.35rem;
  }
  .vf-close:hover {
    color: var(--accent);
  }
  .vf-body {
    display: grid;
    grid-template-columns: 280px 1fr;
    overflow: hidden;
  }
  .vf-list {
    border-right: 1px solid var(--rule);
    overflow-y: auto;
    background: var(--surface);
  }
  .vf-list ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .vf-row {
    display: grid;
    grid-template-columns: 1.4rem 1fr auto;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    padding: 0.5rem 0.85rem;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--rule-soft);
    color: var(--ink);
    cursor: pointer;
    text-align: left;
    font: inherit;
  }
  .vf-row:hover:not(:disabled) {
    background: var(--highlight);
  }
  .vf-row:disabled {
    color: var(--ink-muted);
    cursor: default;
  }
  .vf-icon {
    font-size: 0.95rem;
  }
  .vf-name {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vf-size {
    color: var(--ink-muted);
    font-size: 0.74rem;
  }
  .vf-content {
    overflow: auto;
    padding: 1rem 1.2rem;
  }
  .vf-content-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    color: var(--ink-muted);
    font-size: 0.78rem;
    border-bottom: 1px solid var(--rule);
    padding-bottom: 0.55rem;
    margin-bottom: 0.7rem;
  }
  .vf-pre {
    margin: 0;
    background: var(--surface-alt);
    border: 1px solid var(--rule);
    border-radius: var(--radius-md);
    padding: 0.85rem;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 0.82rem;
    line-height: 1.45;
    color: var(--ink);
    max-height: calc(100% - 4rem);
    white-space: pre;
  }
  .vf-binary {
    color: var(--ink-muted);
    font-style: italic;
  }
  .vf-hint,
  .vf-empty {
    color: var(--ink-muted);
    padding: 1rem;
  }
  .vf-error {
    color: #c87268;
    padding: 1rem;
  }
  .wb-badges {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .badge-domain,
  .badge-version {
    background: var(--highlight);
    color: var(--accent);
    border-radius: 4px;
    padding: 0.1rem 0.5rem;
    font-size: 0.72rem;
    letter-spacing: 0.04em;
  }
  .badge-locked {
    color: var(--glow);
    font-size: 0.9rem;
  }
  .badge-status {
    background: var(--surface-alt);
    color: var(--ink-soft);
    border-radius: 4px;
    padding: 0.1rem 0.5rem;
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border: 1px solid var(--rule);
  }
  .badge-status[data-status='built'] {
    background: var(--highlight);
    color: var(--accent);
    border-color: var(--accent);
  }
  .badge-status[data-status='ready'] {
    background: rgba(217, 161, 87, 0.14);
    color: var(--glow);
    border-color: var(--glow);
  }
  .wb-sentence {
    margin: 0.4rem 0 1rem;
    font-style: italic;
    color: var(--ink-soft);
  }
  .wb-resume {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin: 0 0 1.4rem;
    flex-wrap: wrap;
  }
  .btn-resume {
    appearance: none;
    background: linear-gradient(135deg, var(--accent), var(--accent-soft));
    color: var(--bg);
    border: 0;
    border-radius: var(--radius-md);
    padding: 0.55rem 1.1rem;
    font-weight: 600;
    font-size: 0.92rem;
    text-decoration: none;
    border-bottom: 0;
  }
  .btn-resume:hover {
    filter: brightness(1.05);
    border-bottom: 0;
  }
  .resume-hint {
    color: var(--ink-muted);
    font-size: 0.78rem;
    word-break: break-all;
  }
  .wb-meta {
    display: grid;
    grid-template-columns: 11rem 1fr;
    row-gap: 0.55rem;
    column-gap: 0.7rem;
    margin: 0;
  }
  .wb-meta dt {
    font-size: 0.74rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-muted);
    font-family: var(--font-mono);
    align-self: center;
  }
  .wb-meta dd {
    margin: 0;
    color: var(--ink);
    font-size: 0.94rem;
    word-break: break-word;
  }
  .wb-meta code,
  .wb-meta .ext {
    font-family: var(--font-mono);
    font-size: 0.86rem;
  }
  .wb-meta .ext {
    color: var(--accent);
    word-break: break-all;
  }
  .signout {
    appearance: none;
    background: transparent;
    border: 0;
    cursor: pointer;
    color: var(--ink-muted);
    font: inherit;
    font-size: 0.85rem;
  }
  .signout:hover {
    color: var(--ink);
  }
</style>
