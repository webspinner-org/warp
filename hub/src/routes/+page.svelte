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
      <div class="splash-content">
        <p class="splash-tag">Webspinner ECO System</p>
        <h1 class="splash-title">Webspinner <span class="accent">Hub</span></h1>
        <p class="splash-lede">Where knowledge is gathered. Where innovation is built.</p>
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
      </div>
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
    /* sized smaller than the viewport — page peeks through around it */
    width: min(900px, 88vw);
    aspect-ratio: 16 / 9;
    max-height: 82vh;
    border-radius: 16px;
    border: 1px solid rgba(74, 213, 122, 0.25);
    box-shadow:
      0 24px 60px -20px rgba(0, 0, 0, 0.55),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    background-image:
      linear-gradient(180deg, rgba(19, 30, 22, 0.45), rgba(19, 30, 22, 0.78)), url('/splash.png');
    background-size: cover;
    background-position: center;
    color: #e8e4d4;
    font-family: var(--font-prose);
    display: grid;
    place-items: center;
    overflow: hidden;
  }
  :global([data-theme='light']) .splash-card {
    background-image:
      linear-gradient(180deg, rgba(240, 237, 224, 0.35), rgba(240, 237, 224, 0.72)),
      url('/splash.png');
    color: #1f2e1e;
    border-color: rgba(42, 138, 74, 0.3);
  }

  .splash-content {
    text-align: center;
    padding: clamp(1rem, 3vw, 2rem);
    max-width: 760px;
  }
  .splash-tag {
    margin: 0 0 0.9rem;
    font-family: var(--font-mono);
    font-size: clamp(0.66rem, 1.1vw, 0.78rem);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: currentColor;
    opacity: 0.75;
  }
  .splash-title {
    margin: 0 0 0.5rem;
    font-size: clamp(2rem, 5.5vw, 3.4rem);
    font-weight: 600;
    letter-spacing: -0.01em;
    color: currentColor;
    line-height: 1.05;
  }
  .splash-title .accent {
    color: #4ad57a;
  }
  :global([data-theme='light']) .splash-title .accent {
    color: #2a8a4a;
  }
  .splash-lede {
    margin: 0 0 1.6rem;
    font-size: clamp(0.95rem, 1.6vw, 1.1rem);
    opacity: 0.88;
  }
  .splash-cta {
    appearance: none;
    background: transparent;
    color: currentColor;
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 0.6rem 1.3rem;
    font-family: var(--font-mono);
    font-size: clamp(0.7rem, 1vw, 0.78rem);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    cursor: pointer;
    transition:
      background 120ms ease,
      transform 120ms ease;
  }
  .splash-cta:hover {
    background: rgba(74, 213, 122, 0.16);
    transform: translateY(-1px);
  }
  :global([data-theme='light']) .splash-cta:hover {
    background: rgba(42, 138, 74, 0.12);
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
