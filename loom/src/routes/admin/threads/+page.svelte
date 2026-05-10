<h1>Warp Threads</h1>
<p class="lede">
  Compositions of Spinner capabilities. A Warp Thread is a typed sequence of capability invocations
  with bound inputs and outputs, signed and digested the same way Spinners are. Spinner Weaving is
  the act of authoring a thread.
</p>

<p class="placeholder">
  No threads composed yet. The thread schema is settled
  (<code>WarpThreadManifest</code> in <code>@webspinner-foundation/sdk</code>); the runtime that
  executes threads — step ordering, binding resolution, partial-failure semantics — is open work
  (<code>OPEN_QUESTIONS.md</code> — <em>Warp Thread runtime</em>).
</p>

<style>
  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--gold);
    letter-spacing: 0.02em;
  }

  .lede {
    margin: 0 0 1.25rem;
    color: var(--text-mute);
    font-size: 0.9rem;
    max-width: 64ch;
    line-height: 1.55;
  }

  .placeholder {
    color: var(--text-mute);
    max-width: 64ch;
    line-height: 1.6;
    font-size: 0.9rem;
  }

  code {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 0.85em;
    color: #ddd;
  }
</style>
