# DECISIONS.md

Append-only log of architectural and process decisions for the Warp repo. Each entry is dated. Once written, do not rewrite — supersede with a new entry that references the prior one.

Format:

    ## YYYY-MM-DD — Short title
    **Decision:** What was decided.
    **Why:** The reason, in a sentence or two.
    **Supersedes:** (optional) prior decision title and date this replaces.

---

## 2026-05-10 — License: Apache 2.0 with trademark held by the Foundation

**Decision:** The Warp repository is licensed under the Apache License 2.0. The names *Warp* and *Webspinner* are trademarks of the Webspinner Foundation, held separately from the code license per Apache 2.0 §6. See `TRADEMARK.md`.
**Why:** The book (manuscript ch. 16, ch. 25) prescribes Apache 2.0 for Foundation reference work. The trademark separation is the lever the Foundation Pledge depends on (ch. 26 §6).

## 2026-05-10 — Contribution model: DCO sign-off

**Decision:** Contributions require Developer Certificate of Origin sign-off (`Signed-off-by:` line on every commit). No CLA at this stage.
**Why:** Lower friction; consistent with the small-organization posture in manuscript ch. 25. A CLA may be added later if Foundation operations require it.

## 2026-05-10 — Glass-house development

**Decision:** All Warp development happens in the public repo from the start. Initial development concerns about third-party visibility are explicitly waived.
**Why:** Direct user instruction. Aligns with the Foundation's transparency posture; sovereignty for the architecture's eventual users is the constraint, not for the Foundation's own development process.

## 2026-05-10 — Hardware roles

**Decision:**
- **Hetzner Hillsboro** (GPU server, to be provisioned per `WEAVER-SETUP.md`): primary Weaver Cell. Always-on. Authoritative.
- **Kepler Studio**: local-network performance tier. Smaller warm MLX model, Grimoire mirror. Federates to Hetzner; not authoritative.
- **Spindle (M5 Max MacBook Pro)**: the Loom. Authoring surface. Federates to Kepler at home, Hetzner elsewhere.
**Why:** Hetzner uptime and GPU capability beat what the home network and Apple Silicon can give for an always-on policy governor. Glass-house posture removes the data-residency objection. Kepler stays useful as a low-latency tier when on the home network. Spindle remains the working surface.

## 2026-05-10 — Default stack

**Decision:**
- Python 3.12 + FastAPI for the Weaver service
- LiteLLM as the BYOK gateway shim (replaceable later)
- vLLM for local-model serving on Hetzner GPU
- Qdrant for vector storage (single binary, on-box)
- Postgres 16 for session state and audit log
- BGE-M3 for embeddings; BGE-reranker-v2-Gemma (or comparable open-weight) for reranking
- MCP SDK in Python for Claude Code integration
**Why:** Each component is mature, open, and integrates cleanly with the others. The shims (LiteLLM especially) are explicitly replaceable in a later phase with Webspinner-built equivalents that adhere to the WRAG and Capability Bus specifications.

## 2026-05-10 — Tapestry retired as cross-repo source of truth

**Decision:** The previous `~/webspinner/tapestry` document is no longer the cross-repo authoritative spec for Warp. The *AI Enclosure* manuscript (`~/ai-enclosure/`) is the canonical text, distilled in this repo's `WARP-CANON.md`, and indexed in the Grimoire when the Weaver is live.
**Why:** Direct user instruction. The manuscript is now complete and is a more comprehensive, more disciplined, and more publicly defensible source of truth than the working tapestry it grew from.

## 2026-05-10 — The Weaver as Claude Code's exteriorized working memory

**Decision:** The Weaver's role extends beyond policy enforcement and BYOK routing. It also serves as the persistent session-state store and task-specific context provider for Claude Code sessions across all Webspinner repos. A `session_resume(cwd, task_hint)` MCP tool returns a tight context bundle so sessions do not bootstrap from accumulated CLAUDE.md files every time.
**Why:** Two months of working with bloated, auto-loaded CLAUDE.md files have shown them to slow Claude and produce mixed boot behavior. The Memex pattern from manuscript ch. 12, applied to the development process itself, is the right structural answer.

## 2026-05-10 — Mission-locked Weaver system prompt

**Decision:** The Weaver injects a mission-locked system prompt in front of every LLM call it routes. The prompt declares the Foundation Pledge as operative law, asserts the strict vocabulary and voice constraints, and directs the model to advance the Warp architecture rather than serve as a general assistant.
**Why:** The Weaver is not a general-purpose tool. The Pledge cannot be optional. Encoding the mission at the system-prompt layer makes alignment structural rather than aspirational.

## 2026-05-10 — Bootstrap topology: Loom on Kepler, no public Cloudflare exposure

**Decision:** Until peer Webspinner Cells arrive in summer 2026, the Wizard's Cell runs entirely on local infrastructure. The production Loom, the bootstrap Weaver, and the bootstrap Grimoire all live on Kepler (always-on Mac Studio). Spindle is a Loom-development client of Kepler. No Cloudflare Tunnel and no public hostname expose any Cell surface to the open internet during the bootstrap. Spindle reaches Kepler over LAN at home and over Tailscale when away.
**Why:** A Cloudflare Tunnel pointing at a laptop is the wrong shape (laptops sleep, move, change networks; the surface is not server-class). The Loom is the attack-surface boundary by §3 and is meant to be local. Other Webspinners do not need to walk the Wizard's Loom — they reach the Cell via the Capability Bus when federation is real. Until then, the safest exposure is no exposure.

## 2026-05-10 — Hetzner provisioning deferred until federation

**Decision:** Provisioning of a Hetzner CPU dedicated server as the public-facing Weaver host is deferred until the first peer Webspinner Cell needs to find this Cell. The existing Hetzner box `sn-backend-01` (CPX21, Hillsboro, deployed 2026-05-08 for the prior si-native effort) was deleted on 2026-05-10. The Hardware Roles decision below (this file, prior 2026-05-10 entry) is amended in part: Kepler is the always-on Weaver during bootstrap; Hetzner is the always-on Weaver when peers arrive.
**Why:** During bootstrap there is one Cell. The Pledge §11.1 forbids any centralized facility through which substantial user populations are routed; today there are no peers to route. Standing up a Hetzner box now spends ~$14/mo for capacity that is not exercised. Hetzner is the right shape *when* federation is real. Migration is clean: Postgres `pg_dump` / Qdrant snapshot / SvelteKit container redeploy / Cell identity keys are portable; only a Foundation-controlled DNS name needs to be pinned from day one to repoint at migration time.
**Supersedes:** "2026-05-10 — Hardware roles" in part — Hetzner Hillsboro role description amended; Kepler and Spindle roles unchanged.

## 2026-05-10 — Tailscale for the Wizard's personal device mesh; not for federation

