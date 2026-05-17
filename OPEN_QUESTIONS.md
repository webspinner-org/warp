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

## Terminology debt — "patron" remaining in pre-existing files

**Question:** Per `DECISIONS.md` 2026-05-12 — _Vocabulary correction: "Webspinner" is the canonical role term_ — the canonical role term is **Webspinner**, not **patron**. My recent work has been corrected. Pre-existing files retain "patron" usage.

**Drift remaining:**

- `spinners/pablo/library/contrast.md`, `cards.md`, `f-pattern-scanning.md`,
  `brand-consistency.md`, `progress-revealing.md` — design citations
  refer to "the patron" as the UI user.
- `spinners/pablo/mission-lock.md`, `how-it-works.md`, `README.md`,
  `src/index.ts` — Pablo's framing.
- `spinners/bootstrap/how-it-works.md` — Bootstrap's framing.
- `loom/src/lib/server/kepler.ts` — `// patron-path generation` etc.
- `loom/src/lib/server/weaver.ts` — line 547 has the Bootstrap
  Spinner's vocabulary list including `/ Patron`; lines 593, 597
  reference patron-facing copy.
- `loom/src/lib/server/turnstile.ts` — comment mentioning
  "patron-facing registration."
- `ROADMAP.md` — pre-existing content references patron auth, patron
  Loom, patron path.
- References to `POLICY-PATRON-PATH-LLM.md` (different repo at
  `~/webspinner-work/`).

**Status:** Open. Sound as old usage; consistent within each file but
drifts from the canon.

**Trigger to land:** Either (1) a dedicated terminology-debt cleanup
batch when the Wizard wants it, or (2) opportunistic — each file gets
its terms updated when touched for another reason (`tools/audit` on
the file should now flag the drift as an error, since the canon's
position is established in `DECISIONS.md` 2026-05-12).

The Bootstrap Spinner's drift-detection vocabulary list in
`weaver.ts:547` (which lists `/ Patron` as a canonical term) is
particularly load-bearing — `tools/audit` reads from that list when
evaluating drift. Updating that list to use "Webspinner" instead of
"Patron" would propagate the correction through every future audit
run; that's the highest-leverage single edit for this debt, if
prioritized.

## Cells/spinners workspace resolution

**Question:** Cell-authored Spinners at `~/Cells/spinners/<slug>/` cannot resolve `@webspinner-foundation/sdk` (or any other workspace package) when their entrypoint is dynamically imported by the Weaver. The current pnpm workspace at `~/warp/` only includes `sdk`, `loom`, `spinners/*`. `~/Cells/spinners/*` is outside the workspace.

**Today's limitation:**

- Hello-spinner template + every Spinner scaffolded from it: works,
  because the entrypoint has zero external imports (just plain TS
  functions exported as default + named).
- Any Spinner that imports from `@webspinner-foundation/sdk`, `ajv`,
  or anything else: fails at `import()` time with module-not-found.

**Two paths to land:**

1. **Add `~/Cells/spinners/*` to `pnpm-workspace.yaml`.** Then every
   Cell-authored Spinner's `package.json` (which declares
   `@webspinner-foundation/sdk: workspace:*`) auto-resolves via the
   pnpm symlink graph. Side effect: every Cell-authored Spinner
   contributes to the workspace `pnpm install` and its tests would
   be discovered by `pnpm -r test`. Acceptable during bootstrap;
   might need filtering at scale.

2. **The install op runs `pnpm install` in the bundle directory.**
   Each bundle gets its own `node_modules/`. Heavier on disk; works
   even when bundles aren't workspace members. Closer to how the
   federation epoch will need to work (when peer Cells install
   foreign bundles).

**Recommendation:** start with (1) for bootstrap; migrate to (2) when
federation-recognized Spinners arrive (those must be self-contained,
not workspace-linked).

**Status:** Open. Hello-spinner doesn't need this; the gap surfaces
when the first non-trivial Cell-authored Spinner is built.

**Trigger to land:** the first Spinner template (`weave-website`,
`weave-form`, `weave-app-package` from `VISION.md`) that actually
calls into the SDK at runtime.

---

## 2026-05-12 — Agentic build loop (next pillar)

**Question:** Can the Webspinner architecture host a cluster of
cooperating Spinners that close the build loop — author code,
verify behaviour, critique drift, heal failures — without the
Wizard in every iteration? Human-in-the-loop retreats to **release
gating** only. Strategic direction and Pledge enforcement remain
human-in-the-loop; the iteration itself becomes the cluster's job.

