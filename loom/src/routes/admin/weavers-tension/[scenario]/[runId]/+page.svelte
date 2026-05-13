<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';

  // Form-shape is a union across the page's actions; svelte-check
  // doesn't narrow on the literal-key access we want here, so we
  // pull out the one error shape we render with a helper that
  // accepts the union conservatively.
  let { data, form }: { data: import('./$types').PageData; form?: Record<string, unknown> | null } =
    $props();

  function topLevelError(f: typeof form): { kind: string; detail?: string } | null {
    if (!f) return null;
    const v = f['topLevelError'];
    if (typeof v === 'object' && v !== null && 'kind' in (v as Record<string, unknown>)) {
      return v as { kind: string; detail?: string };
    }
    return null;
  }

  let chatInput = $state('');
  let submitting = $state(false);
  let iframeKey = $state(0);

  const activeStepIndex = $derived(data.run.currentStepIndex);
  const totalSteps = $derived(data.steps.length);

  // Bump the iframe key whenever the active step changes — forces the
  // iframe to remount with the new route. (Just changing src works too,
  // but remounting also resets scroll position, which the patron usually
  // wants on a step transition.)
  let lastSeenStepIndex = $state(-1);
  $effect(() => {
    if (activeStepIndex !== lastSeenStepIndex) {
      lastSeenStepIndex = activeStepIndex;
      iframeKey += 1;
    }
  });

  function iframeSrc(): string {
    const route = data.activeStep?.iframeRoute;
    if (!route) return '/admin';
    // If the route still has unresolved placeholders, fall back.
    if (route.includes('{{answer.')) return '/admin';
    return route;
  }

  async function refreshIframe() {
    iframeKey += 1;
  }
</script>