**Decision:** Tailscale (over WireGuard) is the chosen VPN for connecting Spindle to Kepler when Spindle is off the home network. This decision applies *only* to the Wizard's own device mesh. Cell-to-Cell federation does not use Tailscale; it uses the Capability Bus over public TLS/QUIC with end-to-end signed invocations.
**Why:** Tailscale's coordination plane sees node public keys and node names but not traffic content. For one operator's two devices, this is an acceptable trade. For Cell federation, the Pledge §11.1 and the open question on transport (`OPEN_QUESTIONS.md` *How does Hetzner Hillsboro federate cleanly with Spindle and Kepler over a residential NAT?*) require no third-party coordinator in the federation path. The two cases have different threat models and different acceptable mediators.

## 2026-05-10 — SI-Native lifted into Warp; brand retired

**Decision:** The work in `~/si-native/` (TypeScript pnpm monorepo, dated 2026-05-08) is lifted into `~/warp/` rather than continuing as a parallel project. Specifically: `packages/agent-sdk` (with vocabulary pass to Warp canon), `packages/admin-ui` (the Loom; SvelteKit adapter switched from Cloudflare to Node for Kepler-local serving), the PocketBase docker-compose (re-targeted to Kepler), and the principles in `docs/PRINCIPLES.md` §1–§2 (promoted to `WARP-CANON.md` §17). The "SI-Native" brand is retired. The `si-native.com` domain stays registered; its routing was dismantled on 2026-05-10 (`admin.si-native.com` Pages project + DNS removed; `data.si-native.com` DNS removed; `sn-data-tunnel` deleted; Hetzner `sn-backend-01` deleted).
**Why:** SI-Native predated the manuscript discipline and framed itself as a multi-tenant SaaS-replacement platform — at odds with the Pledge §11.1 and the strict vocabulary §2 (operator/tenant vs. Cell). The code itself is production-candidate quality (the agent-sdk types are well-designed; the Loom shell has green Playwright e2e on chromium and webkit). Lifting preserves the work and reconciles the framing. Starting over would be wasteful; continuing as-is would be drift.

## 2026-05-10 — PocketBase as the bootstrap Grimoire

**Decision:** PocketBase (single 20 MB Go binary; SQLite-backed; admin UI; auth + storage) serves as the Cell's Grimoire during bootstrap. Migration to the canonical Postgres + Qdrant stack is scheduled for when the WRAG seven-stage pipeline is implemented (`OPEN_QUESTIONS.md` *WRAG protocol — formal pipeline spec* must land first).
**Why:** Postgres + Qdrant is right eventually but expensive in moving parts today. PocketBase is one binary, has a working schema for the lifted vault, and is already targeted by the lifted code. The Phase-1 vault wire format (AES-GCM ciphertext blobs) is forward-compatible with the Phase-2 passphrase + Argon2id + HKDF design and the eventual Postgres schema; the migration cost is bounded.
**Supersedes:** "2026-05-10 — Default stack" in part — Grimoire data layer amended for the bootstrap; canonical eventual stack unchanged.

## 2026-05-10 — Claude Code's narrowed role: agent factory, not implementer

**Decision:** In Warp repositories and any Webspinner repository that adopts the canon, Claude Code's role is constrained to writing agent definitions. Agents run from the Warp UX (the Admin Utility / Loom) and execute under the Weaver. Claude Code does not implement Warp by reaching for Edit and Bash to "just do" work that should be an agent's job. The bootstrap exception applies until the Weaver and the first agents exist; the bootstrap shrinks every session. The binding mechanism is `MISSION-LOCK.md` (canon §18).
**Why:** Two months of using Claude Code as a one-off action engine produced technical debt at the same rate it produced value. *Webspinner builds Webspinner* is the discipline that closes the loop: Claude Code creates the agents, the agents create the artifacts, the architecture extends rather than accretes.

## 2026-05-10 — Operating Principles promoted to canon

**Decision:** "Admin-First" and "No Secrets via Claude Code" are promoted from `~/si-native/docs/PRINCIPLES.md` §1–§2 to `WARP-CANON.md` §17 as operative law for the Wizard's Cell. "Production-Candidate Quality Only" is added as a third principle in the same section, capturing the discipline declared in conversation 2026-05-10.
**Why:** The two si-native principles described real load-bearing operational hygiene that the Warp canon was missing. Promoting them puts them in the same authority class as the Pledge §11 and the Covenant §12 for daily operation. The third principle was implicit and is now explicit.

## 2026-05-10 — Spinners replace agents in canonical vocabulary

**Decision:** The runnable computational units of Warp are **Spinners**. The act of authoring is **Spinner Weaving**. Compositions are **Warp Threads**. The Loom's catalogue of Spinners is the **Spinner Catalog**. The vocabulary replaces "agent," "workflow," and "registry" everywhere in the canon, the SDK, the Loom, and Spinner manifests. Audit event types renamed: `wp.agent.*` → `wp.spinner.*`. SDK identifiers renamed: `AgentName` → `SpinnerName`, `AgentManifest` → `SpinnerManifest`, etc. Loom routes renamed: `/admin/agents` → `/admin/spinners`, `/admin/registry` → `/admin/catalog`; `/admin/threads` added. Canon §19 added.
**Why:** "Agent" is generic AI-industry vocabulary that imports unwanted connotations (alignment, guardrails, agentic-AI marketing). Spinner is canon-aligned with Loom/Weaver/Grimoire/Webspinner — the metaphor stays consistent. Warp Thread names workflows in the same metaphoric register and prevents drift toward generic "workflow engine" framing.

## 2026-05-10 — Spinner integrity: digest, signature, gating

**Decision:** Every Spinner has a content-addressable digest of its canonical bundle (manifest + documentation + entrypoint module bytes) in `<algorithm>:<hex>` form (`sha256` today; algorithmically-agile). Spinners are signed by their publishers — Foundation release keys for first-party Spinners; Cell identity keys for Cell-published Spinners — using `ed25519` today. The Weaver re-computes the digest and re-verifies signatures on every load. Failures are explicit, audit-logged, and gating per `WARP-CANON.md` §19.2:
- `digest-mismatch` → load gated; `wp.spinner.integrity.fail` with `action: 'gated'`.
- `signature-invalid`, `unknown-signer` → load gated.
- `unsigned` → warned, not gated; Wizard's policy decides.
- `pending-install` → observed digest reported; no install record yet.
**Why:** Spinners are loaded into a privileged execution context with vault access. Tampering is the most consequential failure mode; treating it structurally (gate before run) rather than as a soft check is the only viable posture. The discipline is borrowed from container-image practice.

## 2026-05-10 — Spinners run only through the Weaver

**Decision:** Spinner entrypoints are loaded by the Weaver and exposed only through the Weaver's capability invocation surface. The reference implementations refuse to expose them via any other path — no scripts, no network endpoints, no direct imports outside the Weaver process. Any invocation path that bypasses the Weaver is a structural violation regardless of the Spinner's declared capabilities, and is detectable by the canonical-bundle scanner (open work).
**Why:** The Weaver is the policy-enforcement boundary (`WARP-CANON.md` §3). It mediates vault resolution, sensitivity-aware routing, BYOK gateway selection, audit-log emission, and grounding verification. A Spinner running outside the Weaver bypasses all of these. The boundary is structural — not a deployment convention.

## 2026-05-10 — Webspinner UX is operative, not polish

