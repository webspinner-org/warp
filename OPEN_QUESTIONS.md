# OPEN_QUESTIONS.md

Questions in flight. Promote settled questions to dated entries in `DECISIONS.md` and remove them from this file. Add new questions as they arise; do not silently let them drift.

Format:

    ## Short title
    **Question:** What is open.
    **Why it matters:** What hinges on the answer.
    **Status:** Where the thinking currently sits.

---

## Hetzner GPU availability in Hillsboro

**Question:** Does Hetzner currently offer dedicated GPU servers in the Hillsboro region with the specs `WEAVER-SETUP.md` calls for (48 GB+ VRAM, 128 GB+ RAM, NVMe storage, generous network)? Their primary US GPU presence has historically been Ashburn.
**Why it matters:** Determines whether the primary Weaver lives at Hetzner Hillsboro as planned, or whether a peer provider (Latitude.sh, Lambda, a colocated build) needs to be evaluated.
**Status:** Needs verification by the operator before the bootstrap checklist runs.

## Capability Bus protocol — first concrete spec document

**Question:** What is the wire format, message envelope, and signature scheme for the Capability Bus? The manuscript (ch. 13) describes the design; the spec text has not been written.
**Why it matters:** Required before any independent implementation, before federation can be tested between Spindle/Kepler/Hetzner Cells, and before Foundation-aligned recognition can apply to a third-party implementation.
**Status:** Spec pending. Will live under `protocols/capability-bus/` once drafted.

## WRAG protocol — formal pipeline spec

**Question:** What is the formal specification for the seven-stage WRAG pipeline (ch. 12)? Field schemas, intermediate representations, citation formats, audit-trail format.
**Why it matters:** Required for conformance testing across Grimoire implementations and for the grounding-verification stage to be checkable.
**Status:** Spec pending. Will live under `protocols/wrag/` once drafted.

## Audit log — cryptographic chaining scheme

**Question:** What is the exact scheme for the append-only, tamper-evident audit log (ch. 16)? Hash function, chaining structure, signature, periodic anchoring (e.g., to a transparency log)?
**Why it matters:** The Five Rights' "Right to Inspect" depends on an audit trail that cannot be silently rewritten. The scheme has to survive realistic compromise scenarios.
**Status:** Spec pending. Will live under `protocols/audit/` once drafted.

## Sensitivity classification — taxonomy and classifier model

**Question:** The manuscript (ch. 7) names Public/Personal/Confidential/Privileged as illustrative. What is the Foundation's recommended default taxonomy, what model serves as the default sensitivity classifier in the Weaver, and how is misclassification handled?
**Why it matters:** Sensitivity drives routing. A wrong classification can leak Privileged-class material to a BYOK provider. The classifier must be auditable and overridable.
**Status:** Open. Needs both a taxonomy proposal and a classifier-model choice (likely a small fast local model for low latency).

## Federation contract format

**Question:** What does a federation contract look like as a serializable artifact? Capability scopes, peer identity references, expiration, revocation mechanism, audit-log obligations.
**Why it matters:** Federation patterns (Family/Small-business/Community/Cooperative/Public, ch. 11) need a concrete form. Without it, federation is informal and ungovernable.
**Status:** Spec pending. Will live under `protocols/federation/` once drafted.

## Recognition process for aligned implementations

**Question:** The Foundation Pledge (ch. 26) and `TRADEMARK.md` reference a process by which a third-party implementation may apply for recognition as a Foundation-aligned implementation. What is the process? Who reviews? What evidence is required? How is recognition revoked?
**Why it matters:** The trademark policy assumes the recognition pathway exists. Until it does, the policy is one-sided.
**Status:** Open. Will be drafted alongside the Foundation governance documents.

## Post-quantum cryptographic migration

**Question:** Which post-quantum cryptographic primitives does Warp commit to, and on what timeline? The architecture is designed to support cryptographic agility (ch. 17), but the migration is future work.
**Why it matters:** Long-lived Cell identities and audit logs need to remain verifiable across the post-quantum transition.
**Status:** Tracking NIST PQC standardization. No commitment yet.

## How does Hetzner Hillsboro federate cleanly with Spindle and Kepler over a residential NAT?

