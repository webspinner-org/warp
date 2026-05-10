# Bootstrap Spinner

The first Spinner of the Webspinner Foundation Cell. Advances the Warp architecture grounded in the canon (`WARP-CANON.md`) and the *AI Enclosure* manuscript.

| File | What it is |
|---|---|
| `manifest.json` | Canonical manifest. The bytes the Loom reads and the digest hashes. |
| `mission-lock.md` | System prompt the Weaver injects at every invocation. |
| `how-it-works.md` | Plain-language explanation rendered in the Loom. |
| `src/index.ts` | Entrypoint contract the Weaver loads. |

## Capabilities

- **`consult`** — grounded answer to a question about Warp.
- **`audit`** — drift report against the canon.
- **`record`** — draft a `DECISIONS.md` entry.
- **`surface`** — surface unfinished threads.

See `how-it-works.md` for the operative explanation.

## Status

Bootstrap. The manifest, mission lock, and documentation are production-candidate. The runtime — the Weaver-side pipeline that resolves vault, retrieves WRAG context, calls Anthropic with the mission lock, verifies grounding, and records audit — is open work. See `~/warp/OPEN_QUESTIONS.md`.

When the runtime lands, this Spinner becomes invokable from the Loom without changes to its definition.
