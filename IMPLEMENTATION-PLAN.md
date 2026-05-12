# IMPLEMENTATION-PLAN.md — Webspinner creates Webspinner

The methodical path from v0.7.0 (admin Cell + four operator-facing
Spinners) to the operative milestone: **a Wizard uses Webspinner to
create a Spinner and run it.** This document is the strategy + the
methodology + the dependency-ordered work. It is *not* the canon
(`WARP-CANON.md`), the operational diary (`ROADMAP.md`), or the
day-to-day in-flight register (`OPEN_QUESTIONS.md`). It sits between
those — strategic enough to read in one sitting, operational enough
to drive the next ten commits.

The webspinner.ai site is the public commitment. We do not lower its
claims to match today's code. We ship the code that makes the claims
true. Each tier below ends with a specific subset of the site's hero
or pillar copy becoming *demonstrably* accurate; that becomes the
release-tag trigger for the next public update.

---

## The methodology — five pillars

These bind the work as operating discipline. They are not aspirational
— they are how decisions get made.

1. **No technical debt.** Every commit ships with tests (Vitest for
   pure logic, Playwright for end-to-end). Every Spinner ships with a
   How-It-Works document, a thumbnail, and a Mission Lock. Every
   architectural addition gets a `DECISIONS.md` entry the same day.
   Half-finished work is not acceptable; partial work is acceptable
   only if the seam is named in `OPEN_QUESTIONS.md`.

2. **Awesome design.** Every patron-visible surface passes Pablo
   review before ship. Every operational figure (Spinner anatomy,
   Capability Bus close-up, Warp Thread executor diagram) matches the
   Cell-Diagram visual register so the body of work reads as one
   place. Em-dashes preserved. Manuscript-serif voice on prose
   surfaces; data-sans on chrome; mono on code.

3. **Empirical study before adoption.** Before adopting any
   third-party library, benchmark it on the Cell's actual workload.
   Before designing a new primitive, study how the container
   ecosystem (OCI image-spec, sigstore, Notary v2), the workflow
   ecosystem (Temporal, Argo, Airflow), and the audit ecosystem
   (SLSA, in-toto, Sigstore CT) solved the analogous problem. Cite
   the prior art in the `DECISIONS.md` entry that adopts our
   approach.

4. **Industry best practice.** Adopt the conventions that have
   converged in production — sha256 over canonical bundles, ed25519
   for signatures, JSON Schema for capability shapes, JSON Pointer
   for output→input binding, CloudEvents for audit envelopes, SemVer
   for versioning, OCI-style content-addressable distribution. Do
   not invent a primitive where a vetted convention exists.

5. **Best open source over hand-rolled.** Prefer audited libraries
   (`@noble/curves`, `@noble/hashes`, `@noble/ciphers` for crypto;
   `ajv` for JSON Schema; `commander` or `clipanion` for CLI;
   `marked` for markdown; `sharp` for images). Never hand-roll
   crypto. Hand-roll only the primitives that are genuinely
   Warp-specific (the Weaver dispatch, the Mission Lock injection
   pattern, the Silk Pattern persistence shape).

---

## The milestone

A Wizard signed in at the Loom can:

  1. **Describe** the Spinner she wants — kind, capabilities, voice
     register, declared model, declared Spools, declared vault refs.
  2. **Scaffold** a Spinner bundle from a template (consult / audit /
     review / produce), pre-filled with the manifest skeleton,
     mission-lock skeleton, how-it-works skeleton, thumbnail
     placeholder, src/index.ts capability shell, package + tsconfig.
  3. **Iterate** on the bundle with Pablo reviewing the surface, with
     the Bootstrap Spinner auditing the mission-lock for drift, with
     tests scaffolded and runnable.
  4. **Sign** the bundle with her Cell's identity key (ed25519 over
     the canonical digest).
  5. **Register** the signed Spinner with the Weaver. Integrity
     verifies. The Spinner appears in the Skein listing alongside
     Bootstrap, Pablo, Wizard's Journal, Genesis.
  6. **Run** it — invoke its capabilities through the standard
     Spinner detail surface; the audit chain records every
     invocation; the Silk Pattern accumulates.