**Question:** Tailscale or WireGuard solves it operationally, but is one preferred for the Weaver's threat model? Tailscale uses a third-party coordination server; WireGuard does not.
**Why it matters:** Aligns or misaligns with the architecture's "no central operator in the federation" commitment.
**Status:** Resolved in part by `DECISIONS.md` 2026-05-10 — *Tailscale for the Wizard's personal device mesh; not for federation*. Tailscale is acceptable for the Wizard's own two-device mesh (Spindle ↔ Kepler) because the coordination plane sees only node metadata. Federation between Cells of different Webspinners is *not* Tailscale; it uses the Capability Bus over public TLS/QUIC with end-to-end signed invocations. The full federation transport spec remains pending.

## Mission Lock enforcement mechanism — text vs. mediated

**Question:** The current Claude Code Mission Lock mechanism is text-as-context (`MISSION-LOCK.md` loaded via `CLAUDE.md` auto-load). The settled eventual state (`DECISIONS.md` 2026-05-10 — *Mission-locked Weaver system prompt*; *The Weaver as Claude Code's exteriorized working memory*) is the Weaver mediating every outbound Claude Code LLM call through LiteLLM with the Mission Lock injected as the system prompt and full audit capture in the Grimoire. What is the migration path? At what point does the Weaver gain enough capability that the text-based mechanism is retired?
**Why it matters:** Text-based Mission Lock is moral and contextual; it can drift. Weaver-mediated Mission Lock is structural and auditable. Until the cutover happens, the discipline depends on Claude Code adhering to the text — a known failure mode of LLM-as-policy.
**Status:** Open. Likely sequence: (a) Weaver service stood up on Kepler; (b) MCP server exposes Weaver tools to Claude Code; (c) Claude Code's API calls in Warp repos are routed through the Weaver via LiteLLM rather than direct to Anthropic; (d) text Mission Lock retained as the canonical document but enforcement moves to the Weaver. The text version stays even after migration; it remains the document the operator and the model can both read.

## Audit log — when does Claude Code activity start landing in the Grimoire?

**Question:** At what point in bootstrap does Claude Code session activity (tool calls, file edits, decisions recorded) start producing entries in the Grimoire's audit log? The audit-log scheme itself is open (this file, *Audit log — cryptographic chaining scheme*); this is the operational question of when capture begins, not how the chain is structured.
**Why it matters:** The Five Rights' "Right to Inspect" depends on a complete audit trail. The bootstrap period before Weaver-mediation is a gap in that trail.
**Status:** Open. Likely answer: full audit capture starts when Weaver-mediated calls land (see prior question); the bootstrap period is documented as un-audited and the operator accepts that gap. The bootstrap gap should itself be recorded as a single audit entry once the chain begins, naming the period that was un-captured.

## Spinner integrity — canonical bundle digest

**Question:** What is the precise byte-level recipe for the canonical bundle a Spinner's digest hashes? The current bootstrap implementation in `loom/src/lib/server/spinners.ts` covers (a) the manifest as canonical-JSON with sorted keys followed by LF and (b) each documentation file's SHA-256 hash prefixed with its relative path. The entrypoint module's compiled bytes are not yet included — the build pipeline that produces deterministic bytes is open work. Does the recipe need to include build artifacts (`dist/index.js`), or can it cite source files plus a pinned compiler version?
**Why it matters:** Two operators with the same Spinner source must compute the same digest. The recipe is the contract. Drift in the recipe means Foundation-signed digests do not verify against re-computed digests on operators' machines, breaking the integrity story.
**Status:** Spec pending. Will live under `protocols/spinners/canonical-bundle.md` once drafted.

## Spinner signing — keys, custody, rotation, recognition revocation

**Question:** Which key custody scheme governs Foundation release signatures? Hardware-backed root key with rotated subkeys? An m-of-n council of Foundation directors? How are Cell-identity keys generated, stored, and rotated? What is the recognition-revocation pathway when a previously-trusted publisher misbehaves? `ed25519` is the current algorithm; what is the post-quantum migration path?
**Why it matters:** A signature scheme is only as strong as its key custody. The Foundation Pledge §11.2 forbids surrendering user keys to any third party; the same posture must apply to Foundation keys themselves. Recognition revocation is the lever the Pledge depends on (`TRADEMARK.md`).
**Status:** Open. This subsumes the prior *Recognition process for aligned implementations* question — recognition is signature-mediated. Likely sequence: hardware-backed root key for the Foundation; m-of-n release council; per-Cell key in the Wizard's hardware (Secure Enclave on Apple Silicon, TPM on others); post-quantum migration tracks NIST PQC.

## Warp Thread runtime

**Question:** How does the Weaver execute a `WarpThreadManifest`? Step ordering (sequential by default, but can branches and joins be expressed in the schema?), partial-failure semantics (does a step's failure halt the thread, fall through, or fork?), retry policy (per-step or per-thread?), audit-event correlation (`wp.thread.invoke` umbrella event vs. each step's own `wp.spinner.invoke`?), input/output binding resolution (eagerly resolved or lazily as steps run?), and time-out handling.
**Why it matters:** The schema is settled (`WarpThreadManifest`); the runtime is what executes it. Without a runtime, threads are documentation. With a poorly-specified runtime, threads behave unpredictably — exactly the failure mode workflow engines tend to have.
**Status:** Open. Will live under `protocols/threads/runtime.md` once drafted. Not blocking; the bootstrap has no threads yet.

## Bootstrap Spinner runtime — migration to the canonical Weaver

**Question:** The bootstrap Weaver lives inside the Loom (`DECISIONS.md` 2026-05-10 — *Bootstrap Weaver runs inside the Loom*). Today it dispatches the Bootstrap Spinner's `consult` capability through Anthropic with the canon as a whole-file Spool read; the other three capabilities return `pending`. The canonical Weaver is Python + FastAPI per *Default stack*. What is the migration path? At what point does the bootstrap shim get retired?
**Why it matters:** A long-lived bootstrap shim is technical debt that competes with the canonical implementation for attention. A clean migration plan keeps the shim disposable.
**Status:** Open. Likely sequence: (a) implement `audit`, `record`, `surface` in the bootstrap Weaver to close the four-capability set; (b) stand up the canonical Python+FastAPI Weaver as a sibling process on Kepler; (c) point the Loom's invocation endpoint at the canonical Weaver; (d) remove the in-Loom shim. Each step is independently shippable.

## Spool registry and per-Spool sensitivity classification

**Question:** Spools today are wired statically in the Loom's `loom/src/lib/server/spools.ts`. The schema (`SpoolManifest`) names sensitivity (`public` / `personal` / `confidential` / `privileged`) — what enforces it? The Weaver should refuse to feed a Privileged Spool's content to a BYOK route the Cell has not authorized for Privileged-class content. Where is the Cell's per-route sensitivity policy stored, and how does it surface in the Loom?
**Why it matters:** §7 (Confidential SI) names sensitivity-aware routing as a privacy primitive. Without enforcement, classifications are decoration. Conversely, decorations that look like enforcement are worse than no decoration at all.
**Status:** Open. Will live under `protocols/spools/registry.md` once drafted. Likely sequence: (a) Spool registration via the Loom (Wizard or Spinner-driven); (b) per-Spool sensitivity policy stored in the Grimoire; (c) Weaver consults policy before routing; (d) refusal surfaces as a clear gating warning, not a silent fallback.

## Cell provisioning — Spinner-driven, agentless or agent-on-target?

**Question:** The Wizard wants Cell provisioning (install Docker, Node, pnpm, the Loom, the bootstrap Grimoire, Tailscale, registered superuser, registered vault master key) to be Spinner-driven and re-runnable for future Webspinner Cells. SSH access exists today but the Wizard prefers not to use it ongoing. Open-source tooling and industry best practice are favoured; reinventing wheels is not. Two architectural shapes are on the table:

1. **Local-Loom-self-provisions.** The Loom on the target machine has full local privileges (filesystem, package managers, Docker). A "Cell Provisioning" Spinner runs through the Loom and operates locally — no SSH, no agent. For the *initial* bootstrap (no Loom yet), an Ansible playbook (industry standard, agentless, SSH-or-local-connection) installs the Loom; the operator runs `ansible-playbook bootstrap.yml -i localhost, --connection=local` once. From there, all admin operations go through the Loom.

2. **Cell Steward agent.** A small daemon on every Cell exposes a capability surface to the Loom (or to the federation). Initial install is still SSH or physical access; ongoing admin is via the daemon over LAN/Tailscale. Adds a moving part the agentless path avoids; gains the ability to admin remote Cells without SSH after bootstrap.

**Why it matters:** This is the platform-engineering layer the Foundation relies on for every Webspinner Cell. The shape we pick is the shape every operator inherits.

**Status:** Open. My lean (pending the Wizard's call): Option 1 for the bootstrap (Ansible playbooks, run locally on the target), with Option 2 reserved for later when remote-admin-without-SSH is a real requirement. Industry best practice candidates: Ansible (canonical agentless config), NixOS / nix-darwin (declarative; learning-curve; macOS+Linux), Pulumi (code-driven IaC). Empirical comparison and operator preference next turn. Will live under `protocols/cell-provisioning/`.

## Long-running Spinner state — schema, retention, polling cadence

**Question:** Per `DECISIONS.md` 2026-05-10 — *Observable, resilient Spinner state* — long-running Spinner invocations write progress to the Grimoire; the Loom polls. What is the schema (`wp_invocation_state` collection: invocation id, step, percent-complete, last-update, partial-output handle, dead-detector heartbeat)? What is the retention policy (when do completed invocation states roll into the audit chain and out of the active store)? What is the Loom's polling cadence (constant 1Hz, exponential backoff, server-driven)? Is server-sent events a viable hybrid — pull-by-default, push-as-acceleration?
**Why it matters:** Without a settled schema, every Spinner invents its own progress model and the Loom's polling renderer becomes special-cased. The principle is operative; the implementation is the mechanism.
**Status:** Spec pending. Will live under `protocols/invocation-state/`.

## Pablo grounded retrieval — chunk-and-embed pipeline

**Question:** The Bootstrap Spinner's `consult` capability today loads the *whole* canon as a single passage and dumps it into the model's system prompt (~20K tokens per call). Pablo (sentence-transformers / MiniLM-L6-v2 on `127.0.0.1:11446`) is wired (`loom/src/lib/server/kepler.ts → pabloEmbed()`) but is **not** in the retrieval path. The canonical pipeline per `WARP-CANON.md` §4 (WRAG):
1. Chunk each Spool source by section (`##` boundaries for canon; chapter for manuscript).
2. Embed every chunk via `pabloEmbed`; store vectors in PocketBase (`wp_pablo_chunks` with embedding-as-base64) or in-memory at startup.
3. At query time: embed the question via Pablo; cosine-similarity against the chunk store; return top-k passages.
4. Re-rank (BGE-reranker per canon §4 stage 3) — open work.

Today's "ground the entire canon" works because the canon is small (~30 KB → ~20K tokens) but does not honour the architecture. Per the operator's question — "are you using Pablo?" — the honest answer is no, not yet.

**Why it matters:** WRAG is canon §4. As Spools grow (manuscript chapters, audit log, federated peer corpora), whole-source-as-passage stops fitting. The retrieval stages are how the Spinner reasons over a moving target rather than a single static dump. Also: today's call-time cost is paying full canon-bytes per consult; embedding-and-retrieving top-k is faster + cheaper.

**Status:** Open. Implementation approach: (a) `loom/src/lib/server/pablo-pipeline.ts` — chunker + embedding cache + cosine-similarity top-k; (b) embed canon at Loom startup, persist to `wp_pablo_chunks`; (c) update `bootstrapConsult` to call the pipeline rather than `readSpool` directly; (d) audit emission distinguishes whole-spool reads from chunked reads. Will live under `protocols/wrag-pipeline/`.

## Vitest + Playwright test harness — productionise the integration tests

**Question:** The integration tests run today are bash + curl scripts on Kepler — they ARE real e2e validation, but they live in this conversation's tool calls, not in the repo. Codifying them into Vitest (unit + lib) and Playwright (full-stack against the live Loom) is canon-required per §17.4 (Observable, Resilient State) and §17.6 (test discipline, pending). The shape:
- **Vitest** at workspace root for unit tests across `sdk`, `loom`'s server libs, and `spinners/*`'s manifest validators. Standard SvelteKit stack.
- **Playwright** for e2e against the live Loom — register → verify → /admin → invoke. Already half-set-up (lifted from si-native, one passing e2e).
- **Spinner dry-run mode** as a contract: every capability accepts `{ dryRun: true }` in input, returns shape-correct output without side-effects, emits audit + Silk Pattern with a `dry_run` discriminator.

**Why it matters:** Direct operator instruction: "putting off vitest is fine, but be sure it does not fall through the cracks." This entry is the seam that prevents the fall-through. Shipping Wow-baseline UX without an automated regression net is recoverable in a small Cell of one operator; once peers join in summer, lack of e2e + dry-run becomes the bottleneck on every release.

**Status:** Spec pending. Likely sequence: (a) add `vitest`, `@vitest/ui`, `@playwright/test` to root devDeps (Playwright already present in loom); (b) `vitest.workspace.ts` at root; (c) port the bash integration tests to Playwright specs; (d) add `dryRun` flag to `SpinnerCapability` schema + Weaver dispatch; (e) add §17.6 to `WARP-CANON.md` operating principles. Will live under `protocols/test-discipline/`.

## Resend + Turnstile credentials — vaulting + wiring

**Question:** The webspinner-forms Worker (`~/websites/webspinner-forms/src/index.js`) implements the canonical register-with-email-verify pattern: client-side Cloudflare Turnstile widget → server-side `siteverify` → MX check → Resend send to both submitter (verify request) and operator (notification with `[UNVERIFIED]`) → submitter clicks verify link → second Resend goes out (`✓ VERIFIED`). The secrets live as Cloudflare Worker env vars (`RESEND_API_KEY`, `TURNSTILE_SECRET`), not in the macOS keychain or the local filesystem on Spindle. How do they reach the Loom?
**Why it matters:** Operating Principle §17.2 (No Secrets via Claude Code) forbids the Wizard from pasting the keys into a Claude Code session. The vault is the canonical secret store; until those secrets are *in* the vault, the email + bot-check flow is infrastructurally complete but operationally inert. Today's bot defense (honeypot + rate limit) is sufficient against opportunistic bots but not targeted abuse.
**Status:** Open. Likely sequence: (a) the Wizard adds `resend-api-key` and `turnstile-secret` to the vault via the Loom's `/admin/vault` page (the only canon-aligned path); (b) a focused turn wires `users.ts` to call the Resend HTTP API with `vault://_self/resend-api-key` and Cloudflare's `siteverify` with `vault://_self/turnstile-secret`; (c) the `users` collection's `requireVerification` flag flips on so unverified sessions can't reach `/admin/*`. Site-key for Turnstile is already public (`0x4AAAAAAC_etYqXdJL0Xs9e`, hardcoded in tenant sites) and can land in code without vault.

## Wizard's Journal — operational activity log + Claude bootstrap context

**Question:** A new Cell-resident capability: a journal that captures session-level activity (what was attempted, what shipped, what failed, what's still in flight) on Kepler, distinct from `DECISIONS.md` (which is settled architecture) and from the Grimoire's audit chain (which is per-invocation telemetry). The journal should:
- Live on Kepler in a Cell-private location (`~/Library/Application Support/Webspinner Foundation/Journal/<yyyy-mm-dd>.md` is one shape).
- Be writeable by the Bootstrap Spinner via a `chronicle` capability (replacing or complementing today's `record`, which writes to `DECISIONS.md`).
- Be readable through the Loom — `/admin/journal` route renders the recent entries with Wow-as-Baseline polish.
- **Become Claude Code's bootstrap context** in lieu of or alongside `CLAUDE.md` — when a fresh Claude Code session opens in `~/warp/`, it reads `the latest journal entries` first, `WARP-CANON.md` second, and the manuscript chapters per task as before. The journal carries forward the operational continuity the canon does not.

**Why it matters:** The Wizard has ADD; long-running operational state is currently lost between sessions because there is no narrative carrier between `DECISIONS.md` (too coarse, append-only) and the audit chain (too fine, machine-keyed). Direct operator instruction: "the journaling should become the way we bootstrap Claude if needed in the future."

**Status:** Spec pending. Will live under `protocols/journal/` once drafted. Likely sequence: (a) PocketBase collection `wp_journal` on Kepler with markdown-text entries indexed by ISO date and tag; (b) `chronicle` capability on the Bootstrap Spinner that takes a free-form note + tags and writes a journal entry; (c) `/admin/journal` Loom route with daily/weekly views + search; (d) update Claude Code's boot order in `CLAUDE.md` to read the latest journal first.

## Public canon vs private production work — repo split

**Question:** Direct operator instruction: "Docs for the open source community goes in GitHub. The Production work for Webspinner can be kept somewhat private for now." What is the precise split? Today everything lives in `~/warp/` and would push to a single GitHub repo. The split needs a clear rule so Spinner authors and the Wizard know where new artifacts go.

**Why it matters:** The Foundation's open-source posture (canon §11, Apache 2.0, `TRADEMARK.md`) wants the architectural canon publicly readable. Operational specifics for *this* Cell — vault contents (already excluded), the Wizard's federation contract list when peers arrive, internal Spinner manifests that disclose customer details — should not be public.

**Status:** Spec pending. Likely shape:
- **Public** (`~/warp/`, pushed to `github.com/webspinner-org/warp`): canon, sdk, loom (sans secrets), bootstrap Spinner manifests + how-it-works docs, brand SVGs, license, docs.
- **Private** (`~/warp-cell/` or `~/.warp/cell/`, never pushed): per-Cell Spinner instances with operator-specific config, Cell identity keys, vault data, the Cell's journal, federation contracts.
- A `.gitignore` and a Spinner-loader path-resolution rule that finds Spinners in both `~/warp/spinners/` (public) and `~/warp-cell/spinners/` (private).

## Genesis Spinner — handler implementation

**Question:** The Genesis Spinner (`~/warp/spinners/genesis/`) declares eight capabilities — `provisionToolchain`, `syncRepo`, `buildWorkspace`, `generateBootstrapState`, `deployGrimoire`, `seedVault`, `deployLoom`, `verifyCell` — each documented in `how-it-works.md` from the founding bootstrap. Handlers are unimplemented. What is the implementation language and shape? The Spinner runs in the Weaver context, so handlers fit the existing Spinner contract (`invoke(capability, input, context)`); but provisioning operations require shell-out (Homebrew, rsync, launchctl) which the canonical Spinner contract has not yet specified. Does the Weaver expose a `context.shell()` helper, scoped per-Spinner per-capability with declared command allowlists? Or do provisioning Spinners use a different runtime envelope?
**Why it matters:** Cell provisioning is the Foundation's most-leveraged Spinner — every operator runs it. Its shape sets the precedent for any Spinner that needs to perform OS-level operations.
**Status:** Spec pending. Likely answer: a `context.shell({ command, args, cwd, env })` helper exposed *only* to Spinners that declare the corresponding capability in their manifest (e.g., `provisionToolchain` declares `requires: ['shell:brew', 'shell:apt']`); the Weaver enforces the allowlist. For the very first Cell, a tiny `~/warp/cli/genesis-bootstrap` CLI runs the same handlers without the Weaver — closing the chicken-and-egg.

## Pablo's foundation library — port to a Spool

**Question:** The v0 foundation library now lives on disk at `~/warp/spinners/pablo/library/` (six entries: `README`, `contrast`, `typography`, `composition`, `brand-consistency`, `cards`). Pablo's Mission Lock still inlines the rules; the library files are appealable references the Wizard quotes when overriding. The next move is to make the directory a `pablo-references` Spool that Pablo retrieves from at invocation, so the library can grow without bloating his system prompt, and so Pablo's citations resolve to specific file+section anchors rather than to paragraphs in the lock.
**Why it matters:** Inline rules cap Pablo at the system-prompt budget; the library files are unbounded. Spool retrieval also makes the citation chain ("WCAG 2.2 SC 1.4.3 — see `contrast.md`") clickable from Pablo's findings.
**Status:** v0 library files committed. Spool wiring spec pending: probably `@webspinner-foundation/pablo-references` declared in Pablo's manifest, registered via `spools.ts`, read by `dispatchPablo` and concatenated into the system prompt at top-k chunks for the surface under review.

## Quiet Loom — 14B model stability under prompt-pump load

**Question:** The 14B model (`mlx-community/Qwen2.5-14B-Instruct-4bit`) is now the launchd default and runs Pablo reliably on a fresh boot. Earlier it processed 3989 input tokens then crashed the mlx-server (semaphore leak warning), forcing a restart. What does the failure mode actually look like, and is it the 14B model itself, the prompt-pump pattern, or the mlx-server's session caching?
**Why it matters:** Pablo's nuance lives in the larger model. Sustained Pablo use (every admin page reviewed multiple times in a single session) is the load profile.
**Status:** Logged as observed behaviour. After a clean boot+bootstrap on Kepler the 14B is stable on the first 5-10 Pablo runs. Continued use over a session may surface the crash again — needs an isolation test (sustained prompt-pump against the 14B endpoint with the Pablo system prompt). `~/Library/Logs/webspinner-mlx-server/stderr.log` is the channel; the semaphore-leak warning is the signal.
**Status:** Spec pending. v0.1 candidate: per-capability components in `loom/src/lib/admin/capabilities/`, picked by capability name; fallback to JSON for unrecognised capabilities (with a "Show developer view" toggle always available).