**Why it matters:** Today Claude Code is one undifferentiated lump
trying to be author + tester + critic + chat-partner. The roles
fight each other; the chat-partner role bottlenecks the rest.
Pablo proved a fit-for-purpose SI can iterate without the Wizard.
This question asks whether that proof generalises to the full
build loop.

**Where the thinking lives:** `AGENTIC-BUILD-LOOP.md` at the repo
root — proposed roles (Author / Witness / Pablo / Mender), MVP cut,
open sub-questions on coordination, deployment, brief format,
test-pattern simplification.

**Trigger to land:** the next Spinner the Wizard wants authored.
Build it through the loop instead of through Claude Code.

**Status:** Open. Note captured at end of v2 Weaver's Tension
iteration. Author v0 + Witness v0 is the smallest closed loop;
Mender is v2.

---

## 2026-05-12 — WT bugs found at end of v2 testing

Two bugs the Wizard surfaced after my "passes e2e twice" report. The
e2e harness misses both because it auths as `wizard@webspinner.foundation`
(a `_superusers` token); the Wizard testing in Safari auths as
a user-collection account (a `users` token). Pattern: **the harness
must exercise the user-token path, not only the superuser path**.

### Bug 1 — install op fails with `identity-failed` / `{"kind":"auth"}` under a user-token session

**Root cause:** `loom/src/routes/admin/spinners/new/+page.server.ts`
passes `session.token` (which may be a `users`-collection JWT) into
`installSpinnerBundle`. The install op then uses that token to read
`wp_cell_identity` and `wp_audit`. PB returns 403 because user
tokens don't bypass collection rules; the install op surfaces it as
`identity-failed`.

**Fix:** in the form action, derive a superuser token via
`loomPbToken(fetch)` and pass THAT into `installSpinnerBundle` for
the PB-side operations (identity / audit / skein / operations
collections). The `actor` recorded in audit + op envelopes is still
the user (correct identity); the bearer used for collection access
is the Loom's superuser (correct privilege).

**Audit pattern to fix elsewhere:** every form action that takes a
user-initiated request and performs Loom-privileged operations
needs the same split — actor from session, bearer from
`loomPbToken`. Audit `/admin/signing/sign`, `/admin/signing/verify`,
`/admin/spinners/[name]/+page.server.ts` (refreshIntegrity), every
op-emitting handler.

### Bug 2 — runs that escalate stay `in-progress` in `wp_weavers_tension_runs`

**Root cause:** `executor.ts` calls `onEscalate` when a step fails
permanently. The player's `onEscalate` hook only updates local
state (`runStatus = 'failed'`) and does not call a server action.
The PB row's `status` stays `in-progress`. The Wizard sees stale
"running" rows on the index for up to 10 minutes (the staleness
reaper window) before they auto-abort.

**Fix:** add a `markRunFailed` form action that sets
`run.status = 'failed'` (new run status), updates `endedAt`, emits
`wp.weavers-tension.aborted`. The player's `onEscalate` calls it.

**Also:** the staleness window is too long for hand-driven testing.
Drop to 2 minutes for `in-progress` rows that have ZERO step
results (they never started executing) and keep 10 minutes for
rows with partial progress.

### Plus — the e2e harness should test both paths

The harness currently auths as `_superusers` only. It should also
run the scenario as a regular user (after creating one) to catch
privilege-boundary bugs like Bug 1 before they reach the Wizard.

These three live in the morning queue, not tonight's.

## Cleanup: dangling `try.webspinner.ai.webspinner.work` CNAME

A `cloudflared tunnel route dns webspinner-prod try.webspinner.ai` invocation on 2026-05-16 mis-rooted the hostname against the `cert.pem` zone (`webspinner.work`) and the prefix-matched `webspinner-kepler` tunnel instead of `webspinner-prod`. Result: a CNAME `try.webspinner.ai.webspinner.work` exists in the `webspinner.work` zone, pointing to the old tunnel. It has no matching ingress so no traffic flows through it, but it is leftover.

The `webspinner-ai-try` vault token is scoped to `webspinner.ai` only and cannot delete records in `webspinner.work`. Two paths to clean up:

1. Mint a one-shot `webspinner.work` Zone → DNS Edit token, delete the record, discard the token.
2. Re-run `cloudflared tunnel login` to refresh `cert.pem` with the broader zone set, then `cloudflared tunnel route ip delete` (verify subcommand exists) or hit the CF API.

Path 1 is cleaner. Not urgent — the record is inert.

**Lesson for future tunnel DNS work in this repo:** `cloudflared tunnel route dns` is unreliable when the cert's zone differs from the target hostname's zone, and unreliable when tunnel names share a prefix. Prefer direct CF API CNAME PATCH with a zone-scoped token + the tunnel UUID. See `DECISIONS.md` 2026-05-16 — Production tunnel separation.

