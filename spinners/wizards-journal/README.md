# @webspinner-foundation/wizards-journal

The Wizard's operational log — actions, decisions, problems,
learnings — kept as the substrate for next-session Claude bootstrap
and (eventually) public Foundation documentation. Semantic recall
across the whole journal via the Cell's embedding sidecar.

- **Capabilities.** `record`, `recall`, `bootstrap`.
- **Model.** `kepler/qwen-2.5-14b-instruct` for the `bootstrap`
  synthesis; embeddings via the Cell's MiniLM-L6-v2 sidecar.
- **Storage.** PocketBase collection `wp_journal_entries`
  (ensured on first invocation).
- **Vault.** None.
- **Spools.** None at v0.1; future revision may wire DECISIONS
  and OPEN_QUESTIONS as Spools so the `bootstrap` capability
  retrieves rather than reads the files directly.

See `mission-lock.md` for the Journal's operative law and
`how-it-works.md` for the patron-side explanation.

## v0.1 scope

- `record` — append entries; embed; store.
- `recall` — cosine similarity search across embeddings.
- `bootstrap` — synthesise a markdown context blob from recent
  entries plus the tail of `DECISIONS.md` and `OPEN_QUESTIONS.md`.

Editing, deletion, and public export are deferred.

## Why it exists

Every session with Claude (or with the Cell's own Spinners) ends
with state the next session needs to know: what was tried, what
was decided, what's still open. The Foundation does not bolt that
state onto an LLM's context window opaquely — it builds the state
into a Spinner the Wizard reads from and writes to, the same way
he reads from the canon and the manuscript. The journal is the
explicit, citable form of that state.
