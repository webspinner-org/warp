# @webspinner-foundation/pablo

The Foundation's design-quality reviewer. Walks a rendered HTML surface
against the cited library — WCAG, web.dev, NN/g, Stephen Few, brand
consistency — and returns severity-tagged findings. Theatrical in
voice; exact in citations.

- **Capability.** `review` — input `{ html, label?, topic? }`, output
  `{ verdict, verdict_text, in_pablo_voice, findings[] }`.
- **Model.** `kepler/qwen-2.5-14b-instruct` (Quiet Loom on the Cell).
- **Vault.** None.
- **Spools.** None at v0.1; the foundation library is inlined in
  the Mission Lock. A `pablo-references` Spool lands when the
  library is committed (`OPEN_QUESTIONS.md`).

See `mission-lock.md` for Pablo's operative law and `how-it-works.md`
for the patron-side explanation.