<div class="player">
  <!-- LEFT: live Loom view -->
  <section class="stage">
    <header class="stage-head">
      <span class="iframe-route">{iframeSrc()}</span>
      <button type="button" class="refresh-btn" onclick={refreshIframe} title="Reload iframe">
        ↻
      </button>
    </header>
    <div class="iframe-wrap">
      {#key iframeKey}
        <iframe
          src={iframeSrc()}
          title="Loom stage for {data.scenarioTitle}"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          referrerpolicy="same-origin"
        ></iframe>
      {/key}
    </div>
  </section>

  <!-- RIGHT: scenario control surface -->
  <aside class="panel">
    <!-- Scenario header -->
    <header class="panel-head">
      <p class="back">
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
        <a href={`/admin/weavers-tension/${data.scenarioSlug}`}>← {data.scenarioTitle}</a>
      </p>
      <p class="run-status status-{data.run.status}">
        {data.run.status} · step {Math.min(activeStepIndex + 1, totalSteps)} of {totalSteps}
      </p>
    </header>

    <!-- Step ribbon -->
    <ol class="ribbon">
      {#each data.steps as s, i (s.key)}
        <li class="ribbon-step status-{s.status}" title={s.title}>
          <span class="r-num">{i + 1}</span>
          <span class="r-title">{s.title}</span>
        </li>
      {/each}
    </ol>

    {#if topLevelError(form)}
      {@const err = topLevelError(form)}
      {#if err}
        <div class="banner error" role="alert">
          <strong>{err.kind}</strong>
          {#if err.detail}
            <p>{err.detail}</p>
          {/if}
        </div>
      {/if}
    {/if}

    {#if data.isFinished}
      <!-- Finished state -->
      <section class="active-step done">
        <h2>Run {data.run.status}</h2>
        <p class="observation">
          {#if data.run.status === 'completed'}
            The run is complete. The transcript and audit trail are persistent — refer back any
            time.
          {:else}
            This run was aborted. The transcript captures what happened before the abort.
          {/if}
        </p>
        <div class="counts">
          <span class="count approved"
            >{data.run.stepResults.filter((r) => r.status === 'approved').length} approved</span
          >
          <span class="count flagged"
            >{data.run.stepResults.filter((r) => r.status === 'flagged').length} flagged</span
          >
          <span class="count skipped"
            >{data.run.stepResults.filter((r) => r.status === 'skipped').length} skipped</span
          >
        </div>
      </section>
    {:else if data.activeStep}
      <!-- Active step -->
      <section class="active-step">
        <h2>{data.activeStep.title}</h2>
        <p class="observation">{data.activeStep.observation}</p>

        {#if data.verifier}
          <div class="verifier verifier-{data.verifier.ok ? 'ok' : 'fail'}">
            <header>
              <span class="v-icon">{data.verifier.ok ? '✓' : '⚠'}</span>
              <span class="v-text">{data.verifier.observation}</span>
            </header>
            <details>
              <summary>Evidence</summary>
              <pre>{JSON.stringify(data.verifier.evidence, null, 2)}</pre>
            </details>
          </div>
        {/if}

        <!-- Question + gating form -->
        <form
          method="POST"
          class="gate-form"
          use:enhance={({ formElement, action }) => {
            submitting = true;
            // Which action was used (?/approve | ?/flag | ?/skip)
            const verdict = action.search.replace(/^\?\//, '');
            return async ({ update }) => {
              submitting = false;
              await update();
              await invalidateAll();
              // Force the iframe to reload on step advance.
              if (verdict === 'approve' || verdict === 'skip') {
                iframeKey += 1;
              }
              formElement.reset();
            };
          }}
        >
          {#if data.activeStep.question.kind === 'confirm'}
            <p class="q-prompt">Ready when you are.</p>
            <div class="gate-row">
              <button type="submit" formaction="?/approve" class="primary" disabled={submitting}>
                {data.activeStep.question.approveLabel ?? 'Approve & continue'}
              </button>
              <button type="submit" formaction="?/skip" class="ghost" disabled={submitting}>
                Skip
              </button>
              <button type="submit" formaction="?/flag" class="warn" disabled={submitting}>
                Flag
              </button>
            </div>
          {:else if data.activeStep.question.kind === 'verify+comment'}
            <p class="q-prompt">{data.activeStep.question.prompt}</p>
            <textarea
              name="comment"
              rows="2"
              placeholder={data.activeStep.question.commentPlaceholder ?? ''}
              maxlength="2000"
            ></textarea>
            <div class="gate-row">
              <button type="submit" formaction="?/approve" class="primary" disabled={submitting}>
                Approve & continue
              </button>
              <button type="submit" formaction="?/flag" class="warn" disabled={submitting}>
                Flag with comment
              </button>
              <button type="submit" formaction="?/skip" class="ghost" disabled={submitting}>
                Skip
              </button>
            </div>
          {:else if data.activeStep.question.kind === 'prose'}
            <p class="q-prompt">{data.activeStep.question.prompt}</p>
            <textarea
              name="comment"
              rows="3"
              placeholder={data.activeStep.question.placeholder ?? ''}
              maxlength="2000"
              required
            ></textarea>
            <div class="gate-row">
              <button type="submit" formaction="?/approve" class="primary" disabled={submitting}>
                Record answer & continue
              </button>
              <button type="submit" formaction="?/skip" class="ghost" disabled={submitting}>
                Skip
              </button>
            </div>
          {:else if data.activeStep.question.kind === 'prompt-input'}
            <p class="q-prompt">{data.activeStep.question.prompt}</p>
            {#each data.activeStep.question.fields as field (field.name)}
              <label class="field">
                <span class="field-label">{field.label}</span>
                <input
                  type="text"
                  name={`answer.${field.name}`}
                  placeholder={field.placeholder ?? ''}
                  required={field.required ?? false}
                  autocomplete="off"
                  spellcheck="false"
                />
              </label>
            {/each}
            <div class="gate-row">
              <button type="submit" formaction="?/approve" class="primary" disabled={submitting}>
                Save & continue
              </button>
              <button type="submit" formaction="?/flag" class="warn" disabled={submitting}>
                Flag
              </button>
            </div>
          {:else if data.activeStep.question.kind === 'choice'}
            <p class="q-prompt">{data.activeStep.question.prompt}</p>
            <fieldset class="choices">
              {#each data.activeStep.question.options as opt (opt.value)}
                <label class="choice">
                  <input
                    type={data.activeStep.question.multi ? 'checkbox' : 'radio'}
                    name="answer.choice"
                    value={opt.value}
                  />
                  <span>{opt.label}</span>
                </label>
              {/each}
            </fieldset>
            <div class="gate-row">
              <button type="submit" formaction="?/approve" class="primary" disabled={submitting}>
                Record & continue
              </button>
              <button type="submit" formaction="?/flag" class="warn" disabled={submitting}>
                Flag
              </button>
            </div>
          {/if}
        </form>

        {#if data.isLastStep}
          <form
            method="POST"
            action="?/finish"
            class="finish-form"
            use:enhance={() => {
              return async ({ update }) => {
                await update();
                await invalidateAll();
              };
            }}
          >
            <button type="submit" class="primary finish">Mark run complete</button>
            <p class="hint">Visible after the last step's gate is recorded.</p>
          </form>
        {/if}
      </section>
    {/if}

    <!-- Chat -->
    <section class="chat">
      <h3>Transcript</h3>
      <ol class="messages">
        {#each data.run.messages as m (m.id)}
          <li class="msg author-{m.authorKind}">
            <header>
              <span class="m-author">{m.authorLabel ?? m.authorId}</span>
              <span class="m-step">step {m.stepRef}</span>
              <span class="m-when">{new Date(m.ts).toLocaleTimeString()}</span>
            </header>
            <p>{m.body}</p>
          </li>
        {/each}
        {#if data.run.messages.length === 0}
          <li class="msg empty">
            No messages yet. The transcript captures every note made during this run.
          </li>
        {/if}
      </ol>

      {#if !data.isFinished}
        <form
          method="POST"
          action="?/message"
          class="chat-form"
          use:enhance={() => {
            return async ({ update }) => {
              await update();
              chatInput = '';
              await invalidateAll();
            };
          }}
        >
          <textarea
            name="body"
            bind:value={chatInput}
            placeholder="Note about this step — what worked, what didn't, what surprised you…"
            rows="2"
            maxlength="4000"
            required
          ></textarea>
          <button type="submit" class="ghost-send" disabled={chatInput.trim().length === 0}>
            Send
          </button>
        </form>
      {/if}
    </section>

    {#if !data.isFinished}
      <form method="POST" action="?/abort" class="abort-form">
        <input type="hidden" name="reason" value="patron aborted from player" />
        <button type="submit" class="abort">Abort run</button>
      </form>
    {/if}
  </aside>
</div>

<style>
  :global(body) {
    overflow: hidden;
  }
  .player {
    position: fixed;
    top: 72px;
    left: 0;
    right: 0;
    bottom: 0;
    display: grid;
    grid-template-columns: 1fr 28rem;
    gap: 0;
    background: #0a0a0a;
  }

  /* ── LEFT pane ──────────────────────────────────────────────── */
  .stage {
    display: flex;
    flex-direction: column;
    background: #050505;
    border-right: 1px solid #2a2a2a;
    min-width: 0;
  }
  .stage-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 1rem;
    background: #161616;
    border-bottom: 1px solid #2a2a2a;
  }
  .iframe-route {
    font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
    font-size: 0.85rem;
    color: #8a8a8a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .refresh-btn {
    background: transparent;
    color: #8a8a8a;
    border: 1px solid #2a2a2a;
    padding: 0.2rem 0.6rem;
    border-radius: 3px;
    cursor: pointer;
  }
  .refresh-btn:hover {
    border-color: #f7e2a8;
    color: #f7e2a8;
  }
  .iframe-wrap {
    flex: 1;
    overflow: hidden;
    background: #fff;
  }
  iframe {
    width: 100%;
    height: 100%;
    border: 0;
    background: #fff;
  }

  /* ── RIGHT pane ─────────────────────────────────────────────── */
  .panel {
    background: #0e0e0e;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    gap: 1.2rem;
  }
  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 1px solid #2a2a2a;
    padding-bottom: 0.6rem;
  }
  .back {
    margin: 0;
    font-size: 0.85rem;
  }
  .back a {
    color: #8a8a8a;
    text-decoration: none;
  }
  .back a:hover {
    color: #f7e2a8;
  }
  .run-status {
    font-size: 0.8rem;
    color: #8a8a8a;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .status-in-progress {
    color: #f7e2a8;
  }
  .status-completed {
    color: #88c878;
  }
  .status-aborted {
    color: #d97870;
  }

  /* Ribbon */
  .ribbon {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    border-left: 1px solid #2a2a2a;
    padding-left: 0.6rem;
  }
  .ribbon-step {
    display: grid;
    grid-template-columns: 1.5rem 1fr;
    gap: 0.5rem;
    padding: 0.3rem 0.4rem;
    font-size: 0.85rem;
    border-radius: 3px;
    align-items: center;
    transition: background 200ms ease;
  }
  .ribbon-step .r-num {
    color: #8a8a8a;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .ribbon-step .r-title {
    color: #b5b3aa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ribbon-step.status-pending {
    opacity: 0.55;
  }
  .ribbon-step.status-active {
    background: #2a2a1a;
    box-shadow: 0 0 0 1px #f7e2a8 inset;
    animation: activePulse 2s ease-in-out infinite;
  }
  .ribbon-step.status-active .r-num,
  .ribbon-step.status-active .r-title {
    color: #f7e2a8;
  }
  .ribbon-step.status-approved .r-num,
  .ribbon-step.status-approved .r-title {
    color: #88c878;
  }
  .ribbon-step.status-flagged .r-num,
  .ribbon-step.status-flagged .r-title {
    color: #d97870;
  }
  .ribbon-step.status-skipped .r-num,
  .ribbon-step.status-skipped .r-title {
    color: #888;
    text-decoration: line-through;
  }
  @keyframes activePulse {
    0%,
    100% {
      box-shadow: 0 0 0 1px #f7e2a8 inset;
    }
    50% {
      box-shadow:
        0 0 0 1px #f7e2a8 inset,
        0 0 12px rgba(247, 226, 168, 0.25);
    }
  }

  /* Active step */
  .active-step {
    border-top: 1px solid #2a2a2a;
    padding-top: 1rem;
  }
  .active-step h2 {
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    font-size: 1.3rem;
    font-weight: 400;
    color: #f7e2a8;
    margin: 0 0 0.6rem;
  }
  .observation {
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    font-size: 1rem;
    line-height: 1.55;
    color: #cfcdc4;
    margin: 0 0 1rem;
    white-space: pre-line;
  }
  .verifier {
    border: 1px solid;
    border-radius: 4px;
    padding: 0.6rem 0.8rem;
    font-size: 0.9rem;
    margin: 0 0 1rem;
  }
  .verifier.verifier-ok {
    border-color: #88c878;
    background: #0e1a0e;
  }
  .verifier.verifier-fail {
    border-color: #d97870;
    background: #1a0e0e;
  }
  .verifier header {
    display: flex;
    gap: 0.6rem;
    align-items: center;
  }
  .verifier .v-icon {
    font-size: 1rem;
  }
  .verifier-ok .v-icon {
    color: #88c878;
  }
  .verifier-fail .v-icon {
    color: #d97870;
  }
  .verifier .v-text {
    color: #cfcdc4;
  }
  .verifier details {
    margin-top: 0.5rem;
  }
  .verifier summary {
    cursor: pointer;
    color: #8a8a8a;
    font-size: 0.85rem;
  }
  .verifier pre {
    font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
    font-size: 0.78rem;
    color: #b5b3aa;
    background: #161616;
    padding: 0.6rem;
    border-radius: 3px;
    overflow-x: auto;
    margin: 0.4rem 0 0;
  }
  .q-prompt {
    color: #cfcdc4;
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    margin: 0 0 0.6rem;
  }
  .gate-form textarea,
  .chat-form textarea,
  .field input {
    width: 100%;
    box-sizing: border-box;
    background: #161616;
    border: 1px solid #2a2a2a;
    color: #cfcdc4;
    border-radius: 3px;
    padding: 0.5rem 0.7rem;
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    font-size: 0.95rem;
  }
  .gate-form textarea:focus,
  .chat-form textarea:focus,
  .field input:focus {
    outline: none;
    border-color: #f7e2a8;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin: 0 0 0.7rem;
  }
  .field-label {
    color: #8a8a8a;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .gate-row {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.6rem;
    flex-wrap: wrap;
  }
  .primary {
    background: #2a2a1a;
    color: #f7e2a8;
    border: 1px solid #f7e2a8;
    padding: 0.5rem 1rem;
    border-radius: 3px;
    cursor: pointer;
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
  }
  .primary:hover {
    background: #3a3a1a;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: wait;
  }
  .ghost {
    background: transparent;
    color: #8a8a8a;
    border: 1px solid #2a2a2a;
    padding: 0.5rem 1rem;
    border-radius: 3px;
    cursor: pointer;
  }
  .ghost:hover {
    border-color: #888;
    color: #cfcdc4;
  }
  .warn {
    background: transparent;
    color: #d97870;
    border: 1px solid #d97870;
    padding: 0.5rem 1rem;
    border-radius: 3px;
    cursor: pointer;
  }
  .warn:hover {
    background: #2a1a1a;
  }
  .choices {
    border: 0;
    padding: 0;
    margin: 0 0 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .choice {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    color: #cfcdc4;
    cursor: pointer;
  }

  .finish-form {
    margin-top: 1rem;
    border-top: 1px dashed #2a2a2a;
    padding-top: 0.8rem;
  }
  .primary.finish {
    background: #1a2a1a;
    color: #88c878;
    border-color: #88c878;
  }
  .hint {
    color: #8a8a8a;
    font-size: 0.8rem;
    margin: 0.4rem 0 0;
  }

  /* Chat */
  .chat {
    border-top: 1px solid #2a2a2a;
    padding-top: 1rem;
  }
  .chat h3 {
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    font-size: 1rem;
    font-weight: 400;
    color: #f7e2a8;
    margin: 0 0 0.6rem;
  }
  .messages {
    list-style: none;
    padding: 0;
    margin: 0 0 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    max-height: 24rem;
    overflow-y: auto;
  }
  .msg {
    padding: 0.5rem 0.7rem;
    background: #161616;
    border-left: 2px solid #2a2a2a;
    border-radius: 0 3px 3px 0;
  }
  .msg.author-si {
    border-left-color: #f7e2a8;
  }
  .msg.author-wizard,
  .msg.author-webspinner {
    border-left-color: #88c878;
  }
  .msg.empty {
    color: #888;
    font-style: italic;
    border-left-color: transparent;
    background: transparent;
  }
  .msg header {
    display: flex;
    gap: 0.6rem;
    font-size: 0.75rem;
    color: #8a8a8a;
    margin-bottom: 0.3rem;
  }
  .m-author {
    color: #cfcdc4;
  }
  .msg p {
    color: #cfcdc4;
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.5;
    white-space: pre-line;
  }
  .chat-form {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
    align-items: end;
  }
  .ghost-send {
    background: #2a2a1a;
    color: #f7e2a8;
    border: 1px solid #2a2a2a;
    padding: 0.5rem 1rem;
    border-radius: 3px;
    cursor: pointer;
  }
  .ghost-send:hover {
    border-color: #f7e2a8;
  }
  .ghost-send:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Abort */
  .abort-form {
    margin-top: auto;
    padding-top: 1rem;
    border-top: 1px dashed #2a2a2a;
  }
  .abort {
    background: transparent;
    color: #8a8a8a;
    border: 1px solid #2a2a2a;
    padding: 0.4rem 0.8rem;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .abort:hover {
    color: #d97870;
    border-color: #d97870;
  }

  /* Done state */
  .active-step.done {
    text-align: left;
  }
  .counts {
    display: flex;
    gap: 1rem;
    margin-top: 1rem;
    font-size: 0.9rem;
  }
  .count.approved {
    color: #88c878;
  }
  .count.flagged {
    color: #d97870;
  }
  .count.skipped {
    color: #888;
  }

  /* Banner */
  .banner.error {
    background: #2a1a1a;
    border: 1px solid #d97870;
    color: #d97870;
    padding: 0.7rem;
    border-radius: 3px;
    font-size: 0.85rem;
  }
  .banner.error strong {
    display: block;
    font-size: 0.8rem;
    margin-bottom: 0.3rem;
  }
  .banner.error p {
    margin: 0;
    font-size: 0.85rem;
  }

  @media (max-width: 1100px) {
    .player {
      grid-template-columns: 1fr 26rem;
    }
  }
  @media (max-width: 900px) {
    .player {
      grid-template-columns: 1fr;
      grid-template-rows: 50% 50%;
    }
    .stage {
      border-right: 0;
      border-bottom: 1px solid #2a2a2a;
    }
  }
</style>