**Decision:** The UX is the architecture. Every Spinner ships a *How It Works* document the Loom renders. Every capability has a `displayName` and a plain-language description. Every invocation narrates what is happening, audited and reviewable. A Spinner whose documentation is missing or whose capability descriptions are placeholder text fails the production-candidate bar (Operating Principle §17.3) and does not register.
**Why:** The Webspinner is not a CLI user. The Wizard, and every Webspinner who joins, learns the architecture by using it. Transparency is the thing being built — opaque Spinners erode the Right to Inspect (`WARP-CANON.md` §9.2).

## 2026-05-10 — Bootstrap Spinner shipped as production-reusable

**Decision:** The Bootstrap Spinner (`~/warp/spinners/bootstrap/`) is the first Spinner of the Webspinner Foundation Cell and the production-reusable pattern for every Spinner that follows. It ships as a complete bundle: `manifest.json` (canonical), `mission-lock.md` (the Spinner's operative system prompt), `how-it-works.md` (rendered in the Loom), `README.md`, `src/index.ts` (entrypoint contract). Its four capabilities — `consult`, `audit`, `record`, `surface` — are the smallest set that exercises the architecture: capability-scoped invocation, BYOK key resolution, Spool grounding, audit emission, Weaver-mediated execution.
**Why:** Defining the first Spinner in production-candidate form sets the bar for every subsequent Spinner.

## 2026-05-10 — Skein, Spools, Silk Patterns named in canon

**Decision:** Three more terms enter the canonical vocabulary alongside Spinner / Spinner Weaving / Warp Thread:
- **Skein** — the discoverable catalogue of Spinners (replaces "Catalog"); Loom route `/admin/skein`.
- **Spool** — a registered data source a Spinner reads from at invocation. The canon is a Spool. The manuscript is a Spool. The audit log will be a Spool. The vault is *not* a Spool. SDK type `SpoolManifest`; Loom route `/admin/spools`.
- **Silk Pattern** — a Spinner's persistent memory: invocation history plus metrics, surfaced as a placard on the Spinner's detail page. SDK types `SilkPatternEntry` / `SilkPatternMetrics` / `SilkPattern`; PocketBase collection `wp_silk_pattern`.
Canon §19 expanded. The vocabulary is the architecture; substitute terms (catalog, data source, memory) drag in connotations the canon does not carry.
**Why:** Direct operator instruction. The Webspinner UX is everything; vernacular consistency removes cognitive translation between technical terms and the Webspinner's understanding.

## 2026-05-10 — Bootstrap Weaver runs inside the Loom (one-time exception)

**Decision:** The Weaver pipeline that resolves vault references, reads Spools, calls Anthropic with the mission lock, records audit, and appends Silk Pattern entries is implemented in the Loom's Node server (`~/warp/loom/src/lib/server/weaver.ts`) as a temporary in-Loom shim. This is the explicit one-time God-of-the-bootstrap exception — Claude Code's last large act of platform engineering before the Webspinner takes over via the Loom. The canonical Weaver is Python + FastAPI per `DECISIONS.md` *Default stack*; when it lands, the in-Loom shim is removed and the Loom's invocation endpoint forwards to the canonical Weaver.
**Why:** Without an invocation runtime, the Bootstrap Spinner is documentation; the Webspinner cannot use the Loom to drive subsequent work. Standing up the canonical Python+FastAPI Weaver as a separate service was the larger move; the in-Loom shim ships the same contract (vault → Spool → mission-lock + Anthropic → audit + Silk Pattern) in less mechanism. The migration path is bounded — the Spinner contract does not change.

## 2026-05-10 — Bootstrap Weaver dispatch is hardcoded; canonical path is dynamic-import

**Decision:** The bootstrap Weaver hardcodes the dispatch from Spinner name + capability to its handler implementation. Today it knows one Spinner — the Bootstrap Spinner — and dispatches `consult` to an in-Weaver handler; the other capabilities (`audit`, `record`, `surface`) return `pending` with a clear message. The canonical path, when it lands, is dynamic-import of the Spinner's compiled entrypoint (`<spinner>/dist/index.js`) — the Spinner's `invoke(capability, input, context)` function executes the capability logic with the Weaver providing the context (vault, Spool reads, model call, audit emission). The canonical path is open work (`OPEN_QUESTIONS.md` — *Bootstrap Spinner runtime — migration to the canonical Weaver*).
**Why:** Hardcoded dispatch is faster to ship and acceptable when there is one Spinner. Dynamic-import is the canonical pattern for the steady-state where many Spinners run; pretending to support it before there is more than one Spinner is premature abstraction.

## 2026-05-10 — Observable, resilient Spinner state (Pull, not Push)

**Decision:** Spinner state — invocation status, progress, partial outputs, Silk Pattern entries — is persisted in the Grimoire and read by the Loom via polling. The Loom never relies on a Spinner pushing state to the UI; a dead Spinner cannot push, and the UX must tolerate Spinner death gracefully. Long-running invocations write progress entries to a Grimoire collection (`wp_invocation_state`, schema TBD); the Loom polls that collection on a fixed interval and renders progress. When a Spinner crashes mid-invocation, the last persisted progress entry is what the Loom shows, accompanied by a clear "Spinner died at step N" indication and any recovery affordances the Spinner declared. State queries must be fast (indexed by invocation id, time-ordered) — the Loom's polling cadence is sub-second by default.
**Why:** Direct operator instruction. Push-only progress is fragile against the realities of long-running model calls, network hiccups, and process death. Pull-based state is the same pattern Kubernetes, Temporal, and other production workflow systems converged on after experience with push-based fragility. The principle is now §17.4.

## 2026-05-10 — Wow as Baseline

**Decision:** Every UX surface produced under the Warp canon — the Loom, transactional emails, public marketing pages, registry listings, Spinner placards, error states, empty states — meets a "Wow" baseline of animation, illustration, typography, and polish. The baseline is non-negotiable; "we'll make it pretty later" is a technical-debt anti-pattern the canon forbids. New canon principle §17.5.
**Why:** Direct operator instruction. The Webspinner is not a CLI user; the vernacular is the Wizard's, not the technologist's. A Webspinner who is awed by the Loom learns the architecture by using it. A Webspinner who has to forgive a clunky surface learns to mistrust it. The Right to Inspect (§9.2) depends on a UX that earns inspection.

## 2026-05-10 — Genesis Spinner: encoding the founding bootstrap

**Decision:** The platform-engineering work Claude Code performed by hand on 2026-05-10 to bring up the founding Cell on Kepler — install Node + pnpm + PocketBase via Homebrew, rsync the warp repo from Spindle to Kepler, run `pnpm install` and `pnpm -r build`, generate `~/.warp/bootstrap/{vault-master-key,pb-email,pb-password}`, set up the Grimoire data directory — is preserved as the Genesis Spinner (`~/warp/spinners/genesis/`). Eight capabilities declared (`provisionToolchain`, `syncRepo`, `buildWorkspace`, `generateBootstrapState`, `deployGrimoire`, `seedVault`, `deployLoom`, `verifyCell`); handlers are open work. Once implemented, the Genesis Spinner runs from any existing Loom to provision a peer Cell, or from a tiny CLI bootstrapper for the very first Cell where no Loom yet exists. The God-once exception (this file, *Bootstrap Weaver runs inside the Loom*) does not repeat — every subsequent Cell is Spinner-provisioned.
**Why:** Direct operator instruction: "all of the stuff God just did will have to be enabled on a Spinner later. Persist the work." The recipe is now encoded in the Genesis Spinner's `how-it-works.md`; the handlers land as their own focused build.

## 2026-05-10 — UX takes priority — Genesis handlers deferred

**Decision:** Today's work pivots from platform-engineering implementation to Loom UX polish, per direct operator instruction ("we need to move on to our UX today"). The Genesis Spinner manifest and documentation persist what Claude Code did at the founding; the handler implementations and the launchd LaunchAgent files for Grimoire and Loom are deferred to a focused next-turn build. Open work in `OPEN_QUESTIONS.md` — *Genesis Spinner — handler implementation*.
**Why:** The Wow-as-Baseline principle (§17.5) is operative; the Loom's first impression governs whether the Webspinner trusts the architecture they are about to use. Polishing the surface today is higher-leverage than completing the genesis automation while the Loom still wears its dev-tool aesthetic.

## 2026-05-10 — Canonical Wizard auth: users collection, register + login

**Decision:** The canonical Wizard authentication path is the PocketBase `users` auth collection (`createRule = ""` allows public registration). The Loom now ships:
- `/register` — branded form with name/email/password/password-confirm, honeypot field, server-side rate limit (5 attempts / 60 s / IP), 12-char password floor.
- `/login` — tries `users` first, falls back to `_superusers` only on credential failure (bootstrap-recovery surface, never default).
- Auth gate (`/admin/+layout.server.ts`) refreshes against the right collection per the session cookie's prefix (`users::<token>` vs `_superusers::<token>`).
- Loom-server-identity pattern for backend PB ops: `loomPbToken()` authenticates as the env-var superuser internally; user sessions are auth-gates only, never the PB credential for backend calls (vault, audit, silk pattern).

The full register → login → /admin → invoke flow was validated end-to-end on Kepler with an integration test — including the Bootstrap Spinner's `consult` capability returning the canon §11.1 text grounded through the Quiet Loom (no Anthropic, all loopback).
**Why:** Direct operator instruction: "create the proper production candidate" for auth; the bootstrap-superuser-paste-the-password flow is fragile UX. Patterns lifted from `~/websites/webspinner-forms/` (Resend + Turnstile + verify-token) and `~/websites/cognitivecontent.net/` (register modal shape).

## 2026-05-10 — Adapter-Node CSRF: ORIGIN/PROTOCOL_HEADER/HOST_HEADER set explicitly

**Decision:** The Loom's launchd LaunchAgent sets `ORIGIN=http://johns-mac-studio.local:3000` (the canonical mDNS URL the Wizard reaches), plus `PROTOCOL_HEADER=x-forwarded-proto` and `HOST_HEADER=x-forwarded-host`. SvelteKit's CSRF check compares `Origin` to `request.url.origin`; pinning `ORIGIN` makes the check deterministic regardless of which network interface the request came in on.
**Why:** End-to-end testing surfaced 403 *Cross-site POST form submissions are forbidden* on every form post when `ORIGIN` was unset. Empirical fix. Eventual Tailscale + public-DNS migration adjusts this single env var.

## 2026-05-10 — Email verification + Turnstile server-side: deferred until secrets are vaulted

**Decision:** Today's register flow ships *without* email-token verification and *without* server-side Turnstile verify. Bot defense relies on the honeypot `website` field plus per-IP rate limiting (5/min). Both Resend (email) and Turnstile (bot challenge) require API keys + secrets that today live as Cloudflare Worker secrets in `~/websites/webspinner-forms/`, not on Spindle in plaintext. Wiring them prematurely without a vault to retrieve from re-opens the credential-management friction explicitly named by the Wizard.

The infrastructure is in place: `users.ts` carries the not-verified error kind; the auth-with-password endpoint already returns the `verified` flag; the auth gate has a hook for refusing unverified sessions. When the Resend + Turnstile secrets land in the vault, a focused turn wires them.
**Why:** Half-baked email-verify (no actual email sent) is worse than no email-verify with honest documentation. Wow-as-Baseline (§17.5) forbids surfaces that *look* finished but aren't.

## 2026-05-10 — Auth state management: validate-before-redirect, cookie-attribute-symmetry

**Decision:** Two coupled bugs caused a Safari "Too many redirects" loop and an attendant 500. Fixed structurally:

1. **`clearSession(cookies, url)`** now requires the request URL and emits the cookie with the *same* `path` / `httpOnly` / `secure` / `sameSite` attributes as `setSession`. The previous one-arg `clearSession({path:'/'})` left SvelteKit to fill in defaults that included `Secure` even on HTTP origins. Safari (spec-compliant) rejects `Set-Cookie: Secure` over HTTP entirely — *including* the Max-Age=0 deletion. The cookie persisted, the loop continued, "Too many redirects" eventually surfaced. Symmetric attributes guarantee the deletion takes.

2. **`/login` load now validates before redirecting.** The previous logic was `if (getSession(cookies)) throw redirect(303, '/admin')` — it trusted cookie *presence*. With a stale cookie, `/admin` couldn't refresh the session, cleared it, and redirected back to `/login`, which redirected to `/admin` again. The new logic refreshes the session against the right PocketBase collection (`users` or `_superusers`); if valid, redirect; if invalid, clear and render the form. No loop is possible.

Same pattern applied to `/admin/+layout.server.ts`, `/verify-pending`, `/verify`, and `/logout` — every clearSession call now passes `url`, every redirect-after-session-presence is validation-gated.

Verified empirically: stale cookie hits land on the form with a clean Set-Cookie clear (no Secure flag), valid cookies one-hop to /admin, garbage cookies cause 0 redirects.
**Why:** Direct operator instruction: "I do not want refresh and cache to cause support requests when we launch." A stale browser cookie hitting `/login` should never be a 500 nor a loop. Validate-before-redirect is the canonical pattern; cookie-attribute-symmetry is the cross-browser-correct way to ensure deletion takes.

## 2026-05-10 — Admin-utility anti-autofill: CSS-masked text inputs, non-standard field names

**Decision:** The Loom's `/login` form does not use `<input type="password">` or `name="password"`. The visible "password" field is `<input type="text" name="passphrase">` with `-webkit-text-security: disc` applied via class (`.passphrase.mask`); the show/hide toggle flips the class, never the input type. The "email" field is `<input type="text" inputmode="email" name="wizard_id">`. Server-side action reads `wizard_id` and `passphrase`; visible labels and `aria-label`s preserve the user-facing and screen-reader semantics. Plus full anti-autofill data-attribute set: `data-1p-ignore`, `data-lpignore`, `data-bwignore`, `data-form-type="other"`, `autocomplete="off"`, `spellcheck="false"`, `autocapitalize="off"`, `autocorrect="off"`.
**Why:** Direct operator instruction: "I told you I do not go in on a path, I go in on the root URL and click the splash screen... I didn't touch a key on the login page" — Safari was popping its Keychain credential offer on focus because it recognised the `<input type="password">` and the saved cred for the domain. The earlier autocomplete-off + decoy approach blocked *pre-fill* but not the *Keychain offer popup*. Removing `type="password"` and `name="password"` removes Safari's heuristic anchor entirely; the form is no longer a sign-in form to the browser, and Keychain doesn't offer. CSS-mask via `-webkit-text-security` is the canonical pattern (Stripe / Cloudflare / AWS console admin sign-ins use it). Matches Operating Principle §17.2 — admin utilities don't want browser-resident credential storage.

## 2026-05-10 — Cache + error hardening (refresh-safe by default)

**Decision:** New `loom/src/hooks.server.ts` and `loom/src/routes/+error.svelte`. Every dynamic HTML / form-action / JSON response carries `Cache-Control: private, no-cache, no-store, must-revalidate` + `Pragma: no-cache` + `Expires: 0`. Immutable hashed assets under `/_app/immutable/` keep their canonical `public, max-age=31536000, immutable`; the Spinner thumbnail keeps its 5-minute cache. Always-on security headers: `referrer-policy: strict-origin-when-cross-origin`, `x-content-type-options: nosniff`, `x-frame-options: DENY`.

`+error.svelte` renders a branded WARP error page for any HTTP status — 404, 401/403, 500+ — with status-appropriate copy and Sign in / Register / Back-to-splash CTAs. `handleError` in hooks.server.ts logs full server-side detail (stack included) to `loom.err.log` and returns a redacted message to the client. Stack traces never reach the browser; the user never sees a bare framework default page.

Verified empirically with curl on Kepler against `/login`, `/admin` (sans session), `/_app/immutable/*.css`, `/admin/spinners/bootstrap/thumbnail`, and `/this-does-not-exist`.
**Why:** Direct operator instruction: "I do not want refresh and cache to cause support requests when we launch." Industry best practice (OWASP cache-control guidance + SvelteKit production deploy recommendations) is `private, no-cache, no-store, must-revalidate` for authenticated / dynamic pages plus `immutable` for hashed assets, plus a branded global error boundary so framework defaults never reach users.

## 2026-05-10 — Pablo wired into retrieval — chunk + embed + top-k

**Decision:** The Bootstrap Spinner's `consult` capability now uses the Kepler-resident Pablo embeddings sidecar (`127.0.0.1:11446`, `sentence-transformers/all-MiniLM-L6-v2`, MPS-accelerated) for grounded retrieval, replacing the prior whole-file Spool dump. New module `loom/src/lib/server/pablo-retrieval.ts`:
- Chunks declared Spools by `##` (H2) headings into 77 sections across `WARP-CANON.md` + `DECISIONS.md` + `OPEN_QUESTIONS.md`.
- Embeds each chunk on first use (lazy-loaded; warm cache for subsequent calls).
- At query time: embeds the question, computes cosine similarity, returns top-8 passages.
- Audit emission carries retrieval metadata: total chunks, returned passages, sources, cache-hit flag, elapsed ms.

Empirical wins validated end-to-end on Kepler:
- **Input tokens per consult: ~4K** (was ~20K with whole-file). 5× reduction.
- **Retrieval time: 190 ms cold, 52 ms warm** — well under the 500 ms first-token budget per `LLM-STRATEGY.md`.
- Answer quality up: top-k returns exactly the relevant canon sections (§3 for "What is a Cell?", §11 for the Pledge), letting the model focus instead of hunt.

What's still open: BGE re-ranker (canon §4 stage 3), grounding verification (stage 6), and persistence of embeddings to PocketBase (today's cache lives in the Loom process; restart re-embeds — sub-second for current corpus size). All in `OPEN_QUESTIONS.md` — *Pablo grounded retrieval — chunk-and-embed pipeline*.
**Why:** The canon-faithful WRAG pipeline (§4) goes end-to-end through Pablo for the embedding stages. The Wizard's question — "are you using Pablo?" — was a real call-out: wired-but-not-used was a violation of the §11 Pledge's spirit, even though Anthropic was already excluded.

