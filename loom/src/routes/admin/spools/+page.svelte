<h1>Spools</h1>
<p class="lede">
  Registered data sources Spinners read from at invocation. The canon is a Spool. The manuscript is
  a Spool. The audit log will be a Spool. The vault is <em>not</em> — secrets have a different
  lifecycle and a different threat model.
</p>

<p class="placeholder">
  Spools wired today (bootstrap, whole-file readers):
</p>
<ul>
  <li><strong>Warp Canon</strong> — <code>@webspinner-foundation/warp-canon</code> (public)</li>
  <li><strong>Warp Decisions</strong> — <code>@webspinner-foundation/warp-decisions</code> (confidential)</li>
  <li><strong>Warp Open Questions</strong> — <code>@webspinner-foundation/warp-open-questions</code> (confidential)</li>
  <li><strong>AI Enclosure (manuscript)</strong> — <code>@webspinner-foundation/ai-enclosure</code> (public, best-effort)</li>
</ul>

<p class="placeholder">
  Spool registration as a first-class Cell operation — chunked retrieval, re-ranking, sensitivity
  classification by document, federated peers — is open work
  (<code>OPEN_QUESTIONS.md</code> — <em>Spool registry</em> + <em>WRAG protocol — formal pipeline
    spec</em>).
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
    margin: 0.6rem 0;
  }
  ul {
    margin: 0 0 1rem;
    padding: 0 0 0 1.25rem;
    color: #ccc;
    font-size: 0.9rem;
    line-height: 1.7;
  }
  ul strong {
    color: var(--gold);
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