## 2026-05-16 — Demo Cell runtime — patron-facing Spinner orchestration (in flight)

**Question:** Building the patron-facing Spinner runtime at `try.webspinner.ai` as a generalised AI Agent Orchestration substrate — a dedicated Demo Cell on Kepler that hosts any Foundation-approved patron-facing Spinner via a roster file. Database Application is the first; the design must scale to the meta-Spinner and the other archetypes (iPhone App, Website, Simple Game, Custom AI Spinner, `weave-form`, future Webspinner Spinners) without per-Spinner deployment work.

**Why it matters:** The Wizard's standing instruction is that the demo at `try.webspinner.ai` is "open to anyone, only local LLMs on Kepler, isolated so cleanup is simple and contained." The architecture has to honour all three constraints AND remain coherent as the Foundation ships more patron-facing Spinners. Per Operating Principle §17.3 (_Production-Candidate Quality Only_), this is the canonical Foundation pattern for public Spinner hosting, not a one-off for Database Application.

**Status:** Architectural decision recorded in `DECISIONS.md` 2026-05-16 — _Demo Cell pattern — patron-facing Spinner runtime architecture_. Operative execution plan lives in `DEMO-RUNTIME-PLAN.md` at the repo root. Four pieces R0–R4; status column tracks the resume point. Four open deployment sub-decisions named in the plan; the Wizard confirms or overrides each before R0 lands. The Database Application Spinner is already authored, signed, installed in the operator's Skein, and dispatched-ready (`dispatchDatabaseApplication` in `loom/src/lib/server/weaver.ts` — `propose` wired; `refine`/`build` throw pending). The demo runtime is what closes the loop on actually using it from the public surface.

**Trigger to land:** R0 (Demo Cell infrastructure) is the next piece. Once the four sub-decisions are confirmed (PB data dir, env source, identity-key generation, plist location), R0–R4 execute in order. R3 + R4 are the visible-to-patron pieces; R0–R2 are the infrastructure underneath.

**Resume:** A fresh Claude session reads `DEMO-RUNTIME-PLAN.md` and continues from the first piece marked **not started** in its Status column.

## 2026-05-16 — Kepler platform engineering — issues surfaced during Demo Cell provisioning

Three engineering issues encountered bringing up the Demo Cell on Kepler. Logged here so they don't fall through the cracks. Per the Wizard's standing rule — do not paper over platform issues.

### 1. Homebrew Python 3.14 on Kepler has broken `plistlib`

`/opt/homebrew/bin/python3` is Python 3.14.4. `plistlib` imports `xml.parsers.expat → pyexpat`, which fails at load with `Symbol not found: _XML_SetAllocTrackerActivationThreshold` — a libexpat ABI mismatch between Homebrew's pyexpat extension and macOS-system `/usr/lib/libexpat.1.dylib`. Workaround applied in `tools/demo-cell-up`: write the launchd plist via plain XML heredoc + a Bash `xml_escape` helper. **Root cause:** Homebrew's python@3.14 was compiled against a newer libexpat than the system provides.

**Fix paths (pick one):**

- `brew reinstall python@3.14` (after `brew upgrade expat`) so pyexpat re-links against Homebrew's libexpat.
- Pin Homebrew Python to 3.13 (`brew install python@3.13`) on Kepler until 3.14's libexpat shim is stable.
- Switch repo-level scripts that need `plistlib` to `/usr/bin/python3` (macOS system Python).

**Status:** Open. Tools that touched plistlib (`demo-cell-up`) now use heredoc + shell escaping, which is acceptable but increases future maintenance surface. When a Spinner or tool genuinely needs `plistlib`, fix the Homebrew Python first.

### 2. `tools/demo-cell-up` initially tried port 3001, conflicted with `com.webspinner.uptime-kuma`

