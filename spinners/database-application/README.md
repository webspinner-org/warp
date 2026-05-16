# @webspinner-foundation/database-application

Takes a Webspinner's plain-English description of what they want to keep track of, does the homework on their behalf from credible public references, and builds a working web application that does it — with no jargon and no missing steps.

Bookkeeping, plant tracking, donor logging, customer records, gradebooks, inventories — same Spinner, different domain. The first Webspinner-facing Spinner the Foundation ships.

- **Capabilities.** `propose` → `refine` → `build`. Three turns; the Webspinner drives the pace; the platform's `context.session` provides re-entrancy between turns.
- **Model.** `kepler/qwen-2.5-14b-instruct` (Quiet Loom on the Cell). Sovereign; no external LLM calls.
- **Outbound research.** `outboundAllowlist: ["en.wikipedia.org"]` for v0.1. Each fetch is audited; sources are cited in the narration the Webspinner reads.
- **Vault.** None.
- **Spools.** None at v0.1; schema-building discipline lives in the Mission Lock.

See `mission-lock.md` for the operative law and `how-it-works.md` for the Webspinner-facing explanation.