## 2026-05-10 — Email verification flow shipped (with Resend-when-vaulted + bootstrap fallback)

**Decision:** Real identity verification ships now (supersedes the prior "deferred" entry above for the verification flow itself; Turnstile server-verify and actual Resend send remain gated on vaulted secrets):
- New PB collection `wp_email_verifications` (token + expires_at + consumed_at, indexed by token).
- New routes: `/register` (creates user, issues token, attempts email send, redirects to /verify-pending), `/verify-pending` (shows email, supports resend, rate-limited 60s), `/verify?token=...` (consumes token, marks user.verified=true), with a clean error state for invalid/expired/consumed tokens.
- Auth gate at `/admin/+layout.server.ts` refuses unverified sessions and redirects to `/verify-pending`.
- New libs: `loom/src/lib/server/email.ts` (Resend client; reads API key from `vault://_self/resend-api-key` first, then `RESEND_API_KEY` env, then returns `unsent-no-credentials`), `loom/src/lib/server/verifications.ts` (token issue / consume / mark-verified, idempotent collection ensure).
- Branded HTML email template per Wow-as-Baseline (§17.5).
- **Bootstrap fallback:** when no Resend key is present, the verification URL is set as a short-lived (1-hour) HttpOnly cookie scoped to `/verify-pending`, where the page renders an inline "Verify directly →" link clearly labeled as bootstrap mode. Vanishes the moment `vault://_self/resend-api-key` is set.

