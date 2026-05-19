<script lang="ts">
  import { onMount } from 'svelte';
  import type { PageData } from './$types.js';
  let { data }: { data: PageData } = $props();

  let splashOpen = $state(true);
  let theme = $state<'light' | 'dark'>('dark');

  // ── Login state (only used when !data.authed) ──
  let phase = $state<'email' | 'code' | 'sending' | 'verifying' | 'done'>('email');
  let email = $state('');
  let code = $state('');
  let loginError = $state<string | null>(null);

  $effect(() => {
    if (typeof window !== 'undefined') {
      const t = (window as unknown as { __hubTheme?: { theme: 'light' | 'dark' } }).__hubTheme;
      if (t) theme = t.theme;
    }
  });

  onMount(() => {
    function onKey(e: KeyboardEvent) {
      if (!splashOpen) return;
      if (e.key === 'Escape') return;
      e.preventDefault();
      dismissSplash();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function dismissSplash() {
    splashOpen = false;
  }

  function toggleTheme() {
    const t = (
      window as unknown as { __hubTheme?: { toggle: () => void; theme: 'light' | 'dark' } }
    ).__hubTheme;
    if (t) {
      t.toggle();
      theme = t.theme === 'dark' ? 'light' : 'dark';
    }
  }

  async function sendCode() {
    phase = 'sending';
    loginError = null;
    try {
      const r = await fetch('/auth/email/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b?.ok) {
        loginError = b?.reason ?? `HTTP ${r.status}`;
        phase = 'email';
        return;
      }
      phase = 'code';
    } catch (err) {
      loginError = (err as Error).message;
      phase = 'email';
    }
  }

  async function verifyCode() {
    phase = 'verifying';
    loginError = null;
    try {
      const r = await fetch('/auth/email/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.trim() }),
      });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b?.ok) {
        loginError = b?.reason ?? `HTTP ${r.status}`;
        phase = 'code';
        return;
      }
      // Reload so the cookie picks up server-side and we transition
      // into the authed view via locals.user.
      window.location.reload();
    } catch (err) {
      loginError = (err as Error).message;
      phase = 'code';
    }
  }

  async function logout() {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.reload();
  }
</script>

<svelte:head>
  <title>Webspinner Hub</title>
</svelte:head>

<!-- Splash overlay — centered modal card sized smaller than the landing
     page (per feedback_splash_overlay). Dismissed by any key or click. -->
{#if splashOpen}
  <div
    class="splash-backdrop"
    role="button"
    tabindex="0"
    onclick={dismissSplash}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        dismissSplash();
      }
    }}
    aria-label="Press any key to enter Webspinner Hub"
  >
    <article class="splash-card">
      <!-- The splash image is the entire composition. Use a real <img>
           so the source's native aspect ratio (1808x870, ~2.08:1)
           drives the card's shape — no cropping, no overlay. -->
      <img class="splash-img" src="/splash.png" alt="Webspinner Hub" />
      <button
        class="splash-cta"
        type="button"
        onclick={(e) => {
          e.stopPropagation();
          dismissSplash();
        }}
      >
        Press any key to enter
      </button>
    </article>
  </div>
{/if}

