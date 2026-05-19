<script lang="ts">
  import type { DashboardData } from '$lib/server/author-dashboard.js';
  let { data }: { data: DashboardData } = $props();
  let email = $state('');
  let code = $state('');
  let phase = $state<'email' | 'code' | 'sending' | 'verifying'>('email');
  let error = $state<string | null>(null);
  let copyState = $state<Record<string, 'idle' | 'copied'>>({});

  async function sendCode() {
    phase = 'sending';
    error = null;
    const r = await fetch('/author/login/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body?.ok) {
      error = body?.reason ?? `HTTP ${r.status}`;
      phase = 'email';
      return;
    }
    phase = 'code';
  }

  async function verifyCode() {
    phase = 'verifying';
    error = null;
    const r = await fetch('/author/login/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.trim() }),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body?.ok) {
      error = body?.reason ?? `HTTP ${r.status}`;
      phase = 'code';
      return;
    }
    // Reload to pick up the cookie + list.
    window.location.reload();
  }

  async function logout() {
    await fetch('/author/logout', { method: 'POST' });
    window.location.reload();
  }

  function urlFor(shortCode: string, token: string): string {
    return `${window.location.origin}/app/${shortCode}?t=${token}`;
  }

  async function copyLink(shortCode: string, token: string) {
    const url = urlFor(shortCode, token);
    await navigator.clipboard.writeText(url);
    copyState[shortCode] = 'copied';
    setTimeout(() => {
      copyState = { ...copyState, [shortCode]: 'idle' };
    }, 1400);
  }

  function relativeAgo(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    return `${d}d ago`;
  }

  function expiresLabel(iso: string): string {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms < 0) return 'expired';
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    return `${days}d left`;
  }
</script>

<svelte:head>
  <title>Your published Webbases</title>
</svelte:head>

