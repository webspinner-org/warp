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
**Status:** Resolved in part by `DECISIONS.md` 2026-05-10 — _Tailscale for the Wizard's personal device mesh; not for federation_. Tailscale is acceptable for the Wizard's own two-device mesh (Spindle ↔ Kepler) because the coordination plane sees only node metadata. Federation between Cells of different Webspinners is _not_ Tailscale; it uses the Capability Bus over public TLS/QUIC with end-to-end signed invocations. The full federation transport spec remains pending.

## Mission Lock enforcement mechanism — text vs. mediated

**Question:** The current Claude Code Mission Lock mechanism is text-as-context (`MISSION-LOCK.md` loaded via `CLAUDE.md` auto-load). The settled eventual state (`DECISIONS.md` 2026-05-10 — _Mission-locked Weaver system prompt_; _The Weaver as Claude Code's exteriorized working memory_) is the Weaver mediating every outbound Claude Code LLM call through LiteLLM with the Mission Lock injected as the system prompt and full audit capture in the Grimoire. What is the migration path? At what point does the Weaver gain enough capability that the text-based mechanism is retired?
**Why it matters:** Text-based Mission Lock is moral and contextual; it can drift. Weaver-mediated Mission Lock is structural and auditable. Until the cutover happens, the discipline depends on Claude Code adhering to the text — a known failure mode of LLM-as-policy.
**Status:** Open. Likely sequence: (a) Weaver service stood up on Kepler; (b) MCP server exposes Weaver tools to Claude Code; (c) Claude Code's API calls in Warp repos are routed through the Weaver via LiteLLM rather than direct to Anthropic; (d) text Mission Lock retained as the canonical document but enforcement moves to the Weaver. The text version stays even after migration; it remains the document the operator and the model can both read.

## Audit log — when does Claude Code activity start landing in the Grimoire?

**Question:** At what point in bootstrap does Claude Code session activity (tool calls, file edits, decisions recorded) start producing entries in the Grimoire's audit log? The audit-log scheme itself is open (this file, _Audit log — cryptographic chaining scheme_); this is the operational question of when capture begins, not how the chain is structured.
**Why it matters:** The Five Rights' "Right to Inspect" depends on a complete audit trail. The bootstrap period before Weaver-mediation is a gap in that trail.
**Status:** Open. Likely answer: full audit capture starts when Weaver-mediated calls land (see prior question); the bootstrap period is documented as un-audited and the operator accepts that gap. The bootstrap gap should itself be recorded as a single audit entry once the chain begins, naming the period that was un-captured.

## Spinner integrity — canonical bundle digest

**Question:** What is the precise byte-level recipe for the canonical bundle a Spinner's digest hashes? The current bootstrap implementation in `loom/src/lib/server/spinners.ts` covers (a) the manifest as canonical-JSON with sorted keys followed by LF and (b) each documentation file's SHA-256 hash prefixed with its relative path. The entrypoint module's compiled bytes are not yet included — the build pipeline that produces deterministic bytes is open work. Does the recipe need to include build artifacts (`dist/index.js`), or can it cite source files plus a pinned compiler version?
**Why it matters:** Two operators with the same Spinner source must compute the same digest. The recipe is the contract. Drift in the recipe means Foundation-signed digests do not verify against re-computed digests on operators' machines, breaking the integrity story.
**Status:** Spec pending. Will live under `protocols/spinners/canonical-bundle.md` once drafted.

## Spinner signing — keys, custody, rotation, recognition revocation

**Question:** Which key custody scheme governs Foundation release signatures? Hardware-backed root key with rotated subkeys? An m-of-n council of Foundation directors? How are Cell-identity keys generated, stored, and rotated? What is the recognition-revocation pathway when a previously-trusted publisher misbehaves? `ed25519` is the current algorithm; what is the post-quantum migration path?
**Why it matters:** A signature scheme is only as strong as its key custody. The Foundation Pledge §11.2 forbids surrendering user keys to any third party; the same posture must apply to Foundation keys themselves. Recognition revocation is the lever the Pledge depends on (`TRADEMARK.md`).
**Status:** Open. This subsumes the prior _Recognition process for aligned implementations_ question — recognition is signature-mediated. Likely sequence: hardware-backed root key for the Foundation; m-of-n release council; per-Cell key in the Wizard's hardware (Secure Enclave on Apple Silicon, TPM on others); post-quantum migration tracks NIST PQC.

## Warp Thread runtime

**Question:** How does the Weaver execute a `WarpThreadManifest`? Step ordering (sequential by default, but can branches and joins be expressed in the schema?), partial-failure semantics (does a step's failure halt the thread, fall through, or fork?), retry policy (per-step or per-thread?), audit-event correlation (`wp.thread.invoke` umbrella event vs. each step's own `wp.spinner.invoke`?), input/output binding resolution (eagerly resolved or lazily as steps run?), and time-out handling.
**Why it matters:** The schema is settled (`WarpThreadManifest`); the runtime is what executes it. Without a runtime, threads are documentation. With a poorly-specified runtime, threads behave unpredictably — exactly the failure mode workflow engines tend to have.
**Status:** Open. Will live under `protocols/threads/runtime.md` once drafted. Not blocking; the bootstrap has no threads yet.

## Bootstrap Spinner runtime — migration to the canonical Weaver

**Question:** The bootstrap Weaver lives inside the Loom (`DECISIONS.md` 2026-05-10 — _Bootstrap Weaver runs inside the Loom_). Today it dispatches the Bootstrap Spinner's `consult` capability through Anthropic with the canon as a whole-file Spool read; the other three capabilities return `pending`. The canonical Weaver is Python + FastAPI per _Default stack_. What is the migration path? At what point does the bootstrap shim get retired?
**Why it matters:** A long-lived bootstrap shim is technical debt that competes with the canonical implementation for attention. A clean migration plan keeps the shim disposable.
**Status:** Open. Likely sequence: (a) implement `audit`, `record`, `surface` in the bootstrap Weaver to close the four-capability set; (b) stand up the canonical Python+FastAPI Weaver as a sibling process on Kepler; (c) point the Loom's invocation endpoint at the canonical Weaver; (d) remove the in-Loom shim. Each step is independently shippable.

## Spool registry and per-Spool sensitivity classification

**Question:** Spools today are wired statically in the Loom's `loom/src/lib/server/spools.ts`. The schema (`SpoolManifest`) names sensitivity (`public` / `personal` / `confidential` / `privileged`) — what enforces it? The Weaver should refuse to feed a Privileged Spool's content to a BYOK route the Cell has not authorized for Privileged-class content. Where is the Cell's per-route sensitivity policy stored, and how does it surface in the Loom?
**Why it matters:** §7 (Confidential SI) names sensitivity-aware routing as a privacy primitive. Without enforcement, classifications are decoration. Conversely, decorations that look like enforcement are worse than no decoration at all.
**Status:** Open. Will live under `protocols/spools/registry.md` once drafted. Likely sequence: (a) Spool registration via the Loom (Wizard or Spinner-driven); (b) per-Spool sensitivity policy stored in the Grimoire; (c) Weaver consults policy before routing; (d) refusal surfaces as a clear gating warning, not a silent fallback.

## Cell provisioning — Spinner-driven, agentless or agent-on-target?

**Question:** The Wizard wants Cell provisioning (install Docker, Node, pnpm, the Loom, the bootstrap Grimoire, Tailscale, registered superuser, registered vault master key) to be Spinner-driven and re-runnable for future Webspinner Cells. SSH access exists today but the Wizard prefers not to use it ongoing. Open-source tooling and industry best practice are favoured; reinventing wheels is not. Two architectural shapes are on the table:

1. **Local-Loom-self-provisions.** The Loom on the target machine has full local privileges (filesystem, package managers, Docker). A "Cell Provisioning" Spinner runs through the Loom and operates locally — no SSH, no agent. For the _initial_ bootstrap (no Loom yet), an Ansible playbook (industry standard, agentless, SSH-or-local-connection) installs the Loom; the operator runs `ansible-playbook bootstrap.yml -i localhost, --connection=local` once. From there, all admin operations go through the Loom.

2. **Cell Steward agent.** A small daemon on every Cell exposes a capability surface to the Loom (or to the federation). Initial install is still SSH or physical access; ongoing admin is via the daemon over LAN/Tailscale. Adds a moving part the agentless path avoids; gains the ability to admin remote Cells without SSH after bootstrap.

**Why it matters:** This is the platform-engineering layer the Foundation relies on for every Webspinner Cell. The shape we pick is the shape every operator inherits.

**Status:** Open. My lean (pending the Wizard's call): Option 1 for the bootstrap (Ansible playbooks, run locally on the target), with Option 2 reserved for later when remote-admin-without-SSH is a real requirement. Industry best practice candidates: Ansible (canonical agentless config), NixOS / nix-darwin (declarative; learning-curve; macOS+Linux), Pulumi (code-driven IaC). Empirical comparison and operator preference next turn. Will live under `protocols/cell-provisioning/`.

## Long-running Spinner state — schema, retention, polling cadence

**Question:** Per `DECISIONS.md` 2026-05-10 — _Observable, resilient Spinner state_ — long-running Spinner invocations write progress to the Grimoire; the Loom polls. What is the schema (`wp_invocation_state` collection: invocation id, step, percent-complete, last-update, partial-output handle, dead-detector heartbeat)? What is the retention policy (when do completed invocation states roll into the audit chain and out of the active store)? What is the Loom's polling cadence (constant 1Hz, exponential backoff, server-driven)? Is server-sent events a viable hybrid — pull-by-default, push-as-acceleration?
**Why it matters:** Without a settled schema, every Spinner invents its own progress model and the Loom's polling renderer becomes special-cased. The principle is operative; the implementation is the mechanism.
**Status:** Spec pending. Will live under `protocols/invocation-state/`.

## Pablo grounded retrieval — chunk-and-embed pipeline

**Question:** The Bootstrap Spinner's `consult` capability today loads the _whole_ canon as a single passage and dumps it into the model's system prompt (~20K tokens per call). Pablo (sentence-transformers / MiniLM-L6-v2 on `127.0.0.1:11446`) is wired (`loom/src/lib/server/kepler.ts → pabloEmbed()`) but is **not** in the retrieval path. The canonical pipeline per `WARP-CANON.md` §4 (WRAG):

1. Chunk each Spool source by section (`##` boundaries for canon; chapter for manuscript).
2. Embed every chunk via `pabloEmbed`; store vectors in PocketBase (`wp_pablo_chunks` with embedding-as-base64) or in-memory at startup.
3. At query time: embed the question via Pablo; cosine-similarity against the chunk store; return top-k passages.
4. Re-rank (BGE-reranker per canon §4 stage 3) — open work.

Today's "ground the entire canon" works because the canon is small (~30 KB → ~20K tokens) but does not honour the architecture. Per the operator's question — "are you using Pablo?" — the honest answer is no, not yet.

**Why it matters:** WRAG is canon §4. As Spools grow (manuscript chapters, audit log, federated peer corpora), whole-source-as-passage stops fitting. The retrieval stages are how the Spinner reasons over a moving target rather than a single static dump. Also: today's call-time cost is paying full canon-bytes per consult; embedding-and-retrieving top-k is faster + cheaper.

**Status:** Open. Implementation approach: (a) `loom/src/lib/server/pablo-pipeline.ts` — chunker + embedding cache + cosine-similarity top-k; (b) embed canon at Loom startup, persist to `wp_pablo_chunks`; (c) update `bootstrapConsult` to call the pipeline rather than `readSpool` directly; (d) audit emission distinguishes whole-spool reads from chunked reads. Will live under `protocols/wrag-pipeline/`.

## Resend + Turnstile credentials — vaulting the keys

**Question:** Wiring is done — `loom/src/lib/server/turnstile.ts` resolves `turnstile-site-key` and `turnstile-secret-key` from the vault and verifies tokens against Cloudflare's siteverify; the register form embeds the widget when the site key is present; the register action gates on verification. Resend send-on-register is also wired (`loom/src/lib/server/email.ts` resolves `resend-api-key` from the vault first, env var second). The remaining open item is **operational**: the Wizard needs to add the three keys to the vault via the Loom's `/admin/vault` page. Until those rows exist, the Cell stays in bootstrap mode (honeypot + rate-limit only; bootstrap verify-URL fallback in a short-lived cookie).
**Why it matters:** Operating Principle §17.2 (No Secrets via Claude Code) forbids pasting the keys into a Claude Code session. The vault is the canonical secret store; the wiring is complete but operationally inert until the secrets are _in_ the vault.
**Status:** Wiring shipped (`DECISIONS.md` 2026-05-10 — _Turnstile bot-defense wiring_). Operational: the Wizard adds `resend-api-key`, `turnstile-site-key`, `turnstile-secret-key` to the vault. The webspinner-forms Worker's existing site-key (`0x4AAAAAAC_etYqXdJL0Xs9e`) can serve as the bootstrap value if the Wizard wants to share a key across surfaces.

## Public canon vs private production work — repo split

**Question:** Direct operator instruction: "Docs for the open source community goes in GitHub. The Production work for Webspinner can be kept somewhat private for now." What is the precise split? Today everything lives in `~/warp/` and would push to a single GitHub repo. The split needs a clear rule so Spinner authors and the Wizard know where new artifacts go.

**Why it matters:** The Foundation's open-source posture (canon §11, Apache 2.0, `TRADEMARK.md`) wants the architectural canon publicly readable. Operational specifics for _this_ Cell — vault contents (already excluded), the Wizard's federation contract list when peers arrive, internal Spinner manifests that disclose customer details — should not be public.

**Status:** Spec pending. Likely shape:

- **Public** (`~/warp/`, pushed to `github.com/webspinner-org/warp`): canon, sdk, loom (sans secrets), bootstrap Spinner manifests + how-it-works docs, brand SVGs, license, docs.
- **Private** (`~/warp-cell/` or `~/.warp/cell/`, never pushed): per-Cell Spinner instances with operator-specific config, Cell identity keys, vault data, the Cell's journal, federation contracts.
- A `.gitignore` and a Spinner-loader path-resolution rule that finds Spinners in both `~/warp/spinners/` (public) and `~/warp-cell/spinners/` (private).

## Genesis Spinner — remaining handler implementations

**Question:** Genesis is 4/8 capabilities implemented (`provisionToolchain` v0.1 read-only probe; `syncRepo` rsync + git-clone; `buildWorkspace` pnpm install + build; `verifyCell` HTTP probes — see `DECISIONS.md` 2026-05-10 — _Genesis v0.2_). Four capabilities remain: `generateBootstrapState`, `deployGrimoire`, `seedVault`, `deployLoom`. Each _writes_ — keys, services, secrets, plists — and requires careful audit + idempotency design. What is the contract: rerun-safe (idempotent re-application against existing state) or one-shot (refuse to overwrite an existing Cell without an explicit force)? How do `deployGrimoire` and `deployLoom` build a launchd plist (macOS) vs systemd unit (Linux) from a single source description? Where does `seedVault` source the operator's keys from on a _peer_ Wizard's machine (their macOS Keychain? a sealed handoff package signed by the Foundation?)?
**Why it matters:** Cell provisioning is the Foundation's most-leveraged Spinner — every peer Wizard who joins in summer runs it. The remaining four capabilities are the ones that bring a Cell from "files on disk" to "running services with an authenticated Wizard". They define the operator handoff.
**Status:** Spec pending. The shell-capability contract is shipped and proven (`DECISIONS.md` 2026-05-10 — _Genesis v0.2_); the next four handlers extend it. Likely sequence: `generateBootstrapState` first (deterministic crypto, no service touch), then `seedVault` (operator-keychain interaction), then `deployGrimoire` and `deployLoom` (service registration; macOS launchd path is canonical, Linux systemd path is a separate decision).

## Quiet Loom — 14B model stability under prompt-pump load

**Question:** The 14B model (`mlx-community/Qwen2.5-14B-Instruct-4bit`) is now the launchd default and runs Pablo reliably on a fresh boot. Earlier it processed 3989 input tokens then crashed the mlx-server (semaphore leak warning), forcing a restart. What does the failure mode actually look like, and is it the 14B model itself, the prompt-pump pattern, or the mlx-server's session caching?
**Why it matters:** Pablo's nuance lives in the larger model. Sustained Pablo use (every admin page reviewed multiple times in a single session) is the load profile.
**Status:** Logged as observed behaviour. After a clean boot+bootstrap on Kepler the 14B is stable on the first 5-10 Pablo runs. Continued use over a session may surface the crash again — needs an isolation test (sustained prompt-pump against the 14B endpoint with the Pablo system prompt). `~/Library/Logs/webspinner-mlx-server/stderr.log` is the channel; the semaphore-leak warning is the signal.

## Dependency stability + simplicity-budget codification

**Question:** Both principles named in `DECISIONS.md` 2026-05-12 are operative as discipline; the codification artifacts are deferred. Concretely:

- **`DEPENDENCIES.md`** — tier table for every external dep + the swap plan per tier. Lives at the repo root. Treated as canon for dep additions.
- **ESLint custom rule `no-direct-tier0-imports`** — forbid Spinner code from importing `@noble/*` directly. Only `sdk/src/signing.ts` and `sdk/src/digest.ts` may. ~30 lines of rule code + a small AST traversal.
- **`tools/simplicity-audit` Spinner** — measures file size, identifier count, cyclomatic complexity, abstractions introduced, deps imported. Reports findings in the same shape as Pablo. Gates `tools/ship` on hard-cap violations. ~250 lines.
- **Dep-audit cadence** — every 6 months, list each dep, its tier, last release date, license, our wrapper module; flag stale deps for replacement. Could be a `tools/dep-audit` Spinner or a manual review.

**Status:** Open. Operative as discipline; not codified.

**Trigger to land:** the first real violation. Examples that would force one of the above to ship:

- Spinner code imports `@noble/*` directly (forces the ESLint rule).
- A Loom module crosses 400 lines without a `DECISIONS.md` justification (forces `tools/simplicity-audit`).
- A dep goes unmaintained for >12 months (forces the dep-audit cadence).

Until a trigger fires, the discipline lives in the Wizard's review + the operative commitments here.
