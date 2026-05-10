<h1>Audit log</h1>
<p class="placeholder">
  Every privileged action — vault read/write/rotate, agent install, Loom login — emitted as a
  CloudEvents-shaped <code>AuditEvent</code> with the <code>wp.*</code> namespace, and surfaced
  here once the Grimoire's audit chain is wired. The bootstrap period before that wiring is itself
  recorded as a single audit entry naming the gap (canon §17, OPEN_QUESTIONS audit start).
</p>

<style>
  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--gold);
    letter-spacing: 0.02em;
  }

  .placeholder {
    color: var(--text-mute);
    max-width: 60ch;
    line-height: 1.6;
    font-size: 0.9rem;
  }

  code {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 0.85em;
    color: #ccc;
  }
</style>