Validated end-to-end on Kepler with an integration test that exercises register → unverified-blocked-from-/admin → verify-pending → click verify → /admin allows → consumed-token-rejection.
**Why:** Direct operator instruction: "If you can't make me verify my identity on registration then registration is not working." Identity verification is canon-table-stakes; deferring it was wrong. The Resend send and Turnstile bot-check verify infrastructure are now wired but operationally inert until secrets land in the vault — the bootstrap fallback keeps the Wizard unblocked on his own first registration without secret-paste friction.

## 2026-05-10 — Capability invocation UX — per-capability forms and results

**Decision:** The Spinner detail page (`/admin/spinners/[name]`) no longer renders a single JSON
input form for every capability. Each capability has its own typed UX:

- `consult` — single "Your question" textarea; result rendered as manuscript-serif prose with citations as chips and a quiet provenance line.
- `record` — labelled Title / Body / Supersedes fields; result is the drafted DECISIONS.md entry in a code block with a Copy button.
- `audit` — Subject field plus Kind radio (file path / inline text); result is a severity-tagged drift list.
- `surface` — no input; result groups threads by kind (uncommitted / open-question / spec-pending / todo).
- `review` (Pablo) — Surface label / Wizard intent / Rendered HTML fields; result is the verdict pill, voice line, and severity-card findings.

A "Developer view" toggle keeps the raw JSON envelope one click away for debugging. Per-capability components are inlined in `/admin/spinners/[name]/+page.svelte` for v0; extraction to `loom/src/lib/admin/capabilities/<Capability>{Form,Result}.svelte` is open work but not blocking.