When this round-trip closes, "Webspinner creates Webspinner" is
operative. That moment is the closing of Tier 1 below.

---

## Tier 0 — the foundation that everything depends on

These are the items the milestone strictly cannot land without. They
are the prerequisites; nothing further ships until they do.

### 0.1 Spinner signing — ed25519 over the canonical digest

**Why.** The website hero promises *"sealed bundles, content-
addressable digests, publisher signatures."* Today the first two are
real; signatures are spec-pending. Every other property of a Spinner
— Foundation-recognized publication, federation across Cells, trust
across the boundary of *anyone but the operator who built it* —
depends on signing being real.

**Definition of done.**

- The SDK exposes `signSpinnerBundle(digest, privateKey) → Signature`
  and `verifySpinnerBundle(digest, signature, publicKey) → boolean`.
- The Loom's Vault gains a first-class **Identity key** entry
  (separate from generic vault secrets): ed25519 keypair stored
  encrypted at rest, paired with a public-key fingerprint visible in
  `/admin/profile` and on every signed Spinner.
- The Weaver's existing integrity gate (`SpinnerIntegrityStatus`)
  honors signatures — `unsigned` stays a warning; `signature-invalid`
  and `unknown-signer` become hard gates.
- `tools/webspinner sign` (when the CLI lands in Tier 1) writes
  detached signatures alongside the bundle digest, indexed by signer
  fingerprint.
- Key rotation has a documented path; revocation has at least a stub.

**Best open source.** `@noble/curves/ed25519` for the signature
math; `@noble/hashes/sha2` for the digest. Both are zero-dependency,
audited, used in the Ethereum ecosystem. No native deps; works in
Node and the browser.

