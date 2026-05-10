<script lang="ts">
  import { enhance } from '$app/forms';

  let { form } = $props();
  let submitting = $state(false);
  let showPassword = $state(false);
</script>

<svelte:head>
  <title>Sign in · Warp</title>
</svelte:head>

<main>
  <form
    method="POST"
    autocomplete="off"
    spellcheck="false"
    use:enhance={() => {
      submitting = true;
      return async ({ update }) => {
        await update();
        submitting = false;
      };
    }}
  >
    <h1>Warp</h1>
    <p class="lede">
      Webspinner Foundation Cell. Authorised Wizards only.<br>
      <span class="hint">Admin utility — credentials are not autofilled or saved.</span>
    </p>

    <!--
      The visible inputs use `type="text"` (not "email" / "password") and
      non-standard names (`wizard_id`, `passphrase`) so Safari's Keychain
      heuristics never recognise this as a sign-in form. The "passphrase"
      field is masked visually with `-webkit-text-security: disc` — the
      same technique Stripe / Cloudflare admin sign-ins use to suppress
      Keychain offers entirely. The show-password toggle flips the CSS
      mask, not the input type, so Safari never re-binds.
    -->
    <label>
      <span>Email</span>
      <input
        type="text"
        inputmode="email"
        name="wizard_id"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        data-1p-ignore
        data-lpignore="true"
        data-bwignore="true"
        data-form-type="other"
        required
        value={form?.email ?? ''}
        aria-label="Email"
      />
    </label>

    <label>
      <span>Password</span>
      <div class="password-wrap">
        <input
          type="text"
          name="passphrase"
          class={showPassword ? 'passphrase show' : 'passphrase mask'}
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          required
          aria-label="Password"
        />
        <button
          type="button"
          class="show-toggle"
          onclick={() => (showPassword = !showPassword)}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          aria-pressed={showPassword}
          tabindex="-1"
        >
          {#if showPassword}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          {:else}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          {/if}
        </button>
      </div>
    </label>

    {#if form?.error}
      <p class="error" role="alert">{form.error}</p>
    {/if}

    <button type="submit" disabled={submitting}>
      {submitting ? 'Signing in…' : 'Sign in'}
    </button>

    <p class="alt">
      No account yet? <a href="/register">Register</a>
    </p>
  </form>
</main>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: #0a0a0a;
    color: #f0f0f0;
    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      sans-serif;
  }

  main {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }

  form {
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--gold);
  }

  .lede {
    margin: 0 0 0.5rem;
    color: var(--text-mute);
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .hint {
    color: var(--text-mute);
    font-size: 0.78rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.85rem;
  }

  span {
    color: var(--text-dim);
  }

  input {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    color: #f0f0f0;
    padding: 0.65rem 0.75rem;
    border-radius: 4px;
    font-size: 1rem;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
  }

  input:focus {
    outline: none;
    border-color: var(--cyan);
  }

  .password-wrap {
    position: relative;
  }

  .password-wrap input {
    padding-right: 2.6rem;
  }

  /*
   * CSS-mask the passphrase value visually without using `type="password"`.
   * `-webkit-text-security: disc` is supported in WebKit-based browsers
   * (Safari, Chrome, Edge) and is the canonical pattern for admin forms
   * that don't want password-manager binding. The show-toggle flips this
   * via class, not via input.type, so the input never becomes a "password"
   * field that Safari Keychain re-binds to.
   */
  input.passphrase {
    font-family: ui-monospace, 'SF Mono', monospace;
    letter-spacing: 0.05em;
  }

  input.passphrase.mask {
    -webkit-text-security: disc;
    text-security: disc;
  }

  input.passphrase.show {
    -webkit-text-security: none;
    text-security: none;
  }

  .show-toggle {
    position: absolute;
    right: 0.4rem;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    color: var(--text-mute);
    cursor: pointer;
    padding: 0.35rem 0.5rem;
    margin: 0;
    line-height: 0;
    border-radius: 4px;
    transition: color 0.15s ease, background 0.15s ease;
  }

  .show-toggle:hover {
    color: var(--gold);
    background: rgba(201, 169, 106, 0.08);
  }

  .show-toggle:focus-visible {
    outline: 2px solid var(--cyan);
    outline-offset: 1px;
  }

  button {
    margin-top: 0.5rem;
    background: var(--gold);
    color: #1a1306;
    border: none;
    padding: 0.7rem 1rem;
    border-radius: 4px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    letter-spacing: 0.02em;
  }

  button:hover:not(:disabled) {
    background: var(--gold-bright);
  }

  button:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  .error {
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: #401010;
    border: 1px solid #602020;
    border-radius: 4px;
    color: #f88;
    font-size: 0.85rem;
  }

  .alt {
    margin: 0.5rem 0 0;
    font-size: 0.85rem;
    color: var(--text-mute);
    text-align: center;
  }

  .alt a {
    color: var(--cyan);
    text-decoration: none;
  }

  .alt a:hover {
    text-decoration: underline;
  }
</style>