<!-- Behind-splash content: login form when !authed, empty root when authed -->
{#if !data.authed}
  <div class="login-shell">
    <article class="login-card">
      <svg
        class="login-mark"
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
      <h1>Sign in to the Hub</h1>
      <p class="lede">Enter your email — we'll send a one-time code.</p>

      {#if phase === 'email' || phase === 'sending'}
        <form
          class="login-form"
          onsubmit={(e) => {
            e.preventDefault();
            if (phase !== 'sending') sendCode();
          }}
        >
          <label for="login-email">Email address</label>
          <input
            id="login-email"
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
          <p class="sent-note">Code sent to <strong>{email}</strong>. Check your inbox.</p>
          <label for="login-code">6-digit code</label>
          <input
            id="login-code"
            inputmode="numeric"
            pattern={'[0-9]{6}'}
            maxlength="6"
            bind:value={code}
            placeholder="000000"
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
              loginError = null;
            }}>← change email</button
          >
        </form>
      {/if}

      {#if loginError}<p class="login-error">{loginError}</p>{/if}
    </article>
  </div>
{:else}
  <div class="hub-shell">
    <header class="hub-bar">
      <div class="hub-bar-l">
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
        <a class="hub-brand" href="/">
          <span class="word-w">Webspinner</span><span class="word-h">Hub</span>
          <span class="sub">root</span>
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
          {#if data.user!.isWizard}
            <span class="wizard-tag">wizard</span>
          {/if}
          <button type="button" class="signout" onclick={logout}>sign out</button>
        </div>
      </div>
    </header>

    <main class="hub-main">
      <div class="hub-content">
        <nav class="crumbs" aria-label="Breadcrumb">
          <span class="crumb active">/</span>
        </nav>

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
          <h1>The Hub is empty.</h1>
          <p>
            Nothing is stored at the root yet. Source code, Spinners, manuscripts, and other
            artifacts will appear here as they're pushed.
          </p>
          <div class="hint mono">root · {data.user!.email}</div>
        </section>
      </div>
    </main>
  </div>
{/if}

<style>
  /* Splash overlay — centered MODAL card sized smaller than the viewport
   * (per feedback_splash_overlay). The page (login form or empty root)
   * remains visible around the splash card's edges. Backdrop is a
   * subtle scrim catching clicks/keypresses to dismiss. */
  .splash-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    padding: clamp(1rem, 5vw, 3rem);
    background: rgba(13, 20, 14, 0.55);
    backdrop-filter: blur(2px);
    cursor: pointer;
    user-select: none;
    animation: splash-in 220ms ease;
  }
  :global([data-theme='light']) .splash-backdrop {
    background: rgba(31, 46, 30, 0.35);
  }
  @keyframes splash-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .splash-card {
    /* Sized smaller than the viewport — page peeks through around it.
     * The <img> inside dictates the aspect ratio (image is 1808x870,
     * ~2.08:1). NO forced aspect-ratio on the card. NO cropping. */
    position: relative;
    width: min(1100px, 90vw);
    max-height: 86vh;
    border-radius: 16px;
    border: 1px solid rgba(74, 213, 122, 0.3);
    box-shadow:
      0 24px 60px -20px rgba(0, 0, 0, 0.55),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    overflow: hidden;
    cursor: pointer;
    line-height: 0;
  }
  :global([data-theme='light']) .splash-card {
    border-color: rgba(42, 138, 74, 0.35);
  }
  .splash-img {
    display: block;
    width: 100%;
    height: auto;
    max-height: 86vh;
    object-fit: contain;
  }

  /* "Press any key to enter" — small pill anchored at the bottom edge
   * with a narrow blur-scrim only under the hint, so the artwork above
   * stays untouched. */
  .splash-cta {
    appearance: none;
    position: absolute;
    left: 50%;
    bottom: clamp(0.9rem, 2.2vw, 1.6rem);
    transform: translateX(-50%);
    background: rgba(13, 20, 14, 0.62);
    color: #e8e4d4;
    border: 1px solid rgba(232, 228, 212, 0.45);
    border-radius: 999px;
    padding: 0.55rem 1.2rem;
    font-family: var(--font-mono);
    font-size: clamp(0.66rem, 0.95vw, 0.74rem);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    cursor: pointer;
    backdrop-filter: blur(6px);
    transition:
      background 120ms ease,
      transform 120ms ease,
      border-color 120ms ease;
  }
  .splash-cta:hover {
    background: rgba(74, 213, 122, 0.32);
    border-color: rgba(232, 228, 212, 0.85);
    transform: translate(-50%, -1px);
  }

  /* Login form inside the login-card */
  .login-form {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    margin-top: 1rem;
    text-align: left;
  }
  .login-form label {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }
  .login-form input {
    appearance: none;
    background: var(--bg);
    color: var(--ink);
    border: 1px solid var(--rule);
    border-radius: var(--radius-md);
    padding: 0.55rem 0.7rem;
    font-size: 1rem;
    font-family: var(--font-prose);
  }
  .login-form input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .login-form button[type='submit'] {
    appearance: none;
    background: var(--ink);
    color: var(--bg);
    border: 0;
    border-radius: var(--radius-md);
    padding: 0.6rem 1rem;
    font-weight: 600;
    cursor: pointer;
    margin-top: 0.3rem;
  }
  .login-form button[type='submit']:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .login-form .sent-note {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.92rem;
  }
  .login-form .link {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
    font-size: 0.85rem;
    align-self: flex-start;
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
