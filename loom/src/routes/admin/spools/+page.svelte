<h1>Spools</h1>
<p class="lede">
  Registered data sources Spinners read from at invocation. The canon is a Spool. The manuscript is
  a Spool. The audit log will be a Spool. The vault is <em>not</em> — secrets have a different
  lifecycle and a different threat model.
</p>

<p class="placeholder">Spools wired today (bootstrap, whole-file readers):</p>
<ul>
  <li><strong>Warp Canon</strong> — <code>@webspinner-foundation/warp-canon</code> (public)</li>
  <li><strong>Warp Decisions</strong> — <code>@webspinner-foundation/warp-decisions</code> (confidential)</li>
  <li><strong>Warp Open Questions</strong> — <code>@webspinner-foundation/warp-open-questions</code> (confidential)</li>
  <li><strong>AI Enclosure (manuscript)</strong> — <code>@webspinner-foundation/ai-enclosure</code> (public, best-effort)</li>
</ul>

<p class="placeholder">
  Spool registration as a first-class Cell operation — chunked retrieval, re-ranking, sensitivity
  classification by document, federated peers — is open work (<code>OPEN_QUESTIONS.md</code> —
  <em>Spool registry</em> + <em>WRAG protocol — formal pipeline spec</em>).
</p>

<style>
  h1 {
    margin: 0 0 0.4rem;
    font-size: 1.6rem;
    font-weight: 600;
    color: var(--gold);
    letter-spacing: 0.02em;
    font-family: var(--font-prose);
  }

  .lede {
    margin: 0 0 1.5rem;
    color: var(--text-dim);
    font-size: 1rem;
    max-width: 60ch;
    line-height: 1.55;
    font-family: var(--font-prose);
    font-style: italic;
  }

  .placeholder {
    color: var(--text-secondary);
    max-width: 60ch;
    line-height: 1.65;
    font-size: 0.95rem;
    margin: 0.85rem 0;
    font-family: var(--font-prose);
    font-style: italic;
  }

  ul {
    margin: 0 0 1.25rem;
    padding: 0 0 0 1.25rem;
    color: var(--text-secondary);
    font-size: 0.95rem;
    line-height: 1.75;
    font-family: var(--font-data);
    max-width: 60ch;
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
    color: var(--text-secondary);
    font-style: normal;
    font-family: var(--font-mono);
  }
</style>