**Empirical study.** Read sigstore's "Sigstore: Software Signing
for Everybody" (Newman, Lorenz et al.) before adopting the scheme;
read Notary v2's design notes. Cite the prior art in the
`DECISIONS.md` entry. Run signing+verification on a real Spinner
bundle (Pablo's, the largest) and measure: target signing < 50ms,
verification < 10ms.

**Risk.** Key custody. The Foundation release key — once issued
— is a single point of trust. Treat the Foundation key as
out-of-scope for v1; ship operator-Cell signing first, with each
operator's identity key. The Foundation release key + a recognition-
revocation registry land later.

### 0.2 Spinner authoring primitives — schema, validation, scaffolding

**Why.** Before there is a `webspinner` CLI, there is the *grammar*
the CLI operates on. The SDK has `SpinnerManifest` as a TypeScript
type. To author a Spinner, the operator needs:

- The same shape published as **JSON Schema** so editors (and the
  CLI) can validate manifests at write time, not at load time.
- A canonical **manifest validator** in the Loom that surfaces
  errors before the Weaver rejects.
- Canonical **bundle digest** algorithm published in the SDK with
  test vectors, so independent implementations can compute the same
  hash.

**Definition of done.**

- `@webspinner-foundation/sdk` exports `manifest.schema.json` (JSON
  Schema Draft 2020-12).
- The Loom validates manifests at upload / register time; errors are
  rendered in the Loom with line numbers and pointer paths.
- The SDK exposes `computeBundleDigest(bundleDir) → SpinnerDigest`
  with deterministic output across platforms.
- Test vectors: three reference Spinners with their canonical
  digests committed; reproducing the digests is part of CI.

**Best open source.** `ajv` for JSON Schema validation in the
Loom (fastest validator; supports Draft 2020-12). For canonical
JSON serialization (before hashing), use a tiny in-tree sort-
keys-then-stringify (we already have one in `spinners.ts`); do not
pull in `canonicalize` — small enough to keep in-tree.

**Empirical study.** Look at how OCI image-spec defines canonical
manifest digest (sorted JSON, no whitespace). Look at npm's
package-lock.json hashing approach. Cite both.

**Risk.** Canonicalization is a known source of cross-platform
hash mismatches. Test vectors in CI catch this early.

---

## Tier 1 — the meta-loop closure (the milestone)

When Tier 1 lands, the website's `/build` page becomes literally
true: a Wizard runs the documented commands and a new signed Spinner
appears in her Skein, runnable through the Weaver.

### 1.1 `webspinner` CLI — `init`, `build`, `sign`, `install`, `run`

**Why.** The CLI is the canonical authoring surface for technical
Wizards. The in-Loom UI (1.2) is the canonical authoring surface
for non-technical Wizards. Both walk the same flow: a sentence, a
precedent, a clarifying dialogue, an artifact.

**Definition of done.**

- `webspinner init` (default mode is **interactive precedent-
  based authoring** — `VISION.md` §"The authoring conversation").
  The Wizard speaks a sentence; the CLI searches the Skein and the
  Foundation library for matching precedents; surfaces the closest
  match; walks dynamic clarifying-question prompts; scaffolds the
  specialized bundle. `--non-interactive` falls back to template-
  only init (`webspinner init <name> --from <template>`).
- `webspinner build [path]` validates manifest against the JSON
  Schema (via `ajv`); validates each capability's input/output
  schema carries the canonical SemVer `$id`
  (per `STANDARDS.md` §"Schema versioning"); runs type-check on
  `src/index.ts`; emits computed digest.
- `webspinner sign [path]` reads the Cell's identity-key from the
  vault (via the Loom's local socket or an env handoff); writes
  detached signature.
- `webspinner install [path]` registers the bundle with the local
  Weaver (drops it into `spinners/` and triggers a Loom reload).
- `webspinner run <spinner> <capability> [--input-json '{...}']`
  invokes a capability and prints the structured result; mirrors
  `tools/wj` and `tools/audit` patterns.
- All subcommands honor `--json` for machine-readable output.

**Best open source.** Per `STANDARDS.md`: `commander` for the
shell, `@inquirer/prompts` for the dialogue, `ajv` for schema
validation, `@noble/curves` for signing. No scaffolding-engine —
template specialization through declared parameters resolved
against the precedent's JSON Schema.

**Empirical study.** Look at how `npm init`, `cargo new`,
`gh repo create`, and `wrangler init` shape their prompts.
Look at how Salesforce's Flow Builder and Apex Builder surface
precedent-based authoring through guided dialogue. Cite both.

**Risk.** A CLI that depends on the Loom being up is fragile;
design `webspinner build` to work offline, and `webspinner sign`
to read the key via env-injection so it can run without the Loom
process. The interactive mode requires the Cell's Quiet Loom +
embeddings sidecar to be reachable; degrade gracefully to
template-only when unavailable.

### 1.2 In-Loom Spinner authoring — `/admin/spinners/new` + the meta-runtime

**Why.** The Wizard speaks one sentence. The Loom does the rest.
Authoring is the canonical non-technical-Wizard experience.

**Definition of done.**

- New nav entry "New Spinner" under the Spinners group.
- The authoring conversation per `VISION.md` §"The authoring
  conversation" — Wizard speaks a sentence → Loom searches Skein
  + Foundation library precedents → proposes a starting point →
  walks dynamic clarifying-question forms → specializes the
  bundle. Iterative *"make it more X"* refinement supported.
- The polishing pipeline (output staging per `STANDARDS.md` §3 —
  draft → reviewed → audited → polished → delivered). Pablo runs
  on UI; Bootstrap audits prose; both findings inform the polish
  pass. Nothing reaches the Wizard before `delivered`.
- **The meta-runtime** (per `ARTIFACTS-AND-STORAGE.md` §3.2) — a
  typed, audited, resumable operations layer. Authoring is the
  first meta-runtime operation:
  search-precedents → run-dialogue → scaffold-bundle → run-tests
  → run-Pablo → run-Bootstrap → polish → compute-digest →
  sign-with-identity-key → create-GitHub-repo → initial-commit
  → push → tag-v1.0.0 → register-in-local-Skein → reload-Weaver
  → emit-`wp.spinner.installed`-audit.
- New PocketBase collection `wp_operations` records every step;
  new Loom surface at `/admin/operations` surfaces running and
  completed operations with Cancel affordance.
- GitHub credential (PAT in vault under
  `vault://_self/github-pat`; identity-key signs each commit; the
  credential is never logged, never passed to Claude Code).
- The Wizard's experience: one sentence, a dialogue of forms, a
  polished Spinner in their Skein. No shell, no git, no token.

**Best open source.** Per `STANDARDS.md`: `ajv` for client-side
validation, `@octokit/rest` for GitHub API, `simple-git` for
local git operations (or shell out to the `git` binary directly
for cleaner audit), `@noble/curves` for signing. The `xstate`
patterns from Tier 2.1 inform the meta-runtime state machine
even though that work hasn't landed yet — the meta-runtime is
the first place we hand-roll the durable-state-machine pattern.

**Empirical study.** Beyond what's in Tier 1.1 — look at Vercel
deploy logs as a meta-runtime UX precedent; look at Cloudflare
Pages build logs; look at GitLab's pipeline UI; look at Argo's
Workflow visualisation. Cite.

**Risk.** The authoring surface is the highest-stakes patron-
facing Wow-as-Baseline surface the Foundation will ship. Pablo
reviews it weekly during build. The meta-runtime has its own
risk surface — long-running operations that fail mid-stream need
clean state to resume from. Audit-chain steps are the
recovery substrate.

### 1.3 Templates — the starting points

**Why.** A Wizard's first Spinner specializes from a precedent.
Templates are the proven shapes the authoring conversation draws
from — each is a full I-P-O contract plus a reference Spinner
bundle the Wizard parameterizes through dialogue.

The first three templates *are not the operator-internal categories
I had earlier* (consult / audit / review / produce). Those remain
available as patterns for Spinner authors who need them — they are
abstractions of what Bootstrap and Pablo already do — but they are
not the first templates. The first templates are the archetypes
the Wizard named (`VISION.md` §"Three first authoring archetypes"):

**Definition of done. Three archetype templates land in
`~/warp/templates/`, each as a real working Spinner bundle:**

- **`weave-website`** — *"I want a website for my bakery in
  Asheville that sells sourdough and pies and lets people
  preorder."*
  Input: a one-sentence intent + clarifying answers via dynamic
  forms. Process: retrieves a static-site precedent from the
  Foundation library; specializes copy, navigation, brand; renders
  Astro source. Output: deployable site bundle + a hosted-
  microservice manifest for any forms it embeds.

- **`weave-form`** — *"I need a contact form on my professional
  services site that captures lead source and budget range."*
  Input: a description of the form's purpose + field hints.
  Process: generates the form's JSON Schema, a Svelte renderer,
  and a microservice endpoint manifest with audit + Spool
  binding. Output: embeddable snippet + Cell-side microservice
  deployment ready to install.

- **`weave-app-package`** — *"Create an integrated accounting
  package for my small business."*
  Input: a one-sentence application description. Process: searches
  the Foundation library for industry-best-practice precedents
  (for accounting: GL + AP + AR + invoicing + statements +
  financial reports); composes a set of Spinners + Warp Threads +
  Spools + Loom surfaces. Output: a complete application bundle
  ready to install in the Cell.

Each template's first instance is the demonstration. A Wizard
speaks the sentence; the Cell produces the thing; the thing
works. That is the demo we land Tier 1 against.

The earlier operator-internal categories (`consult`, `audit`,
`review`, `produce`) are *available* as second-tier templates
when the corpus of patron-archetype templates is mature. They
are not the priority.

**Best open source.** Per `STANDARDS.md`: `ajv` for manifest +
form-schema validation, `json-logic-js` for declarative business
rules in produced applications, `marked` for prose emission,
Astro programmatic API for `weave-website` site generation, Svelte
+ JSON-Schema renderer for `weave-form` field rendering. No
scaffolding-engine.

**Empirical study.** Look at `create-svelte`, `create-next-app`,
Vercel's "deploy template" flow. Look at how Bubble, Glide, and
Retool handle non-technical-user template specialization. Look
at how Salesforce Flow Templates and Microsoft Power Platform's
templates handle precedent-based composition. Cite the prior art.

**Risk.** The archetype templates are far more ambitious than the
operator-internal ones. The first version of `weave-website` is
expected to produce a *working, branded, accessible, deployed* site
from one sentence. The quality bar from `VISION.md` (works the
first time, elegantly branded, delights and astounds) is the gate.
Pablo + Bootstrap reviewers are not optional — they are part of the
default pipeline. If Tier 1.3 ships a `weave-website` that needs
a second pass to be acceptable, the standard is broken; fix the
template, not the second pass.

### 1.4 Pablo learns to review *Spinners*, not just rendered HTML

**Why.** Today Pablo reviews a rendered surface against the design
library. Spinner authoring needs Pablo to review the *manifest +
mission-lock* against a Spinner library. This is the same Pablo, a
different cited library.

**Definition of done.**

- A new library directory at `~/warp/spinners/pablo/library/spinners/`
  with three new files: `mission-lock-rubric.md`,
  `capability-schema-rubric.md`, `manifest-discipline.md`.
- A new `review-manifest` capability on Pablo (or a flag on the
  existing `review`) that walks a Spinner bundle and returns
  severity-tagged findings.
- Authoring flow (1.2) invokes Pablo on every save.

**Best open source.** None — purely additive content + dispatch.

**Empirical study.** Run the new capability against the four
existing Spinners as the regression set. Findings should be near-
zero on a well-formed Spinner; non-zero on a deliberately-broken
fixture.

**Risk.** None significant.

---

**At the end of Tier 1, the milestone is true.** The website's hero
copy *Composition into Warp Threads* is still aspirational (that's
Tier 2), but the rest of the pillars are demonstrably real for
Spinners. The release that closes Tier 1 is `v1.0.0` — Webspinner
creates Webspinner.

---

## Tier 2 — composition and quality

These items convert the remaining aspirational hero copy into truth.
They also accumulate the quality work needed before scaling beyond
this Cell.

### 2.1 Warp Thread executor — composition runtime

**Why.** The site's hero says *"composition into Warp Threads."*
The manifest type exists; the executor doesn't. Until it does, the
Foundation's composition story is OCI-Compose-shaped at best.

**Definition of done.**

- `WarpThreadManifest` is honoured by a Weaver-resident executor:
  load → validate → resolve bindings → execute steps → emit audit.
- **Step ordering** — DAG resolution from declared input/output
  dependencies; cycles refused at validate.
- **Binding resolution** — JSON Pointer (RFC 6901) from one step's
  output to the next step's input.
- **Failure semantics** — three modes per step: `fail-fast`,
  `retry-with-backoff`, `compensate-and-continue`. Declared in the
  thread manifest.
- **Durability** — intermediate step state persisted to the
  Grimoire; a Loom restart picks up where the thread left off.
- **Audit chaining** — each step's `wp.spinner.invoke` event carries
  a `correlation_id` and `thread_id` so the chain is reconstructable.
- **Loom UI** — `/admin/threads` shows running and completed threads;
  click into a thread for per-step status, retry buttons, and the
  declared manifest.

**Best open source.** Studied but not adopted: `temporal` (too
heavy for a Cell), `BullMQ` (good but tied to Redis), `xstate` (a
real candidate for the DAG + state machine). For v1, hand-roll the
executor against `xstate`'s patterns without pulling in the library
— Cell-local durability is simple enough.

**Empirical study.** Read Temporal's "What is Durable Execution"
post; read the Argo Workflows v3 design notes; read the in-toto
attestation chain proposal. Cite each.

**Risk.** Composition runtimes are notoriously hard to keep simple.
Constrain v1 to single-Cell threads (no cross-Cell capability calls)
to defer the federation complexity to Tier 3.

### 2.2 Audit chain — cryptographic chaining

**Why.** Today every audit event is durable but the chain is not
*verifiable* — there is no Merkle linkage between events. For
trust across federation, the chain needs to be verifiable.

**Definition of done.**

- Each `wp_audit` row carries `prev_hash` (SHA-256 of the previous
  event's canonical form) and `event_hash` (SHA-256 of itself
  including `prev_hash`).
- A verifier walks the chain and confirms no event has been
  mutated or omitted.
- The Loom's `/admin/audit` surface gains a "Verify chain"
  affordance that runs the walker and surfaces any inconsistency.

**Best open source.** `@noble/hashes/sha2` for the hashing.
Reference: Sigstore's Rekor transparency log.

**Empirical study.** Read Rekor's design; read the Certificate
Transparency RFC (6962). Cite. Decide whether to ship a Merkle
Mountain Range (signed-tree-head) or a simple prev-hash chain.
For v1, prev-hash is sufficient; MMR comes when the audit corpus
exceeds a threshold worth log-time inclusion proofs.

**Risk.** Performance. Each event-write now requires reading the
last event's hash; index the audit table on `event_time DESC` to
keep the read O(1).

### 2.3 Spool registry — first-class Cell primitive

**Why.** Today Spools are hardcoded in `spools.ts`. To onboard a
Spool — a new document corpus, a federated peer's retrieval surface
— is a code change. That's the wrong shape.

**Definition of done.**

- New PocketBase collection `wp_spools` with name, displayName,
  sensitivity, reader-kind (whole-file / chunked / federated),
  source-config.
- Loom surface at `/admin/spools` (today a stub) becomes a CRUD
  list with sensitivity classification and reader-kind selection.
- `spools.ts` becomes a thin loader that reads the collection.
- Existing Spools (`@webspinner-foundation/warp-canon`,
  `@webspinner-foundation/warp-decisions`,
  `@webspinner-foundation/warp-open-questions`,
  `@webspinner-foundation/ai-enclosure`,
  `@webspinner-foundation/pablo-references`) seed on first launch.

**Best open source.** None new; uses existing PocketBase + the
existing reader pattern.

**Empirical study.** None required; this is a refactor.

**Risk.** Migrating from hardcoded to collection-backed needs a
seed step + backwards compatibility for already-registered
Spinners.

### 2.4 WRAG re-ranker — canon §4 stage 3

**Why.** Today Pablo's retrieval is MiniLM-L6-v2 cosine top-k. For
larger corpora (the manuscript, federated Spools), re-ranking
improves quality. The canon describes a seven-stage pipeline; today
we ship two stages (chunk + embed-top-k).

**Definition of done.**

- A re-ranker model on Kepler: BGE-reranker-v2-Gemma (open weights,
  MLX-compatible) or BGE-reranker-v2-m3.
- `retrieveTopK` becomes `retrieveTopKReranked` — first pass top-K
  by cosine, second pass re-rank by cross-encoder, return top-N.
- Spinner manifests can declare retrieval-mode in `spools[]`
  config; default is the new pipeline.

**Best open source.** `BGE-reranker-v2-Gemma` weights from
`mlx-community/bge-reranker-v2-gemma-mlx` (or convert from HF).
Inference via a small mlx-server endpoint alongside the existing
embeddings sidecar.

**Empirical study.** Benchmark the existing canon-consult on
ten reference questions, with and without re-ranking. Target:
re-ranking improves answer quality measurably and adds < 500ms
per call on Kepler.

**Risk.** Adding a third model on Kepler increases memory
pressure. Validate first.

---

**At the end of Tier 2, the website's hero is fully true.** "Sealed
bundles. Content-addressable digests. Publisher signatures. Runtime-
enforced execution. Composition into Warp Threads. Audit by default.
Sovereignty by architecture." — every clause demonstrably real. The
release that closes Tier 2 is `v1.5.0`.

---

## Tier 3 — patron path and federation

Tier 3 can begin in parallel with Tier 2 if scope is constrained.
The items here open the architecture to *people who aren't the
Wizard.* They are the gate between "Foundation-internal tool" and
"a thing other Wizards adopt."

### 3.1 First patron-facing Spinner

**Why.** Today every Spinner is operator-facing. Bootstrap is for
the Wizard; Pablo is for the Wizard; the Journal is for the Wizard;
Genesis is for the Wizard. The architecture's value proposition is
that a Cell *does work for someone besides the Wizard.* Until a
patron Spinner exists, that value is unproven.

**Definition of done.**

- A `weave-website` or `weave-form` or `weave-strategy-doc`
  Spinner (pick one). Walks a patron through a request, produces
  an artifact, exits with audit.
- The Spinner's mission-lock declares the patron-path constraints
  (no off-Cell inference; SI not AI in patron prose; em-dashes
  preserved).
- An artifact-emission contract: how does a Spinner *give the
  patron the thing* it made? File download? Email send? Inline
  render? Decide in `DECISIONS.md` before building.

**Best open source.** Depends on the artifact kind. For a static-
site emission, `astro`'s programmatic API. For PDFs, `puppeteer-
core`. For email, the existing Resend integration.

**Empirical study.** Look at how Vercel's v0, Anthropic Artifacts,
and ChatGPT's Custom GPTs handle artifact emission. Cite.

**Risk.** Scope explosion. Pick *one* patron Spinner; ship it end-
to-end before pitching a second.

### 3.2 Patron Loom surface

**Why.** The patron should not see `/admin/*`. A patron Loom is a
separate route family — `/weave`, `/spinner-name`, or a parallel
hostname — with its own auth and its own visual register (still the
Foundation brand, but stripped of operator chrome).

**Definition of done.**

- New routes outside `/admin/*` for patron interactions.
- Patron auth in PocketBase: either a separate `patrons` collection
  or a `role` field on `users` distinguishing operator from patron.
- BYOK routing on the patron path honors the Wizard's vault, not
  the patron's. (The patron does not see API keys.)
- The Loom's session model handles operator + patron concurrently
  without confusing one for the other.

**Best open source.** Existing stack (SvelteKit + PocketBase).
No new dep.

**Empirical study.** Look at how Notion, Figma, and Linear handle
the "admin user vs end user in the same product" boundary. Cite.

**Risk.** Session-confusion bugs. A leak between operator and
patron auth would be catastrophic. Write the e2e tests first;
implement after.

### 3.3 Capability Bus wire format

**Why.** Federation. Today canon §5 describes the Bus; the wire
format is undefined.

**Definition of done.**

- Protocol spec in `protocols/capability-bus/v1.md`.
- Authentication via signed capability invocations (peer Cell's
  identity key over a request envelope).
- A reference client+server in the Loom.
- Smoke: two Cells (probably Spindle + Kepler) invoke each other's
  capabilities and the audit chains on both sides reconcile.

**Best open source.** `mTLS` via `node:tls` or signed JWS via
`jose`. Investigate `did:web` for Cell identity discovery; reference
implementations exist.

**Empirical study.** Read the OCI Distribution Spec; read the
Matrix federation API design; read the ActivityPub server-to-server
protocol. Cite which patterns transfer.

**Risk.** Cross-Cell federation is the biggest single piece of new
architecture left. Constrain v1 to two-Cell peer (LAN or Tailscale);
defer multi-Cell mesh to v2.

### 3.4 Foundation Skein — public registry

**Why.** The site claims the Skein is "the Foundation's recognition
registry." Today it's whatever Spinners are in the local
`spinners/` dir. The public registry doesn't exist yet.

**Definition of done.**

- A public-facing registry surface at `skein.webspinner.org` or
  similar. Static JSON index (probably git-versioned) + a small
  ingest pipeline.
- Each registered Spinner has a public manifest, a digest, a
  signature from the Foundation release key, and a recognition
  date.
- A `webspinner install <spinner-name>` resolves through the
  registry, downloads the bundle, verifies the signature, and
  registers locally.

**Best open source.** Cloudflare Pages for static; `octokit` for
GitHub-PR-driven ingest. Look at the npm registry's design; look
at the OCI Distribution Spec.

**Empirical study.** Crates.io's openness vs npm's curation vs
pypi's classification. Cite which model we adopt and why.

**Risk.** Recognition-revocation. Once a Foundation-signed
Spinner is in the wild, revoking it is a hard problem (rooted in
the Sigstore/CT/CRL space). Ship the recognition process before
recognizing widely.

---

## Cross-cutting risks worth naming

**Quiet Loom is a single point of failure.** Three of the four
shipped Spinners route through it (Bootstrap, Pablo, the Journal's
`bootstrap` capability). The 14B model has known stability gotchas
(prompt-pump crashes, slow first-prompt processing). Mitigations to
study: a smaller fallback model (Qwen 7B, already cached) the
Weaver routes to on Quiet-Loom failure; BYOK fallback (operator
configures an Anthropic / OpenAI key for failover); or model-pool
abstraction in the Weaver.

**Identity-key custody.** The operator's Cell identity key is the
authority over everything the Cell signs. If it leaks, Spinners
signed by that Cell can no longer be trusted. Need: secure storage
in the vault, rotation path documented, revocation list (even if
stub) before broad publication.

**Operator burden at standup.** Today Genesis exists but registering
+ verifying as a Wizard + running the Cell is multiple manual steps.
For real adoption, target one command: `webspinner cell init`
that runs Genesis, generates the bootstrap state, deploys the
services, and prints the verified-Wizard URL. That's the demo a
peer Wizard runs at acquisition.

**Patron auth contamination.** The most dangerous architectural
risk in Tier 3 — a session boundary leak between operator and
patron — needs e2e tests before any patron flow ships. Treat
patron auth as security-critical from the first commit.

---

## Implementation–site alignment principle

The site is the public commitment. The implementation is the
private work. The contract between them:

- **We do not change the site to match today's code.** Public
  claims are the architectural commitment; lowering them is
  walking back the Foundation's category position.
- **We change the code to match the site.** Each tier ends with a
  specific subset of site copy becoming true; that's the
  release-tag trigger.
- **The `/roadmap` page is the seam.** As long as everything
  aspirational in the hero is named on `/roadmap`, the site is
  honest. The roadmap is updated *after* each shipment, never
  before.
- **No tier ships behind a flag.** "Soft launch" is technical
  debt. A capability is either operative or not implemented; the
  Loom does not lie about which.

---

## Open architectural questions for empirical study

These deserve empirical study before the corresponding tier item
locks. Add to `OPEN_QUESTIONS.md` if not already there.

- **Canonical bundle digest** — exact serialisation rules
  (sort-keys, trailing newline, BOM handling). Reference: OCI
  image-spec; cite the test vectors.
- **Identity-key derivation** — HKDF from a master seed? Direct
  ed25519 generation? Operator-mnemonic recovery path? Reference:
  Sigstore's Fulcio; cite.
- **Spinner template literacy** — do operator-Wizards pick a
  template by name or by description? UX study (Pablo+Bootstrap
  do a usability sweep of three template-pick UIs).
- **Warp Thread durability** — full event-sourcing vs snapshot-
  per-step? Performance vs recoverability tradeoff. Reference:
  Temporal's design notes; cite.
- **Re-ranker latency budget** — what's the patron-perceptible
  ceiling on retrieval-augmented invocations? Target sub-second
  end-to-end excluding generation; measure on Kepler before
  adopting BGE.
- **Patron BYOK vs operator BYOK** — when the patron asks for
  off-Cell inference, does the patron supply a key, or does the
  operator's key carry the cost? Canon §7 implies both flows;
  pick one as the v1 default, defer the other.

---

## Tagged shipments

The next four release tags, in order, mapped to this plan:

| Tag | Closes |
|---|---|
| `v0.8.0` | Tier 0.1 (signing) + Tier 0.2 (authoring primitives) |
| `v0.9.0` | Tier 1.1 (CLI) + Tier 1.3 (templates) |
| `v1.0.0` | Tier 1.2 (in-Loom authoring) + Tier 1.4 (Pablo reviews Spinners) — **the milestone** |
| `v1.5.0` | Tier 2 in aggregate (Warp Threads + audit chain + Spool registry + WRAG re-ranker) |

Tier 3 is sized and tagged when Tier 2 lands.

---

## Living document note

This plan is a working artifact. When a tier item ships, mark it in
`ROADMAP.md` and promote the corresponding `DECISIONS.md` entry.
When a tier item changes (scope grows, dependency surfaces, prior-
art study reveals a better path), update this file *first*, then
implement. The plan is the operative shape of the work — the canon
is the architecture, this document is the path through it.

When this plan conflicts with `WARP-CANON.md`, the canon wins;
update this plan to reconcile.

---

*Updated 2026-05-12. Current tag: v0.7.0. Next milestone: v1.0.0,
Webspinner-creates-Webspinner.*