{#if !data.authed}
  <section class="login-shell">
    <header class="login-head">
      <h1>Your Webbases</h1>
      <p>Sign in with the email you used when you published.</p>
    </header>

    {#if phase === 'email' || phase === 'sending'}
      <form
        class="login-form"
        onsubmit={(e) => {
          e.preventDefault();
          if (phase !== 'sending') sendCode();
        }}
      >
        <label for="email">Email address</label>
        <input
          id="email"
          type="email"
          bind:value={email}
          required
          autocomplete="email"
          placeholder="you@example.com"
        />
        <button type="submit" disabled={phase === 'sending' || !email}>
          {phase === 'sending' ? 'Sending…' : 'Send code'}
        </button>
      </form>
    {:else if phase === 'code' || phase === 'verifying'}
      <form
        class="login-form"
        onsubmit={(e) => {
          e.preventDefault();
          if (phase !== 'verifying') verifyCode();
        }}
      >
        <p class="sent-note">Code sent to <strong>{email}</strong>. Enter it below.</p>
        <label for="code">6-digit code</label>
        <input
          id="code"
          inputmode="numeric"
          pattern={'[0-9]{6}'}
          maxlength="6"
          bind:value={code}
          placeholder="000000"
          autofocus
        />
        <button type="submit" disabled={phase === 'verifying' || code.length !== 6}>
          {phase === 'verifying' ? 'Verifying…' : 'Sign in'}
        </button>
        <button
          type="button"
          class="link"
          onclick={() => {
            phase = 'email';
            code = '';
          }}>← change email</button
        >
      </form>
    {/if}

    {#if error}
      <p class="error">{error}</p>
    {/if}
  </section>
{:else}
  <section class="dash-shell">
    <header class="dash-head">
      <div>
        <h1>Your Webbases</h1>
        <p class="dash-sub">
          Signed in as <strong>{data.email}</strong>
          <button class="link" onclick={logout}>sign out</button>
        </p>
      </div>
      <a class="build-cta" href="https://try.webspinner.ai">+ Build a new Webbase</a>
    </header>

    {#if data.items.length === 0}
      <div class="empty">
        <h2>Nothing published yet</h2>
        <p>
          Build something at <a href="https://try.webspinner.ai">try.webspinner.ai</a> and click
          <em>Publish</em>. It'll show up here.
        </p>
      </div>
    {:else}
      <ul class="webbase-grid">
        {#each data.items as item (item.id)}
          <li class="webbase-card">
            <header>
              <h2>{item.appName || '(unnamed Webbase)'}</h2>
              {#if item.domain}
                <span class="badge-domain">{item.domain}</span>
              {/if}
              <span class="badge-version">v{item.version}</span>
              {#if item.hasPassphrase}
                <span class="badge-locked" title="Protected by a passphrase">🔒</span>
              {/if}
            </header>

            {#if item.patronSentence}
              <p class="sentence">"{item.patronSentence}"</p>
            {/if}

            <dl class="meta">
              <dt>Last published</dt>
              <dd>{relativeAgo(item.updatedAt)}</dd>
              <dt>Installs</dt>
              <dd>{item.installCount} / {item.maxInstalls}</dd>
              <dt>Expires</dt>
              <dd>{expiresLabel(item.expiresAt)}</dd>
            </dl>

            <div class="actions">
              <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
              <a class="btn-primary" href={`/app/${item.shortCode}?t=${item.installToken}`}>
                Open
              </a>
              <button
                class="btn-secondary"
                onclick={() => copyLink(item.shortCode, item.installToken)}
              >
                {copyState[item.shortCode] === 'copied' ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  :global(body) {
    background: #15151a;
  }
  .login-shell,
  .dash-shell {
    max-width: 940px;
    margin: 3rem auto;
    padding: 0 1.4rem;
    color: #e8e4dc;
    font-family: ui-sans-serif, system-ui, sans-serif;
  }
  .login-head h1,
  .dash-head h1 {
    font-family: serif;
    font-size: 1.85rem;
    margin: 0 0 0.4rem;
    color: #f5eedd;
    font-weight: 500;
  }
  .login-head p,
  .dash-sub {
    margin: 0;
    color: #cfc6b3;
  }
  .login-form {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    margin-top: 1.5rem;
    max-width: 380px;
    background: #1c1c22;
    border: 1px solid #34373d;
    border-radius: 12px;
    padding: 1.4rem 1.6rem;
  }
  .login-form label {
    font-size: 0.78rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #9a9189;
    font-family: ui-monospace, monospace;
  }
  .login-form input {
    appearance: none;
    background: #15151a;
    color: #f0e9d8;
    border: 1px solid #34373d;
    border-radius: 6px;
    padding: 0.55rem 0.7rem;
    font-size: 1rem;
    font-family: ui-monospace, monospace;
  }
  .login-form input:focus {
    outline: none;
    border-color: #d4a574;
  }
  .login-form button[type='submit'] {
    appearance: none;
    background: linear-gradient(135deg, #d4a574, #b88a3a);
    color: #1a1410;
    border: 0;
    border-radius: 8px;
    padding: 0.55rem 1.1rem;
    font-weight: 600;
    cursor: pointer;
    margin-top: 0.4rem;
  }
  .login-form button[type='submit']:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .login-form .sent-note {
    margin: 0;
    color: #cfc6b3;
    font-size: 0.92rem;
  }
  .link {
    background: transparent;
    border: 0;
    color: #d4a574;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
    font-size: inherit;
  }
  .error {
    margin-top: 0.9rem;
    padding: 0.7rem 0.9rem;
    background: rgba(200, 116, 104, 0.1);
    border: 1px solid rgba(200, 116, 104, 0.4);
    border-radius: 6px;
    color: #f0e9d8;
  }

  .dash-head {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }
  .build-cta {
    appearance: none;
    background: transparent;
    color: #d4a574;
    border: 1px solid #d4a574;
    border-radius: 8px;
    padding: 0.5rem 1rem;
    font-weight: 600;
    text-decoration: none;
    font-size: 0.92rem;
  }
  .build-cta:hover {
    background: rgba(212, 165, 116, 0.08);
  }

  .empty {
    margin-top: 2rem;
    padding: 2rem;
    background: #1c1c22;
    border: 1px dashed #34373d;
    border-radius: 12px;
    text-align: center;
    color: #cfc6b3;
  }
  .empty h2 {
    font-family: serif;
    color: #f5eedd;
    margin: 0 0 0.5rem;
  }
  .empty a {
    color: #d4a574;
  }

  .webbase-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }
  .webbase-card {
    background: #1c1c22;
    border: 1px solid #34373d;
    border-radius: 12px;
    padding: 1.05rem 1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .webbase-card header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .webbase-card h2 {
    margin: 0;
    font-family: serif;
    font-size: 1.15rem;
    color: #f5eedd;
    font-weight: 600;
  }
  .badge-domain,
  .badge-version,
  .badge-locked {
    font-size: 0.72rem;
    font-family: ui-monospace, monospace;
    background: rgba(212, 165, 116, 0.12);
    color: #d4a574;
    border-radius: 4px;
    padding: 0.05rem 0.4rem;
    letter-spacing: 0.04em;
  }
  .badge-locked {
    background: rgba(255, 220, 120, 0.15);
    color: #ffd87a;
  }
  .sentence {
    margin: 0;
    color: #cfc6b3;
    font-style: italic;
    font-size: 0.92rem;
    line-height: 1.4;
  }
  .meta {
    display: grid;
    grid-template-columns: 8rem 1fr;
    gap: 0.3rem 0.6rem;
    margin: 0.2rem 0 0;
    font-size: 0.84rem;
  }
  .meta dt {
    color: #9a9189;
    text-transform: uppercase;
    font-family: ui-monospace, monospace;
    letter-spacing: 0.06em;
    font-size: 0.72rem;
    align-self: center;
  }
  .meta dd {
    margin: 0;
    color: #f0e9d8;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .btn-primary,
  .btn-secondary {
    appearance: none;
    border-radius: 6px;
    padding: 0.45rem 0.85rem;
    font-weight: 600;
    font-size: 0.88rem;
    cursor: pointer;
    text-decoration: none;
    border: 0;
  }
  .btn-primary {
    background: linear-gradient(135deg, #d4a574, #b88a3a);
    color: #1a1410;
  }
  .btn-secondary {
    background: transparent;
    color: #d4a574;
    border: 1px solid #34373d;
  }
  .btn-secondary:hover {
    border-color: #d4a574;
  }
</style>