**Why:** The Wizard's call-out was direct: "Why would a consult be in JSON? Isn't this for a human to fill in?" The capability invocation surface was a developer playground masquerading as an admin surface. The new shape binds form-and-result to capability semantics — a question is a question, a decision is a decision, a critique is a critique.

## 2026-05-10 — Pablo trigger in the admin ribbon (and ⌘⇧P)

**Decision:** Every `/admin/*` surface ships with a "Pablo" trigger in the ribbon
(keyboard shortcut ⌘⇧P / Ctrl⇧P). Click captures `document.documentElement.outerHTML`, POSTs to `/admin/spinners/pablo/invoke` with capability `review`, slides a panel in from the right with verdict pill, voice line, and severity-card findings. ESC closes.

The panel is rendered inline in `admin/+layout.svelte` (no library import; component extraction logged but not blocking).

**Why:** Pablo is only useful if invoking him is friction-free. One click on any admin surface keeps the design-quality bar attached to the work, not to the discipline.

## 2026-05-10 — Dev SSR auth bypass for internal tooling

**Decision:** The admin layout's auth gate honours a `X-Warp-Dev-Token` header on GET-only requests when the value matches the `WARP_DEV_BYPASS_TOKEN` env var (constant-time comparison). The token lives in `~/.warp/bootstrap/dev-bypass-token` on Kepler (mode 600); the Loom plist injects it into the process env. POST / form actions still require a real session.

`tools/pablo <route>` uses this to fetch any admin route and feed the rendered HTML to Pablo via Quiet Loom directly — closes the design-critique loop in 15-30s.

**Why:** The Wizard asked what was slowing review iteration. The honest answer was: every Pablo run required manual cookie creation. A dev-only, GET-only, env-token-gated bypass closes the loop without compromising production auth.

## 2026-05-10 — Quiet Loom default model: Qwen2.5-14B-Instruct-4bit

**Decision:** The Quiet Loom (`com.webspinner.mlx-server.plist`, `127.0.0.1:11445`) defaults to `mlx-community/Qwen2.5-14B-Instruct-4bit`. The 7B model proved too small for nuanced design critique — hallucinated findings in early Pablo runs. The 14B is stable when given a fresh boot; warm-up to first response is ~13s on Kepler.

**Why:** Pablo's quality bar requires a model that can hold the cited library plus a meaningful HTML artifact and return strict JSON. 7B failed that bar; 14B clears it. Stability under prompt-pump load (sustained high-token requests) remains an open question.

## 2026-05-10 — Embeddings sidecar named for what it is

**Decision:** The Loom's embedding pipeline — formerly `pablo-retrieval.ts` / `pabloEmbed` / `WARP_PABLO_URL` / `kepler.pablo` — renamed to `embedding-retrieval.ts` / `embed` / `WARP_EMBEDDINGS_URL` / `kepler.embeddings`. The embeddings sidecar (sentence-transformers/MiniLM-L6-v2) is infrastructure; Pablo is the design-quality Spinner. They were two different things wearing the same name.

**Why:** Vocabulary collision was confusing — when the Wizard said "use Pablo to critique design" the code already had "Pablo" pointing at the embedder. Cleanly disambiguated.

## 2026-05-10 — Pablo's foundation library v0 committed

**Decision:** `spinners/pablo/library/` ships with six entries: `README.md`, `contrast.md`, `typography.md`, `composition.md`, `brand-consistency.md`, `cards.md`. Each entry states the rule, names the source (WCAG / web.dev / NN/g / Stephen Few / Bringhurst / Tufte / M3 / Apple HIG), gives an explicit Pablo check protocol, lists common failures.

Findings cited to a library entry are *appealable* — a Wizard overrides Pablo by writing an `**Override:**` reason that references the same entry. Pablo accepts the override on the next walk.

The Wizard's earlier critiques (e.g. `~/sitoolmaker-com/agents/pablo-critiques/2026-05-06-sitoolmaker-v0.1.md`) cite this library by name; now those citations resolve to files on disk. Library files currently inlined in Pablo's Mission Lock; future revision wires the directory as a `pablo-references` Spool Pablo declares.

**Why:** The Foundation cannot run design quality on an unstated rulebook. The library is the rulebook.

## 2026-05-10 — Bootstrap Spinner — all four capabilities wired (1/4 → 4/4)

**Decision:** `audit`, `record`, `surface` implementations join `consult` in the bootstrap Weaver dispatch. `audit` reads a file (or inline text), retrieves canon ground via the embedding pipeline, and asks the Quiet Loom for drift findings (vocabulary, SI-vs-AI, em-dash preservation, internal-hostname leakage, scope creep, missing citations). `record` is pure formatting — wraps `**Decision:**` / `**Why:**` structure around a title+body, optional `**Supersedes:**`, dated heading. `surface` reads `OPEN_QUESTIONS.md` headings, `WARP-CANON.md` "spec pending" markers, and dated TODOs across `loom/src` / `sdk/src` / `spinners` / `tools`. `uncommitted` kind deferred until shell access lands in Bootstrap's dispatch.
**Why:** Bootstrap is the Foundation's flagship Spinner — the one every new Cell installs. Three capabilities at "pending" was a credibility hole. Now Bootstrap demonstrates the four canonical patterns: consult (read), audit (drift), record (write), surface (introspect).

## 2026-05-10 — Pablo accepts a computed-styles snapshot

**Decision:** The admin Pablo button captures resolved computed styles via `window.getComputedStyle` and sends them alongside the HTML. The Pablo Spinner's Mission Lock learned to treat the snapshot as authoritative for CSS values: cite `color: rgb(160, 134, 88)` from the snapshot rather than guessing `var(--text-secondary)` from the HTML. Contrast ratios compute from the snapshot's resolved `color` / `background_color`. `tools/pablo` (CLI) still sends plain HTML — adding computed-style capture there needs `playwright-core` in the Loom workspace.
**Why:** Pablo's biggest accuracy failure was hallucinating resolved CSS variable values from the source. Adding vision (mlx-vlm + Qwen-VL) is an option but heavy. A computed-styles snapshot solves the specific problem (CSS variable resolution) without the VL stack. Visual judgement findings (composition, F-pattern, scan path) remain `pablos-eye`.

## 2026-05-10 — Genesis v0.2 — syncRepo, buildWorkspace, verifyCell

**Decision:** Three more Genesis handlers ship. `syncRepo` rsyncs from a local path (default `$WARP_REPO_DIR`) or `git clone --depth 1` from a remote URL to a target path (default `~/warp`); excludes `node_modules` / `.svelte-kit` / `dist` / `build` / `playwright-report` / `test-results` / `.git`. `buildWorkspace` runs `pnpm install` then `pnpm -r --if-present build` in the target; per-step results returned with exit code, duration, and tail of stdout / stderr. `verifyCell` probes the Loom root, the admin gate (expecting 303), the Grimoire `/api/health`, and the `vault_secrets` collection existence; uses Node `fetch` directly (no shell needed for HTTP probes). Genesis shellAllowlist extended with `rsync` and `mkdir`.
**Why:** Cell provisioning is the Foundation's most-leveraged Spinner — every peer Wizard who joins in summer runs it. Genesis 4/8 implemented covers the read-only and idempotent operations (probe, place, build, verify). The remaining four (`generateBootstrapState`, `deployGrimoire`, `seedVault`, `deployLoom`) write keys, stand up services, and require careful audit / idempotency design — separate decision.

