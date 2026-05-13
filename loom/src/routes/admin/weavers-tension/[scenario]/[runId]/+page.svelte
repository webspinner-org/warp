<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { IframeDriver } from '$lib/weavers-tension/driver.js';
  import { executeRun } from '$lib/weavers-tension/executor.js';
  import type {
    Scenario,
    ScenarioStep,
    StepResult,
    StepVerifier,
    VerifierResult,
  } from '$lib/server/weavers-tension/types.js';

  let { data }: { data: import('./$types').PageData } = $props();

  // ── reactive state ─────────────────────────────────────────────
  let runStatus = $state<'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted'>(
    data.run.status === 'in-progress' ? 'idle' : (data.run.status as 'completed' | 'aborted'),
  );
  let currentStepIndex = $state(data.run.currentStepIndex);
  let liveActionLabel = $state('');
  let stepStatuses = $state<Record<string, StepResult['status'] | 'pending' | 'active'>>(
    Object.fromEntries(
      data.scenario.steps.map((s) => {
        const result = data.run.stepResults.find((r) => r.stepKey === s.key);
        return [s.key, result?.status ?? 'pending'];
      }),
    ),
  );
  let messages = $state([...data.run.messages]);
  let verifierResults = $state<VerifierResult[]>([]);
  let escalation = $state<{
    stepKey: string;
    reason: string;
    evidence: Record<string, unknown>;
  } | null>(null);
  let iframeKey = $state(0);

  // Iframe element ref
  let iframeEl: HTMLIFrameElement | null = $state(null);

  // Pause / stop flags
  let pauseFlag = false;
  let stopFlag = false;
  let pauseResolvers: (() => void)[] = [];
  function paused(): Promise<void> {
    if (!pauseFlag) return Promise.resolve();
    return new Promise((resolve) => pauseResolvers.push(resolve));
  }
  function stopGuard(): void {
    if (stopFlag) throw new Error('stopped');
  }
  function stopRequested(): boolean {
    return stopFlag;
  }

  function iframeStartingSrc(): string {
    // For an in-progress run, prime the iframe at /admin so it's not
    // blank when the patron lands here. The first step's navigate-iframe
    // action will re-navigate properly once execution starts.
    return '/admin';
  }

  // ── server-action helpers ──────────────────────────────────────
  async function callAction(name: string, fd: FormData): Promise<unknown> {
    const res = await fetch(`?/${name}`, { method: 'POST', body: fd });
    const body = (await res.json()) as { type?: string; data?: string };
    if (typeof body.data === 'string') {
      try {
        return JSON.parse(body.data);
      } catch {
        return null;
      }
    }
    return null;
  }

  async function serverRecordStep(
    step: ScenarioStep,
    index: number,
    status: StepResult['status'],
    evidence?: Record<string, unknown>,
  ): Promise<void> {
    const fd = new FormData();
    fd.set('stepIndex', String(index));
    fd.set('status', status);
    if (evidence) fd.set('evidence', JSON.stringify(evidence));
    await callAction('recordStep', fd);
  }

  async function serverPostMessage(
    authorKind: 'si' | 'system' | 'wizard' | 'webspinner',
    stepKey: string,
    body: string,
  ): Promise<void> {
    const fd = new FormData();
    fd.set('authorKind', authorKind);
    fd.set('stepKey', stepKey);
    fd.set('body', body);
    await callAction('message', fd);
    // Optimistic: append locally too so the UI updates without re-fetch.
    messages = [
      ...messages,
      {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        authorKind,
        authorId: authorKind === 'si' ? 'si:weavers-tension' : 'self',
        authorLabel: authorKind === 'si' ? 'The Loom' : (data.user?.email ?? 'patron'),
        stepRef: stepKey,
        body,
      },
    ];
  }

  async function serverRunVerifier(verifier: StepVerifier): Promise<VerifierResult> {
    const fd = new FormData();
    fd.set('verifier', JSON.stringify(verifier));
    const r = (await callAction('runVerifications', fd)) as {
      ok: boolean;
      result?: VerifierResult;
    } | null;
    if (r && r.ok && r.result) return r.result;
    return {
      ok: false,
      observation: 'Server verifier call failed.',
      evidence: { reason: 'server-call-failed' },
    };
  }

  async function serverPause(): Promise<void> {
    await callAction('pause', new FormData());
  }
  async function serverResume(): Promise<void> {
    await callAction('resume', new FormData());
  }
  async function serverFinish(): Promise<void> {
    await callAction('finish', new FormData());
  }

  // ── lifecycle ──────────────────────────────────────────────────
  async function startRun() {
    if (!iframeEl) return;
    if (runStatus === 'running') return;
    runStatus = 'running';
    stopFlag = false;
    pauseFlag = false;
    const driver = new IframeDriver(iframeEl, {
      paused,
      stopGuard,
    });
    const scenario: Scenario = data.scenario as Scenario;
    try {
      await executeRun({
        driver,
        scenario,
        startIndex: currentStepIndex,
        answers: data.run.answers,
        signals: { paused, stopGuard, stopRequested },
        hooks: {
          onStepStart: async (step, index) => {
            currentStepIndex = index;
            stepStatuses = { ...stepStatuses, [step.key]: 'active' };
            verifierResults = [];
            liveActionLabel = `Starting: ${step.title}`;
          },
          onAction: (_action, _step, label) => {
            liveActionLabel = label;
          },
          onVerifierResult: (_step, result) => {
            verifierResults = [...verifierResults, result];
          },
          onStepDone: async (step, status, evidence) => {
            stepStatuses = { ...stepStatuses, [step.key]: status };
            await serverRecordStep(
              step,
              data.scenario.steps.findIndex((s) => s.key === step.key),
              status,
              evidence,
            );
          },
          postMessage: async (authorKind, step, body) => {
            await serverPostMessage(authorKind, step?.key ?? 'pre-start', body);
          },
          runServerVerifier: async (_step, verifier) => {
            return await serverRunVerifier(verifier);
          },
          onEscalate: async (step, reason, evidence) => {
            escalation = { stepKey: step.key, reason, evidence };
            runStatus = 'failed';
          },
          onFinish: async () => {
            runStatus = 'completed';
            await serverFinish();
            await invalidateAll();
          },
        },
      });
    } catch (err) {
      if (String(err).includes('stopped')) {
        runStatus = 'aborted';
        return;
      }
      // Always reflect the crash in the UI even if subsequent
      // server calls also fail. The local-state update is the
      // priority; the server log is best-effort.
      runStatus = 'failed';
      escalation = {
        stepKey: data.scenario.steps[currentStepIndex]?.key ?? 'pre-start',
        reason: `The run loop crashed: ${String(err)}`,
        evidence: { error: String(err) },
      };
      try {
        await serverPostMessage('system', 'pre-start', `Run loop crashed: ${String(err)}`);
      } catch (logErr) {
        console.error('failed to log crash to server', logErr);
      }
    }
  }

  async function pauseRun() {
    pauseFlag = true;
    runStatus = 'paused';
    await serverPause();
  }

  async function resumeRun() {
    pauseFlag = false;
    pauseResolvers.forEach((r) => r());
    pauseResolvers = [];
    runStatus = 'running';
    await serverResume();
  }

  async function stopRun() {
    stopFlag = true;
    pauseFlag = false;
    pauseResolvers.forEach((r) => r());
    pauseResolvers = [];
    runStatus = 'aborted';
    const fd = new FormData();
    fd.set('reason', 'patron stopped the run');
    await fetch('?/abort', { method: 'POST', body: fd });
    window.location.href = '/admin/weavers-tension';
  }

  let chatInput = $state('');
  async function sendChat() {
    const body = chatInput.trim();
    if (body.length === 0) return;
    chatInput = '';
    const currentStep = data.scenario.steps[currentStepIndex];
    // The server will reconcile the actual author kind based on
    // the session (wizard for _superusers, webspinner for users);
    // we just request 'wizard' here as the patron-side label.
    await serverPostMessage('wizard', currentStep?.key ?? 'pre-start', body);
  }

  onMount(() => {
    // Best-effort cleanup if the patron closes the tab mid-run.
    // sendBeacon is the only fetch primitive guaranteed to survive
    // unload. It posts a form-encoded body to the abort action,
    // which patches run.status to 'aborted' on the server side.
    const handler = () => {
      if (runStatus === 'running' || runStatus === 'paused') {
        try {
          const fd = new FormData();
          fd.set('reason', 'patron-closed-tab');
          navigator.sendBeacon('?/abort', fd);
        } catch {
          // Best-effort; if the browser blocks the beacon we
          // fall back to the stale-run reaper.
        }
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  });
</script>

<div class="player">
  <!-- LEFT: live stage -->
  <section class="stage">
    <header class="stage-head">
      <span class="iframe-label">The Loom (live)</span>
      <span class="live-action">{liveActionLabel || 'idle'}</span>
    </header>
    <div class="iframe-wrap">
      {#key iframeKey}
        <iframe
          bind:this={iframeEl}
          src={iframeStartingSrc()}
          title="Loom stage for {data.scenario.title}"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          referrerpolicy="same-origin"
        ></iframe>
      {/key}
    </div>
  </section>

  <!-- RIGHT: panel -->
  <aside class="panel">
    <header class="panel-head">
      <p class="back">
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
        <a href={`/admin/weavers-tension/${data.scenario.slug}`}>← {data.scenario.title}</a>
      </p>
      <p class="run-status status-{runStatus}">
        {runStatus}
        {#if runStatus === 'running' || runStatus === 'paused'}
          · step {Math.min(currentStepIndex + 1, data.scenario.steps.length)} of {data.scenario
            .steps.length}
        {/if}
      </p>
    </header>

    <!-- Run controls -->
    <div class="controls">
      {#if runStatus === 'idle'}
        <button class="primary big" onclick={startRun}>▶ Start</button>
        <span class="hint">{data.scenario.steps.length} steps — fully driven by the Loom.</span>
      {:else if runStatus === 'running'}
        <button class="secondary" onclick={pauseRun}>❚❚ Pause</button>
        <button class="warn" onclick={stopRun}>■ Stop</button>
      {:else if runStatus === 'paused'}
        <button class="primary" onclick={resumeRun}>▶ Resume</button>
        <button class="warn" onclick={stopRun}>■ Stop</button>
      {:else if runStatus === 'failed' && escalation}
        <button
          class="primary"
          onclick={() => {
            escalation = null;
            startRun();
          }}>↻ Retry from here</button
        >
        <button
          class="secondary"
          onclick={() => {
            escalation = null;
            currentStepIndex++;
            startRun();
          }}>Skip step</button
        >
        <button class="warn" onclick={stopRun}>■ Stop</button>
      {:else if runStatus === 'completed' || runStatus === 'aborted'}
        <span class="done">Run {runStatus}.</span>
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
        <a class="secondary" href="/admin/weavers-tension">Back to index</a>
      {/if}
    </div>

    <!-- Step ribbon -->
    <ol class="ribbon">
      {#each data.scenario.steps as s, i (s.key)}
        <li class="ribbon-step status-{stepStatuses[s.key]}" title={s.title}>
          <span class="r-num">{i + 1}</span>
          <span class="r-title">{s.title}</span>
        </li>
      {/each}
    </ol>

    <!-- Active step narration -->
    {#if data.scenario.steps[currentStepIndex]}
      {@const step = data.scenario.steps[currentStepIndex]}
      <section class="active-step">
        <h2>{step.title}</h2>
        <p class="narration">{step.narration}</p>

        {#if verifierResults.length > 0}
          <div class="verifiers">
            {#each verifierResults as v, i (i)}
              <div class="verifier verifier-{v.ok ? 'ok' : 'fail'}">
                <header>
                  <span class="v-icon">{v.ok ? '✓' : '⚠'}</span>
                  <span class="v-text">{v.observation}</span>
                </header>
                <details>
                  <summary>Evidence</summary>
                  <pre>{JSON.stringify(v.evidence, null, 2)}</pre>
                </details>
              </div>
            {/each}
          </div>
        {/if}

        {#if escalation}
          <div class="escalation">
            <h3>The Loom paused at this step.</h3>
            <p class="escalation-reason">{escalation.reason}</p>
            <details>
              <summary>What I tried</summary>
              <pre>{JSON.stringify(escalation.evidence, null, 2)}</pre>
            </details>
            <p class="hint">
              Pick a control above — retry from here, skip the step, or stop the run.
            </p>
          </div>
        {/if}
      </section>
    {/if}

    <!-- Chat -->
    <section class="chat">
      <h3>Transcript</h3>
      <ol class="messages">
        {#each messages as m (m.id)}
          <li class="msg author-{m.authorKind}">
            <header>
              <span class="m-author">{m.authorLabel ?? m.authorId}</span>
              <span class="m-step">step {m.stepRef}</span>
              <span class="m-when">{new Date(m.ts).toLocaleTimeString()}</span>
            </header>
            <p>{m.body}</p>
          </li>
        {/each}
        {#if messages.length === 0}
          <li class="msg empty">The Loom will narrate here as it runs.</li>
        {/if}
      </ol>

      {#if runStatus !== 'completed' && runStatus !== 'aborted'}
        <form
          class="chat-form"
          onsubmit={(e) => {
            e.preventDefault();
            sendChat();
          }}
        >
          <textarea
            bind:value={chatInput}
            placeholder="A note for the design backlog — what felt right or wrong about this step…"
            rows="2"
            maxlength="4000"
          ></textarea>
          <button type="submit" class="ghost-send" disabled={chatInput.trim().length === 0}>
            Send
          </button>
        </form>
      {/if}
    </section>
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
    grid-template-columns: 1fr 32rem;
    background: #0a0a0a;
  }

  /* LEFT */
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
    font-size: 0.85rem;
  }
  .iframe-label {
    color: #f7e2a8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.75rem;
  }
  .live-action {
    color: #8a8a8a;
    font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 60%;
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

  /* RIGHT */
  .panel {
    background: #0e0e0e;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    gap: 1rem;
  }
  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 1px solid #2a2a2a;
    padding-bottom: 0.6rem;
  }
  .back a {
    color: #8a8a8a;
    text-decoration: none;
    font-size: 0.85rem;
  }
  .back a:hover {
    color: #f7e2a8;
  }
  .run-status {
    font-size: 0.8rem;
    color: #8a8a8a;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0;
  }
  .status-running,
  .status-paused {
    color: #f7e2a8;
  }
  .status-completed {
    color: #88c878;
  }
  .status-failed,
  .status-aborted {
    color: #d97870;
  }

  /* Controls */
  .controls {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    padding-bottom: 0.6rem;
    border-bottom: 1px dashed #2a2a2a;
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
  .primary.big {
    padding: 0.7rem 1.6rem;
    font-size: 1.05rem;
  }
  .primary:hover {
    background: #3a3a1a;
  }
  .secondary {
    background: transparent;
    color: #8a8a8a;
    border: 1px solid #2a2a2a;
    padding: 0.5rem 1rem;
    border-radius: 3px;
    cursor: pointer;
    text-decoration: none;
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
  }
  .secondary:hover {
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
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
  }
  .warn:hover {
    background: #2a1a1a;
  }
  .done {
    color: #cfcdc4;
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
  }
  .hint {
    color: #8a8a8a;
    font-size: 0.85rem;
  }

  /* Ribbon */
  .ribbon {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    max-height: 14rem;
    overflow-y: auto;
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
  .ribbon-step.status-completed .r-num,
  .ribbon-step.status-completed .r-title,
  .ribbon-step.status-remediated .r-num,
  .ribbon-step.status-remediated .r-title {
    color: #88c878;
  }
  .ribbon-step.status-failed .r-num,
  .ribbon-step.status-failed .r-title,
  .ribbon-step.status-escalated .r-num,
  .ribbon-step.status-escalated .r-title {
    color: #d97870;
  }
  @keyframes activePulse {
    0%,
    100% {
      box-shadow: 0 0 0 1px #f7e2a8 inset;
    }
    50% {
      box-shadow:
        0 0 0 1px #f7e2a8 inset,
        0 0 14px rgba(247, 226, 168, 0.3);
    }
  }

  /* Active step */
  .active-step {
    border-top: 1px solid #2a2a2a;
    padding-top: 0.8rem;
  }
  .active-step h2 {
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    font-size: 1.25rem;
    font-weight: 400;
    color: #f7e2a8;
    margin: 0 0 0.5rem;
  }
  .narration {
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    font-size: 0.95rem;
    line-height: 1.5;
    color: #cfcdc4;
    margin: 0 0 0.8rem;
    white-space: pre-line;
  }
  .verifiers {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-bottom: 0.6rem;
  }
  .verifier {
    border: 1px solid;
    border-radius: 4px;
    padding: 0.5rem 0.7rem;
    font-size: 0.85rem;
  }
  .verifier-ok {
    border-color: #88c878;
    background: #0e1a0e;
  }
  .verifier-fail {
    border-color: #d97870;
    background: #1a0e0e;
  }
  .verifier header {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .verifier-ok .v-icon {
    color: #88c878;
  }
  .verifier-fail .v-icon {
    color: #d97870;
  }
  .v-text {
    color: #cfcdc4;
  }
  .verifier details {
    margin-top: 0.4rem;
  }
  .verifier summary {
    cursor: pointer;
    color: #8a8a8a;
    font-size: 0.78rem;
  }
  .verifier pre {
    font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
    font-size: 0.75rem;
    color: #b5b3aa;
    background: #161616;
    padding: 0.5rem;
    border-radius: 3px;
    overflow-x: auto;
    margin: 0.3rem 0 0;
  }
  .escalation {
    border: 1px solid #d97870;
    background: #1a0e0e;
    border-radius: 4px;
    padding: 0.8rem;
    margin: 0.5rem 0;
  }
  .escalation h3 {
    margin: 0 0 0.4rem;
    color: #d97870;
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    font-size: 1rem;
    font-weight: 400;
  }
  .escalation-reason {
    color: #cfcdc4;
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    margin: 0 0 0.4rem;
  }

  /* Chat */
  .chat {
    border-top: 1px solid #2a2a2a;
    padding-top: 0.8rem;
    margin-top: auto;
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
    margin: 0 0 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 18rem;
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
  .msg.author-system {
    border-left-color: #8a8a8a;
  }
  .msg.empty {
    color: #888;
    font-style: italic;
    border-left-color: transparent;
    background: transparent;
  }
  .msg header {
    display: flex;
    gap: 0.5rem;
    font-size: 0.7rem;
    color: #8a8a8a;
    margin-bottom: 0.25rem;
  }
  .m-author {
    color: #cfcdc4;
  }
  .msg p {
    color: #cfcdc4;
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.45;
    white-space: pre-line;
  }
  .chat-form {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
    align-items: end;
  }
  .chat-form textarea {
    background: #161616;
    border: 1px solid #2a2a2a;
    color: #cfcdc4;
    border-radius: 3px;
    padding: 0.5rem 0.7rem;
    font-family: 'Iowan Old Style', 'Iowan', 'Georgia', serif;
    font-size: 0.9rem;
    resize: vertical;
  }
  .chat-form textarea:focus {
    outline: none;
    border-color: #f7e2a8;
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

  @media (max-width: 1100px) {
    .player {
      grid-template-columns: 1fr 28rem;
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
