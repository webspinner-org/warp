# How the Bootstrap Spinner Works

The Bootstrap Spinner is the first Spinner of the Webspinner Foundation Cell. Its job is to help the Wizard advance the Warp architecture without drifting from the canon.

## What it is

A Spinner is a sealed unit of work registered with this Cell's Weaver. It declares what it can do, what secrets it needs, what audit events it emits, what other Spinners it depends on, and how it documents itself. It runs only through the Weaver — never anywhere else.

The Bootstrap Spinner is the production-reusable pattern. Every Spinner that follows uses the same shape.

## What it does

When you invoke one of its capabilities from the Loom — say `consult` — this is what happens.

1. **The Loom asks the Weaver.** You click `Run`, the Loom sends the capability name and your input to the Weaver as a single signed call.
2. **The Weaver verifies integrity.** It re-computes this Spinner's digest from the bytes on disk and compares it to the digest recorded when the Spinner was installed. It verifies any signatures over that digest. If anything is off, the call is gated and you see a warning *before* anything runs. Tampering does not run.
3. **The Weaver resolves vault references.** The Bootstrap Spinner declares none today — generation runs sovereignly on Kepler over loopback, no API key required. The vault stays available for Spinners that legitimately need external credentials.
4. **The Weaver retrieves grounding context.** For `consult`, this is relevant sections of `WARP-CANON.md`, `DECISIONS.md`, `OPEN_QUESTIONS.md`, and the *AI Enclosure* manuscript, scored and ranked through WRAG. Embeddings come from **Pablo** — the Kepler-resident embeddings sidecar (sentence-transformers / all-MiniLM-L6-v2, 384-dim) on `127.0.0.1:11446`. Local. Sovereign.
5. **The Weaver assembles the prompt.** This Spinner's mission lock (its operative system prompt) plus the retrieved passages plus your input. The mission lock binds the model to the Pledge, the Covenant, and the Operating Principles — not as suggestions, as the system prompt.
6. **The Weaver calls the Quiet Loom.** Generation runs on **Kepler's MLX server** at `127.0.0.1:11445` — `mlx-community/Qwen2.5-14B-Instruct-4bit` by default. OpenAI-compatible API, but the box is local and the tokens never leave. Per `WARP-CANON.md` §11 (Pledge) and `~/webspinner-work/POLICY-PATRON-PATH-LLM.md` R1, Anthropic is *prohibited* on the patron path; the Quiet Loom is the canonical sovereign generation service.
7. **The Weaver verifies grounding.** The response is checked against the retrieved context. Citations are validated. Ungrounded segments are flagged.
8. **The Weaver returns the answer.** You see it in the Loom. A single audit event records what was invoked, by whom, when, what context was retrieved, what was returned. The provenance line names the model + service for every answer.

This pipeline is the WRAG seven-stage pipeline (`WARP-CANON.md` §4) applied to a Spinner invocation.

## What it can do

- **Consult** — ask a question about Warp; get a grounded answer with section citations.
- **Audit** — point at a file or a piece of prose; get a drift report against the canon — vocabulary, missing citations, scope creep.
- **Record** — describe a decision in conversation; get a draft `DECISIONS.md` entry in the canonical format.
- **Surface** — surface unfinished threads in your work, to counter ADD drift.

## What it cannot do

- Run anywhere except through the Weaver. If something claims to be this Spinner running elsewhere, it is not authorized — report it.
- Recommend work that violates the Pledge or the Operating Principles.
- Drift terminology. SI not AI. Cell not tenant. Spinner not agent.
- Use your data without your authorization.

## Why these capabilities

The four capabilities are the smallest set that demonstrates the architecture: capability-scoped invocation, BYOK key resolution, WRAG grounding, audit emission, and Weaver-mediated execution. Every additional Spinner reuses this pattern.

## Composition

The Bootstrap Spinner is `threadable: true`. It can be composed into a Warp Thread — for example, a "Consult and Record" thread that runs `consult`, then takes that answer and runs `record` to draft a decision entry. Spinner Weaving is the practice of composing Spinners. Webspinner is modular by design.

## Integrity and stamping

The Spinner's bundle — manifest, mission lock, documentation, entrypoint module — hashes to a single content-addressable digest of the form `sha256:<hex>`. The Foundation signs the digest with its release key for first-party Spinners (this one). Every load re-verifies. The digest you see in the Loom for this Spinner is computed from the bytes that are running, not from a label. If you do not trust a digest, do not invoke the Spinner.

## What is open work

- The Weaver runtime that resolves vault, retrieves WRAG context, calls Anthropic, and records audit. The contract is fixed; the implementation is the next mechanism-layer step.
- The signing infrastructure (which keys, which custody, which rotation policy). Until it lands, this Spinner is `unsigned` — the Loom shows the digest but no signatures, and the Wizard's policy decides whether to invoke. See `OPEN_QUESTIONS.md`.
- The full WRAG pipeline (the seven stages). The Weaver is built around the schema; the implementation lands as part of the post-bootstrap data layer migration.