## 2026-05-10 — Turnstile bot-defense wiring (production + bootstrap modes)

**Decision:** `loom/src/lib/server/turnstile.ts` resolves `turnstile-site-key` and `turnstile-secret-key` from the vault; the register page server loads the site key into `data.turnstileSiteKey` (public-by-design, ok in the browser bundle). The register form embeds `<div class="cf-turnstile" data-sitekey="…" data-theme="dark">` plus the official `challenges.cloudflare.com/turnstile/v0/api.js` script when the site key is present. The register action posts the form's `cf-turnstile-response` to `siteverify` with the secret; verification failure returns `fail(401)`. **Bootstrap mode:** when either key is missing from the vault, `verifyTurnstileToken` returns `{ ok: true, mode: 'bootstrap-skipped' }` and registration proceeds with honeypot + rate-limit defense only. This is how the Wizard's founding registration completes without waiting on credentials in the vault.
**Why:** Production-grade registration needs bot defense beyond honeypot + rate-limit. Cloudflare Turnstile is privacy-respecting, free, and integrates without binding to the Cloudflare network. Bootstrap mode keeps the Cell self-bootable without the Wizard pasting secrets through Claude Code (Operating Principle §17.2).

## 2026-05-12 — Spinner artifact + storage architecture

**Decision:** The Spinner lifecycle storage model is established. Three deliberate tiers:

1. **Design-time (source)** — one git repository per Spinner, hosted under a Foundation-controlled GitHub organization (`github.com/webspinner-spinners/<name>` for recognized; the operator's own GitHub for Cell-published). Repository holds the full bundle: manifest, mission-lock, how-it-works, README, thumbnail, changelog, src + tests, optional library + assets, provenance/<digest>.json + provenance/<digest>.sig, authoring/ subdirectory with initial-sentence + precedent + dialogue.jsonl + review-notes. Authoring artifacts in-repo by default; opt-out via manifest `authoring-private: true` moves dialogue to the Grimoire.

2. **Runtime (Cell-local)** — each Cell has a clone at `~/warp/spinners/<name>/` checked out at a specific signed version. Sovereignty: no runtime dependency on the registry. Integrity-on-load: bytes are present for the Weaver to re-hash. Working tree is also the authoring scratch space during draft.

3. **Registry (the Foundation Skein)** — static JSON index at a Foundation-operated URL (skein.webspinner.org or as a page on webspinner.ai). Updated by GitHub-PR-based ingest. Each entry lists Foundation-recognized Spinners with versions, digests, source-repo URLs, signatures, recognition timestamps, deprecation flags. Static-file design per STANCE.md (build the primitive that scales, not the scaling apparatus); promote to service when search-by-capability or recognition-revocation streaming becomes a regular workflow.

4. **Local Skein (per Cell)** — PocketBase collection `wp_skein` indexes what this Cell has installed. /admin/spinners reads from it; the disk clones are the bytes, the collection is the index.

**The meta-runtime** is named as an architectural concept: the Loom's ability to perform multi-step operations on the Wizard's behalf (authoring, publishing, updating, uninstalling). Operations are typed, audited (each step emits `wp.operation.step`), resumable (state persisted to a new `wp_operations` collection), cancellable (surfaced in /admin/operations), and credential-aware (every external API call uses a vault-stored credential by name; values never logged). Parallel architectural primitive to the Spinner runtime (the Weaver).

**The Loom does everything.** No shell. No git CLI. No credential paste. The Wizard speaks intent through a conversation in the Loom; the Loom searches precedents, runs the dialogue, scaffolds the bundle, runs Pablo + Bootstrap, polishes, creates the GitHub repo, signs, pushes, registers locally, emits audit. The Wizard sees the artifact land in their Skein, ready to run.

**Documentation discipline.** Every Spinner ships with how-it-works.md (patron-facing), mission-lock.md (operative law), README.md, manifest.json (with capability-doc inline), changelog.md. The Loom additionally generates an API reference, example invocations (with real captured outputs from the first successful invocation), and a provenance page. A Spinner without how-it-works or mission-lock fails Weaver manifest validation at install — structural, not a checklist item.

**Credentials in the vault, GitHub PAT for bootstrap, GitHub App for scale.** All external-service credentials are vault entries with declared purpose + scope. The abstraction in code is a `GitHubCredential` interface; PAT today, App later.

**ed25519 signatures via @noble/curves**, detached signatures stored at `provenance/<digest>.sig` alongside the manifest, signer-fingerprint included in filename for disambiguation. Foundation release key + Cell identity keys are the two signers in v1.

**Why:** The Wizard's stated goal — *enable the Loom to do everything without the user* — requires a storage and credential model that makes the Loom the chokepoint for every operation. Mirroring the proven git + registry pattern from npm / cargo / Go modules / Helm gives Webspinner industry-standard rails. The static-file Foundation Skein honors STANCE.md's "build the primitive, not the scaling apparatus." Authoring-in-repo is the explainability default; the opt-out flag preserves the agility for commercial cases.

Persisted in `~/warp/ARTIFACTS-AND-STORAGE.md`. CLAUDE.md boot order references it.

## 2026-05-12 — `Cells` monorepo supersedes per-Spinner-repo polyrepo

**Decision:** All Cell-authored Spinners live in one Foundation-controlled monorepo at `github.com/webspinner-org/Cells` (created 2026-05-12), with one subdirectory per Spinner under `spinners/<slug>/` and per-Spinner SemVer release tags prefixed by the Spinner slug (`<slug>-vMAJOR.MINOR.PATCH` — the Lerna / Nx / Bazel monorepo convention).

This supersedes the choice in the earlier 2026-05-12 entry ("one git repository per Spinner under a Foundation-controlled GitHub organization"). The polyrepo variant remains an option for the future if scale warrants — `git filter-repo` extracts any Spinner subdirectory cleanly into its own repo if needed.

The split between repositories is now:

  - **`webspinner-org/warp`** — the Warp architecture: canon, docs, the Loom app source, the Genesis Spinners (`bootstrap`, `pablo`, `wizards-journal`, `genesis`), the tools, the test harness. These are the architecture's primitives; they ship with the reference implementation.
  - **`webspinner-org/Cells`** — all Cell-authored Spinners. Populated by the Loom's authoring meta-runtime. Private during the bootstrap epoch; opens public when the meta-runtime + the first Cell-authored Spinner clear the production-candidate quality bar.

Cell-local runtime mirror:

  - **`~/warp/spinners/<name>/`** — Genesis Spinners only.
  - **`~/Cells/spinners/<name>/`** — Cell-authored Spinners, checked out at a specific `<slug>-v<version>` tag. Also the live authoring workspace during draft.

The Weaver loads Spinners from both trees; the local Skein (`wp_skein`) records the source-tree path along with the digest + signature.

**Why monorepo over polyrepo for Cells:**

  - One credential boundary, one push remote, one PR-ingest path into the Foundation Skein.
  - Cross-Spinner refactors are one PR, not N coordinated PRs.
  - Per-Spinner SemVer rhythm preserved via tag prefix.
  - Cheap to migrate later — the Spinner directories are self-contained.

**Repos we will need next (not now):**

  - **`webspinner-org/library`** — the corpus of industry-best-practice patterns the authoring conversation queries (accounting patterns, intake-form patterns, e-commerce patterns, donor-tracking patterns, etc.). Critical for precedent-based authoring per `STANDARDS.md`. Today: doesn't exist. Trigger to create: first authoring meta-runtime build, since the precedent search needs a corpus to query.

**Repos we do not need yet:**

  - **`webspinner-org/loom`** — the Loom currently lives in `~/warp/loom/`. Splitting it out is *scaling apparatus*, not primitive. Per `STANCE.md`. Trigger to extract: first peer Wizard adopts a Cell and needs to install the Loom independently of the reference repo. Until then, the Loom rides with `warp`.
  - **`webspinner-org/weaver`** — extract when the canonical Python + FastAPI Weaver work begins. Today the bootstrap Weaver is the shim at `warp/loom/src/lib/server/weaver.ts`; that suffices.
  - **`webspinner-org/skein`** — when the Foundation Skein graduates from a static JSON file behind a Foundation URL to a service. Per `STANCE.md`, not yet.
  - **`webspinner-org/canon`** — the canon currently lives in `warp/`. Extract if the canon's release rhythm diverges from the reference implementation's. Today it doesn't.

Persisted in `~/warp/ARTIFACTS-AND-STORAGE.md` §2.1, §2.2, §5. `Cells` scaffolded with README.md, CLAUDE.md, TRADEMARK.md, CONTRIBUTING.md, .gitignore, SKEIN.json, and `spinners/` directory at commit `webspinner-org/Cells@43586fb`.

## 2026-05-12 — Runner architecture: immutable + ephemeral + encapsulated, off-Kepler

**Decision:** Spinner execution outside the Loom's in-process trusted path happens inside a **runner** — an immutable, ephemeral, encapsulated execution environment. Three load-bearing properties:

  - **Immutable** — the runner image is built once, signed by the Foundation release key, counter-signed by the Cell identity key, and used many times. No state persists in the image between runs.
  - **Ephemeral** — every execution gets a fresh instance, destroyed on completion (success, failure, or cancellation). No warm pool.
  - **Encapsulated** — typed input (Spinner bundle + test plan + secret-refs + execution budget) and typed output (result + audit events + emitted artifacts). The execution surface is invisible to the Loom.

**Three execution backends, pluggable per Spinner's `isolation` manifest declaration:**

  - **Container** (OrbStack on Mac dev; Podman on Linux prod) — ~200 ms cold; ~50 MB overhead; namespaces + cgroups + seccomp. Sufficient for trusted Spinners during bootstrap.
  - **Firecracker microVM** (Apache 2.0; AWS-built; industry standard for ephemeral compute — AWS Lambda, Fly.io) — ~125 ms cold; ~5 MB overhead; full hardware-virt boundary. Production default.
  - **Full Linux VM** (Lima on Mac; KVM on Linux) — ~3–10 s cold; ~512 MB; strongest isolation. For privileged or security-sensitive Spinners.

A Spinner declares `isolation: container | microvm | vm | any` in its manifest. The runner host's policy may upgrade the class (never downgrade).

**Host placement:**

  - **Not Kepler.** Kepler is the Loom + Weaver + Grimoire host; too small to also pool runners and breaks the "Loom-restart-recovers" property.
  - **Spindle (M5 Max)** — bootstrap-epoch runner pool. LAN + Tailscale-reachable. MLX-capable for Quiet Loom evaluations. Container + Lima-VM backends.
  - **Hetzner** — production runner pool when federation begins. Dedicated Linux Firecracker host(s). KVM enabled.

**Network model:**

  - Loom → runner-host dispatch over HTTPS + mTLS, authenticated via Cell-identity-signed certs.
  - Runner instances have **no inbound network access**.
  - Runner instances have **outbound access only to declared endpoints** (the Loom for audit, the BYOK gateway for model calls, declared Spool endpoints). All other outbound traffic refused at the runner-host firewall.

**Default disposition:**

  - First execution of a newly authored Spinner → always in a runner.
  - Any execution of a Spinner whose digest isn't Cell-countersigned → always in a runner.
  - Test-plan execution → always in a runner (clean state per test).
  - Routine invocations of trusted, Cell-signed Spinners → in-process by default; runner per the Spinner's `isolation` manifest declaration.

**Runner-host service** is itself a Spinner (Genesis-tier, `~/warp/spinners/runner/`, forthcoming). Deployed via launchd on Spindle and systemd on Hetzner. Has its own audit chain stitched to the Loom's by operation ID.

**Why:** The Wizard's specification — *runners encapsulated in some way, immutable and ephemeral, on this laptop or on Hetzner, Kepler too small.* Industry-standard pattern (Lambda, Cloudflare Workers, Fly.io machines) for ephemeral compute. Provides untrusted-code isolation, integration-test purity, reproducibility, cost containment, and a clean trust boundary for the federation epoch.

Persisted in `~/warp/RUNNERS.md`. CLAUDE.md boot order step 8 references it. STANDARDS.md open-source-by-layer table updated with the three runner backends.

## 2026-05-12 — OpenAI Image 2 is the canonical cinematic-illustration generator

**Decision:** Cinematic photorealistic illustration in Webspinner Spinners is generated by **OpenAI Image 2**, called through the BYOK gateway (LiteLLM today; Foundation-built gateway later) with the operator's API key stored in the vault at `vault://_self/openai-api-key`. The Foundation will not under-shoot the imagery quality bar because of generator-source ideology.

**Why:** The Wizard's stated position — *I really love the quality they establish when used in a UX properly. We have to get past* the hedging on a closed-source generator. The architecture's BYOK discipline (canon §17.2) already admits closed-source providers behind operator-owned keys; the imagery generator follows the same pattern as text-model BYOK. The quality threshold for "delights and astounds" per `VISION.md` is the load-bearing constraint, not the generator's license.

**Operative pattern:**

  - **Vault-mediated** — every call resolves the operator's OpenAI key at request time; never logged; never passed via Claude Code.
  - **Gateway-mediated** — LiteLLM's `image_generation()` is the contract surface today; replaceable behind the same call shape later.
  - **Pablo-governed** — `~/warp/spinners/pablo/library/imagery.md` (forthcoming) holds the imagery rules: when to use cinematic illustration, prompt patterns that produce brand-aligned results, composition rules against the canonical palette + typography.
  - **Provenance-recorded** — every image generated by a Spinner is recorded in the Silk Pattern with prompt + model + generation timestamp + result digest; C2PA metadata embedded where supported.
  - **Cost-disciplined** — the imagery Spinner reports estimated cost before generation and honors a per-operation budget.

Persisted as a new paragraph in `STANDARDS.md` §1 (the UX standard) and a new row in the open-source-by-layer table.