Uptime Kuma is bound to `127.0.0.1:3001` on Kepler. My initial draft of `tools/demo-cell-up` picked 3001 without checking the listening ports. The demo Loom crashed with `EADDRINUSE` on bind; the launchctl `bootstrap` returned 0 anyway (launchd doesn't report post-start crashes); the smoke check probed `/` and got 200 from **Uptime Kuma**, not our Loom. Real bug: the smoke check didn't verify it was talking to the Loom.

**Fix applied:** moved demo Loom to `:3010`; added Loom-identity probes to the smoke (`/admin → 303` + POST `/login` → 200/400/401; a squatter without those routes fails the check loudly). Reflected in `DEMO-RUNTIME-PLAN.md`.

**Engineering lesson:** any "is the service up" smoke check needs to verify it's the **right** service, not just "something is listening." Future provisioners should probe a service-identifying endpoint, not the generic root.

**Status:** Resolved. Convention recorded: demo-class Loom services live in the `30xx` range starting from `:3010`.

### 3. `launchctl bootstrap` silently succeeds when the program crashes after start

Related to #2. `launchctl bootstrap gui/<uid> <plist>` returned exit 0 even though the Loom process immediately crashed with `EADDRINUSE`. The plist was loaded; launchd's first `RunAtLoad` start failed; `KeepAlive` then kept retrying in the background but the script had already moved on.

**Mitigation in `tools/demo-cell-up`:** the post-bootstrap wait loop now polls a Loom-identifying endpoint with a 15-second timeout. If the Loom isn't truly up, the wait fails loudly with a pointer to the err log.

**Future:** every Foundation platform-engineering script that bootstraps a launchd service should follow this pattern — bootstrap, then poll a service-identifying endpoint with a bounded timeout, fail loudly otherwise.

**Status:** Resolved for `demo-cell-up`. Convention to spread to other Foundation provisioners (`tools/deploy-loom`, the tenant `deploy-from-admin.sh` scripts).

## 2026-05-16 — Demo Cell session retention + opt-in 30-day save

**Question:** The Demo Cell at `try.webspinner.ai` is open to anyone; by default a patron's session is ephemeral and purgeable. But patrons may want to come back to their work — the Database Application schema they've drafted, the bookkeeping they've started building. The Wizard's directive: allow opt-in 30-day retention, gated by patron-provided + verified email. Resend.com is already wired for verification mail.

**Why it matters:** Three things have to hold together:

1. **Anything persisted on behalf of a session can be purged when no longer active.** Today's `wp_spinner_sessions` row plus any future `wp_database_applications` row plus the patron-app's generated PB collections must all be deletable in one operation. Sweep tooling is part of the architecture, not an afterthought.
2. **30-day opt-in retention.** The patron's session row gains a `retained_until: datetime` field; the sweep skips rows where `retained_until > now()`. When the patron opts in, the field is set to `now() + 30 days`. They can extend it by returning + re-opting-in.
3. **Email verification gate.** The opt-in flow: patron clicks "save my work" → enters email → Resend.com sends a verification link → patron clicks → the session's `retained_until` is set + the email is bound to the session (so the patron can return via the email's link).

**What it implies for the architecture:**

- `wp_spinner_sessions` gains `retained_until: datetime?`, `verified_email: text?`, `email_verify_token: text?`, `email_verified_at: datetime?`.
- A `tools/demo-sweep` cron-style script that runs (probably daily): deletes every `wp_spinner_sessions` row where `status != 'active'` AND (`retained_until IS NULL OR retained_until < now()`). Cascades to: any `wp_database_applications` row scoped to the session id; any PB collections the `build` capability created for the session; any audit events scoped to demo sessions older than 30 days (or: audit events stay forever; sweep is for spinner-session-scoped data only).
- An opt-in UX in the patron's chat: a follow-up bubble at session-end ("save your work for 30 days?") with an email input. POST to `/api/session/save-request` triggers the Resend mail.
- A verify route at `try.webspinner.ai/save/<token>` that flips the session's retention flag.
- A cancel route so the patron can revoke (in the verification email + on any subsequent return).

**Privacy posture:** the verified email is **only** for save-link delivery + return access. Per the Foundation Pledge, no marketing, no behavioural targeting, no third-party sharing. The email lives in `wp_spinner_sessions.verified_email` in the demo PB and is deleted along with the session when retention expires or the patron revokes.

**Status:** Open. **Not blocking** R0–R4 of `DEMO-RUNTIME-PLAN.md`; lands as R5 once the propose/refine/build loop is validated end-to-end. The DEMO-RUNTIME-PLAN.md gains an R5 entry pointing here.

**Trigger to land:** as soon as the first patron asks to come back to their work. Until then, ephemeral default with a one-line sweep script is sufficient.

## 2026-05-16 — Database Application runtime — v0 limits + tech debt

Logged so they don't fall through. Each is real but not blocking the next test; the Wizard will provide feedback after the bookkeeping + non-bookkeeping generality tests close.

### Edit / delete affordances on patron's records

v0 lets the patron add records but not edit or delete from the table. The Loom routes only expose GET (list) + POST (create). PATCH + DELETE land when a Spinner or the renderer needs them — probably alongside R9 (retention) since the same flow gates "I want to keep this; let me clean it up first."

### Schema-link rendering as searchable picker

