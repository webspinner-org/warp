# ARTIFACTS-AND-STORAGE.md — what a Spinner is, where it lives, how the Loom owns its lifecycle

Three questions answered:

1. **What artifacts does authoring a Spinner produce?**
2. **Where do design-time artifacts live? Where do runtime modules
   live? Where does the registry live?**
3. **How does the Loom do everything without the Wizard touching a
   shell, a git CLI, or a credential?**

Read this with `VISION.md` (what we're for), `STANDARDS.md` (what
we build to), `STANCE.md` (how we work in this epoch), and
`IMPLEMENTATION-PLAN.md` (the path). When this file conflicts with
`WARP-CANON.md`, the canon wins.

---

## 1. The artifact inventory

Every Spinner produces, over its lifecycle, a specific set of files
+ records. The list is exhaustive and deliberate.

### 1.1 Source artifacts (the bundle)

These are what the Wizard's authoring session creates. They are the
durable definition of the Spinner.

  - **`manifest.json`** — the `SpinnerManifest` declaration:
    name, displayName, version, description, license, entrypoint,
    model, vault refs, Spool refs, env, capabilities (each with
    versioned `inputSchema` + `outputSchema`), documentation paths,
    thumbnail, threadable flag, audit source, `shellAllowlist` if
    needed.
  - **`mission-lock.md`** — operative behavioural contract,
    injected as the system prompt for every invocation that uses
    the Spinner's declared model.
  - **`how-it-works.md`** — patron-facing explanation. Required.
    Per canon §19.7 — *the UX is the architecture*. A Spinner without
    a how-it-works fails the production-candidate quality bar.
  - **`README.md`** — short. The Skein indexes it.
  - **`thumbnail.svg`** — unique brand mark, surfaced on every
    Skein and Spinner-detail surface.
  - **`src/index.ts`** — the capability handlers. The Weaver loads
    this and dispatches typed invocations.
  - **`package.json`** — npm metadata.
  - **`tsconfig.json`** — TypeScript config.
  - **`changelog.md`** — append-only release history, one entry per
    version bump.
  - **`library/`** *(optional)* — cited references the Spinner uses
    (e.g., Pablo's design library). Each file a Spool entry.
  - **`assets/`** *(optional)* — images, fonts, sounds the Spinner
    needs at runtime.
  - **Tests**:
    - `src/**/*.test.ts` — Vitest unit tests.
    - `e2e/*.spec.ts` — Playwright e2e tests when the Spinner
      produces UI.

### 1.2 Build artifacts

Generated from source by `webspinner build`. Not version-controlled
in the Spinner's repo (gitignored). Published as a Release asset
when the Spinner is published.

  - **`dist/index.js`** — compiled entrypoint (esbuild or Astro
    bundling, depending on the Spinner kind).
  - **`dist/index.d.ts`** — type definitions for the capability
    contract.
  - **`dist/manifest.canonical.json`** — canonicalized form of the
    manifest used in digest computation.

### 1.3 Provenance artifacts

Generated when the Spinner is signed (`webspinner sign`). These are
the integrity primitives.

  - **`provenance/<digest>.json`** — the canonical bundle digest
    record (`SpinnerDigest`): algorithm, hex value, the list of
    file paths + per-file hashes that fed the bundle hash, the
    canonical-JSON-of-manifest hash, the timestamp.
  - **`provenance/<digest>.sig`** — detached ed25519 signature
    over the digest record. Filename includes the signer's
    public-key fingerprint (first 16 hex chars) for disambiguation.
  - **`provenance/signers.json`** — list of public-key
    fingerprints that have signed this bundle, with the publisher
    (Foundation release key, Cell identity key) for each.

### 1.4 Authoring artifacts

Generated during the authoring conversation (`webspinner init` /
`/admin/spinners/new`). These are the *history of the design* —
what was asked, what was answered, what precedent was specialized.

  - **`authoring/initial-sentence.md`** — the Wizard's one
    sentence, verbatim.
  - **`authoring/precedent.md`** — the precedent the authoring
    conversation specialized from (Spinner name + version + why it
    was the closest match).
  - **`authoring/dialogue.jsonl`** — the full clarifying-question
    dialogue: each turn timestamped, each question + answer +
    Cell's reasoning recorded.
  - **`authoring/review-notes.md`** — Pablo + Bootstrap findings
    that informed the polishing pass, with the resolution per
    finding.

These artifacts are **explainability**. A future Wizard reading the
Spinner can see *why* it is shaped this way. They are also the
substrate for *improving* the authoring conversation itself —
Pablo can review a thousand authoring dialogues and learn which
question shapes produce delight.

### 1.5 Registration + lifecycle records (in the Grimoire)

Created when the Spinner is installed in a Cell, and accumulated
through its life.

  - **`wp_skein`** row — one per installed Spinner. Holds: name,
    version, digest, signature-status, install-timestamp, source-
    repo URL, last-invoked timestamp, integrity-status.
  - **`wp_audit`** events — `wp.spinner.installed`,
    `wp.spinner.invoke`, `wp.spinner.uninstalled`, etc.
  - **`wp_silk_pattern`** entries — one per invocation: timestamp,
    capability, input summary, output summary, duration, audit-event
    id, result.
  - **`wp_journal_entries`** (when the Spinner is the Wizard's
    Journal) — operator diary entries.

These are *not* part of the Spinner's bundle; they are the Cell's
records *about* the Spinner.

---

## 2. Where everything lives

Three storage tiers, each with a specific role. The boundaries are
deliberate.

### 2.1 Design-time: GitHub, one repository per Spinner

**Choice.** Every Spinner is one git repository, hosted under a
Foundation-controlled GitHub organization (`github.com/webspinner-
spinners/<name>` for Foundation-recognized; the operator's own
GitHub for Cell-published). The repository holds every artifact
from §1.1, §1.3, and §1.4.

**Why GitHub + git.**

  - **Industry standard.** Every modern packaging ecosystem (npm,
    cargo, pip, Go modules, Helm) settled on git-backed source +
    a registry-mediated distribution layer. Webspinner stands on
    proven rails.
  - **Free version history.** A Spinner's evolution is durable; a
    future Wizard can read the diff that introduced a capability,
    the dialogue that shaped it, the review notes that polished it.
  - **Free social affordances.** PR-based ingest into the Foundation
    Skein. Issues for community feedback. Releases for SemVer
    publication.
  - **Operator-portable.** A Wizard who leaves the Foundation can
    fork their Spinners; the Foundation has no ability to delete
    their work.

**Repository structure** (canonical):

```
<spinner-name>/
├── manifest.json
├── mission-lock.md
├── how-it-works.md
├── README.md
├── thumbnail.svg
├── changelog.md
├── src/
│   ├── index.ts
│   └── *.test.ts
├── e2e/                       (optional)
│   └── *.spec.ts
├── library/                   (optional)
│   └── *.md
├── assets/                    (optional)
│   └── *
├── provenance/
│   ├── <digest>.json
│   ├── <digest>.sig
│   └── signers.json
├── authoring/
│   ├── initial-sentence.md
│   ├── precedent.md
│   ├── dialogue.jsonl
│   └── review-notes.md
├── package.json
├── tsconfig.json
├── .gitignore                 (excludes dist/, node_modules/)
└── LICENSE                    (Apache-2.0 by default)
```

**Authoring artifacts in the same repo, by default.** They are part
of the Spinner's history. A Wizard who wants authoring privacy
(e.g., a commercial Spinner whose dialogue logs are competitive
information) can mark a Spinner as `authoring-private` in the
manifest; the Loom keeps the dialogue in the Grimoire instead of
the repo. Default: in-repo.

### 2.2 Runtime: Cell-local `~/warp/spinners/<name>/`

**Choice.** Each Cell has a local cache of installed Spinners at
`~/warp/spinners/<name>/`. Each is a clone of the Spinner's GitHub
repo, checked out at a specific signed version.

**Why a local clone, not a runtime registry pull.**

  - **Sovereignty.** A Cell does not need the Foundation registry
    online to run its installed Spinners. Once installed, the
    Spinner is local; the Cell is self-contained.
  - **Integrity-on-load.** The Weaver re-computes the digest from
    bytes on disk on every load. A clone is the right unit — the
    bytes are there to hash.
  - **Easy iteration during authoring.** When a Wizard is authoring
    a Spinner in the Loom, the working tree is the local clone.
    Save iterations land in the working tree; pushes go to GitHub
    when the Wizard says "publish."

### 2.3 The Registry: the Foundation Skein

**Choice.** A static index at a Foundation-operated URL (`skein
.webspinner.org`, or as a page on webspinner.ai). Updated by
GitHub-PR-based ingest. Each entry lists a Foundation-recognized
Spinner with:

```json
{
  "name": "@webspinner-foundation/weave-website",
  "versions": [
    {
      "version": "1.0.0",
      "digest": "sha256:…",
      "source": "https://github.com/webspinner-spinners/weave-website",
      "tag": "v1.0.0",
      "signatures": [
        { "fingerprint": "…", "signer": "foundation-release-key", "sig_url": "…" }
      ],
      "recognized_at": "2026-05-12T…Z",
      "deprecated": false
    }
  ]
}
```

**Why a static index, not a service.** Per `STANCE.md` — *build the
primitive that scales, don't build the scaling apparatus before
there is scale.* A static JSON file behind Cloudflare Pages serves
a thousand Spinners with no operational burden. When the corpus
warrants a service (search-by-capability, dependency graph queries,
recognition revocation streaming), we promote.

**Cell-published Spinners** (Spinners a Wizard built that aren't
Foundation-recognized yet, or are deliberately Cell-private) live
in the Wizard's own GitHub. They appear in the Wizard's *local*
Skein (the `wp_skein` collection) but not in the Foundation Skein
until they go through recognition.

### 2.4 The local Skein (per Cell)

**Choice.** A PocketBase collection `wp_skein` that tracks every
Spinner installed in *this* Cell. Holds the installation manifest:
name, version, digest, signature-verification status, source-repo
URL, install timestamp, last-invoked timestamp, integrity status.

`/admin/spinners` reads from this collection. The disk clones at
`~/warp/spinners/<name>/` are the *bytes*; `wp_skein` is the
*index*.

---

## 3. The Loom does everything

The Wizard never touches a shell, a git CLI, or a credential. The
Loom is the chokepoint for every operation a Spinner's lifecycle
requires.

### 3.1 What the Loom needs to operate

  - **A GitHub credential**, stored in the Vault as
    `vault://_self/github-app-installation-token` (preferred) or
    `vault://_self/github-pat` (bootstrap fallback). The Loom reads
    it at the moment of need; never logs it; never sends it
    anywhere except to the GitHub API.
  - **Git binary** on the host (already present via Homebrew).
  - **A working directory pool** at
    `~/Library/Application Support/Webspinner Foundation/Loom/workspaces/`
    for transient authoring tasks. Cleaned up after each authored
    Spinner is committed and pushed.
  - **A long-running operations queue** in the Grimoire
    (`wp_operations`) — every multi-step task the Loom performs on
    the Wizard's behalf is enqueued, executed, audited, and
    surfaced.

### 3.2 The meta-runtime — the Loom's operations layer

A new architectural concept worth naming: **the meta-runtime** is
the Loom's ability to perform multi-step operations *on the
Wizard's behalf* — not Spinner invocations, but operations on
Spinners (and on the Cell's external integrations).

Examples:

  - **Authoring a Spinner**: search-precedents → run-dialogue →
    scaffold-bundle → run-tests → run-Pablo → run-Bootstrap →
    polish → create-repo → push-commits → sign → register-locally.
    Multi-step; mixes Cell-local execution with external API calls.
  - **Publishing a Spinner**: tag-release → push-tag → upload-
    release-asset → open-PR-against-Foundation-Skein.
  - **Updating an installed Spinner**: fetch-latest-tag → verify-
    signatures → check-version-compatibility → pull → reload-
    Weaver.
  - **Uninstalling a Spinner**: gate-on-no-active-Threads-using-it
    → write-uninstall-audit → drop-skein-row → remove-disk-clone.

Each meta-runtime operation:

  - Is a **typed operation** with a declared input/output shape
    (mirroring Spinner capability shape so the patterns are
    parallel).
  - Is **audited** — every step emits `wp.operation.step` events.
  - Is **resumable** — state persisted to the Grimoire between
    steps so a Loom restart picks up.
  - Is **cancellable** — surfaced in `/admin/operations` (new
    surface, see Tier 1.2 of `IMPLEMENTATION-PLAN.md`) with a
    Cancel button.
  - Carries **provenance** — the Wizard's identity, the trigger
    (UI click, Spinner invocation, scheduled), the timestamp.

The meta-runtime is the design-time equivalent of the Spinner
runtime (the Weaver dispatching capability invocations). They are
parallel architectural primitives.

### 3.3 The credential model

The Loom needs to act on external services on the Wizard's behalf.
Today: GitHub. Soon: Cloudflare (deploying patron artifacts), email
sending (Resend, already wired), perhaps DNS providers, S3-class
storage, etc. The credential discipline:

  - **All credentials in the Vault**, never in env files, never in
    git, never passed via Claude Code (Operating Principle §17.2).
  - **Per-service credentials are vault entries** with declared
    `purpose` and `scope` fields so the Loom + the audit chain
    know what each credential is for.
  - **Operations that use credentials emit audit events naming the
    credential by name** (never logging the value).
  - **GitHub App over PAT** when scale warrants. For v1, PAT with
    `repo` scope. The abstraction in code is the same — a
    `GitHubCredential` interface; the implementation behind it
    swaps later.
  - **Operator's identity-key is the root credential.** Everything
    else (GitHub, Cloudflare, Resend, Turnstile, model BYOK) is
    derivative — secured by the identity key, scoped to specific
    purposes, individually rotatable.

### 3.4 What the Wizard sees vs. what the Loom does

**The Wizard sees:**

  - One sentence to speak.
  - A dialogue of clarifying questions through dynamic forms.
  - A polished artifact when the Cell is done.
  - The artifact appearing in their Skein, runnable.

**The Loom does (off-screen):**

  - Searches precedents in the Skein + Foundation library.
  - Drafts the bundle in a workspace.
  - Runs Pablo + Bootstrap against the draft.
  - Iterates internally to polish.
  - Computes canonical digest.
  - Signs with the Cell's identity key.
  - Creates a GitHub repo under the Foundation org (or the
    Wizard's account, per their preference).
  - Initial-commits the bundle + authoring artifacts.
  - Tags `v1.0.0`.
  - Pushes.
  - Adds a `wp_skein` row, clones the repo to
    `~/warp/spinners/<name>/`, registers with the Weaver.
  - Emits the `wp.spinner.installed` audit event.

The Wizard's reaction is *"that wasn't so hard."* The Wizard's
reaction *should* be *"I had no idea any of that happened."*

---

## 4. Documentation discipline

Every Spinner ships with **good documentation by default.** No
post-hoc "we should document this" pattern. The authoring flow
generates docs as a first-class step.

### 4.1 Required documentation files

Per §1.1, every Spinner bundle has:

  - **`how-it-works.md`** — patron-facing explanation. Five
    questions answered: *what does this Spinner do, when do I use
    it, what does it need from me, what does it produce, what
    happens behind the scenes (in plain language).* Required.
  - **`README.md`** — short. Indexed by the Skein. Three sentences
    that get the visitor reading or moving on.
  - **`mission-lock.md`** — operative law. Required.
  - **`manifest.json`** — declarations; capability documentation
    lives inline in the schema `description` fields.
  - **`changelog.md`** — append-only release history.

### 4.2 Generated documentation

The Loom generates, on every build:

  - **API reference page** — from the manifest's capability schemas
    (`inputSchema` + `outputSchema` + descriptions). Surfaced at
    `/admin/spinners/<name>` and embedded in the Skein listing.
  - **Example invocations** — at least one per capability, with
    sample input and the actual output the Cell produced when the
    example ran. (The example outputs are real — captured on the
    first successful authoring-pass invocation.)
  - **Provenance page** — digest, signatures, recognition status,
    install date, version history.

### 4.3 The documentation quality bar

  - Plain language. The reader is a non-technical Wizard.
  - Em-dashes preserved.
  - "SI" not "AI" load-bearing.
  - Manuscript-serif voice on prose surfaces; sans on chrome; mono
    on code.
  - Pablo reviews documentation surfaces in the polishing pass,
    same as any other UI surface.

### 4.4 The Spinner-without-docs gate

A Spinner that ships without `how-it-works.md` or `mission-lock.md`
fails the Weaver's manifest validation at install. The Weaver
refuses. This is structural — not a code-review checklist item.

---

## 5. Deliberate choices, named

These are the architectural decisions of this turn. Each carries a
rationale rooted in industry best practice (per `STANDARDS.md`) and
a willingness to revisit if empirical study shows we picked wrong.

| Choice | Rationale | Revisit when |
|---|---|---|
| One git repo per Spinner | Mirrors npm + cargo + Go modules + Helm; free version control + social affordances; operator-portable | Spinner count > 1000 and registry-level introspection (capability search, dependency graph) becomes the bottleneck |
| GitHub as the source host | Where most operators already are; rich API; PR-based ingest into the registry; free for public | Foundation operator demands self-hosted git (Gitea / Forgejo); easy migration since the protocol is git, not GitHub-API |
| Authoring artifacts in-repo by default | Explainability; version-controlled history of design decisions | A Wizard demands authoring privacy → `authoring-private: true` flag in manifest moves dialogue to Grimoire |
| Cell-local clone at `~/warp/spinners/<name>/` | Sovereignty (no runtime dependency on the registry); integrity-on-load (bytes are present to hash) | Multi-Cell installation across operator hosts — clone-per-Cell scales linearly, fine |
| Static JSON Foundation Skein | Per `STANCE.md` — build the primitive that scales, don't build the scaling apparatus | Search-by-capability, dependency graph queries, or recognition revocation streaming become regular workflows |
| PocketBase `wp_skein` for local index | Already running; flexible schema; no DBA | Postgres + Qdrant scale-out per canon |
| `wp_operations` for meta-runtime tasks | Audit-by-default; resumable; cancellable | Workflow scale demands a dedicated executor (Temporal / Argo); STANCE.md says not now |
| ed25519 detached signatures | `@noble/curves`; audited; matches sigstore/Notary precedent | Post-quantum migration (canon §10) — algorithmically-agile is the design |
| GitHub PAT in vault (bootstrap) → GitHub App (scale) | PAT is faster for one Wizard; GitHub App is right at scale | Second Foundation Wizard onboards |
| Authoring conversation in PocketBase during draft + committed to repo on save | Drafts are private; finished work is public-by-default | A Wizard demands always-private — same `authoring-private` flag |

---

## 6. What the Wizard sees

The whole point. Let me name it precisely.

A Wizard's interaction with Webspinner is a **conversation in the
Loom**, ending with a working Spinner installed in their Cell. No
shell. No git. No npm. No tokens. No JSON. No clone-the-repo
instructions. No copy-paste-this-snippet.

The Loom does the work. The Wizard speaks intent. The Cell
honors it.

When a peer Wizard adopts a Cell, the same is true for them. They
can install Foundation-recognized Spinners through the Loom; they
can author their own; they can publish them back. None of the
above storage or registry machinery surfaces in their UX.

This is the discipline. The architecture is built so the Wizard
never has to see it.

---

*Updated 2026-05-12. The storage model, registry shape, and
meta-runtime architecture here are the deliberate choices of the
Foundation as of this date. They evolve through `DECISIONS.md`
entries — any change to this file is recorded there first.*