Schema entities can declare `links: [{to: <entity>, describes: ...}]`. The current renderer shows links as a description note on the entity card and ignores them in the form (text input). Future: render link fields as a select/typeahead that searches the linked entity's collection so the patron picks a real row, and store the resulting PB record-id as a relation field instead of free text. Needs the `createEntityCollection` helper to support PB `relation` fields with `collectionId` references.

### Sweep policy for `wp_database_applications` rows + their per-entity collections

When R9 (retention) lands, the sweep job needs to know that wiping a session-scoped `wp_spinner_sessions` row also requires:

1. Dropping the `wp_database_applications` row for that session.
2. Dropping each `app_<appId>_<entitySlug>` PB collection.

`tools/demo-reset` already wipes everything by dropping the demo `pb_data` — fine for v0. A per-session cleanup (for the future retention-expiry sweep) needs to honour the cascade.

### Multiple refines have no cap; no token budget enforcement

The patron can answer clarifications → refine → answer more → refine → … with no upper bound. Each refine is one Quiet Loom call (~5-20s, ~1k tokens out). For a curious / adversarial patron, this is unbounded compute on Kepler. R9's rate-limit hooks need to grow a per-session refine cap (e.g., 8 turns) before opening the demo to untrusted public traffic.

### `weaver.ts` is ~3,200 lines and growing

Genesis-Spinner dispatchers stack inside one file: bootstrap, pablo, journal, genesis, database-application. Each is ~400-700 lines. As more Spinners land in the demo (the next archetypes — iPhone App, Website, Simple Game, Custom AI Spinner) this file gets unwieldy. A refactor extracts each dispatcher to its own module (`weaver-database-application.ts`, etc.) and the main `weaver.ts` becomes a routing shell. Defer until at least one more Spinner ships its dispatcher.

### Foundation imagery for field kinds

Field-kind chips in the schema cards are manuscript-text placeholders (`DATE`, `$`, `#`, `Y·N`, `TXT`). The Wizard plans to generate Foundation-disciplined imagery via OpenAI Image 2 (per DECISIONS 2026-05-12 — _Canonical cinematic-illustration generator_). When the imagery lands at `~/webspinner-try/site/brand/kinds/<kind>.svg` (or .png), swap the `kindMark()` function in `site/app.js` from text to `<img>` — one switch statement, ten lines. Same path for the entity-card hero if the Foundation wants illustrated entity types ("Transaction" / "Plant" / "Donor" etc.).

## 2026-05-17 — Pablo's review-mission-lock capability (drift defence)

**Question:** The 2026-05-17 review revealed that the prior Claude session authored the Database Application Spinner's mission-lock with a "first, do no harm" posture that ran counter to VISION.md's _"exceeds what they imagined"_ + _"delights and astounds"_ discipline. The fix landed via mission-lock rewrite (see `DECISIONS.md` 2026-05-17 — _Mission-lock posture: generous expertise + patron prunes_). But this drift was caught by **manual Wizard review** after the demo was already live. The structural question: how do we catch this class of drift _before_ sign + install?

**Why it matters:** Mission-locks are LLM-authored or LLM-influenced artifacts. They can drift toward conservative defaults that feel safe but undercut the Foundation's flagship promise. Per Operating Principle §17.3 (Production-Candidate Quality Only), every Spinner shipped should pass the canon's flagship test. Manual review caught it once; the next drift may not be caught until a patron experiences disappointment.

**Proposed mechanism:** Extend Pablo with a `review-mission-lock` capability (parallel to the existing `review` for UI). Inputs: the Spinner bundle's `mission-lock.md` text + the canon's flagship rubric (`VISION.md`'s three operative requirements + `WARP-CANON.md` §17.5 _Wow as Baseline_). Outputs: severity-tagged findings, same shape as Pablo's UI reviews. The build pipeline (sign + install) gates on Pablo's mission-lock verdict — `fails` blocks the install; `concerns` warns but lets through; `passes` proceeds.

**What this catches:**

- Minimal-viable-output postures ("don't over-design", "honor exactly what they said").
- Cautious-LLM phrasings that under-promise.
- Refused-work sections that creep too broad (refuse things the canon doesn't refuse).
- Vocabulary drift (calling SI "AI", Cell "tenant", etc.).
- Voice drift (technical jargon, not patron-facing words).

**Status:** Open. Lands as part of the next Pablo iteration. Until then, manual review by the Wizard at each Spinner ship is the defence.

**Related:** The Schema Critic Spinner concept (`SI-QUALITY-DESIGN.md` — improvement #3) is the runtime analog of this — review the SI's _output_ against a rubric, not the SI's _instructions_. Both are needed.
