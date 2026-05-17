# SI-QUALITY-DESIGN.md — making the SI feel like the Foundation's flagship

The design notes from the 2026-05-17 Wizard review of the Database Application Spinner. Captured here so the next Claude session can pick up the architectural intent without having to reconstruct it from chat.

When this document conflicts with `WARP-CANON.md` or `VISION.md`, the canon wins. This document is operative _direction_ for upcoming work; the canon is _law_.

---

## The Wizard's standing requirement

> _"This is a flagship product. It has to have wow factor. Yes it is for non-technical people, but they have to come away with the feeling that Webspinner and the Loom is their superpower, and now they can do anything. They have to come back. They can not be disappointed."_

Operative for every Spinner the Foundation ships. The patron's reaction must be _"how did you know I needed that?"_ (per `VISION.md`'s _Three operative requirements_), and they must come back.

---

## The four design observations from the 2026-05-17 review

The Wizard tested the bookkeeping flow at `try.webspinner.ai` and named four things missing from "awesome SI" feel.

### 1. The probe shows phases, not thinking

The Observatory's heartbeat is cyan; the active phase pulses; but for 30–50 seconds during `drafting-schema` the **content** doesn't change. The patron's brain reads stillness as failure. The SI is generating tokens the entire time — we're just not surfacing them.

**Root cause:** the Spinner only writes to `wp_spinner_sessions` at phase boundaries (4 writes per propose). The dispatcher `await`s one big Quiet Loom response without intermediate visibility.

**Two paths to fix:**

- **Token streaming.** mlx-server supports SSE-style streaming. The dispatcher writes partial outputs into `state.streamingDraft` every ~200 ms; the Observatory renders a live cursor of the SI's thinking.
- **Decomposition into smaller calls.** Instead of one 50 s call returning the whole schema, decompose: "list canonical entities for this domain" (5 s), "for each entity, list candidate fields" (5 s × N), "for each entity, draft relationships" (5 s × N), "draft the narration" (10 s). Each step is a separate `advance()` write. Patron sees ten small phases instead of one giant one. Same wall-clock; ten times the visible activity.

**Generalises to every Spinner.** The progress primitive is already generic; we just have to use it at a higher cadence.

### 2. The schema is too simplistic

The first Spinner draft produced ~3-5 fields per entity. A working bookkeeping system needs ~10-15 fields per entity, relationships with cardinality, the canonical reports the practice expects.

**Root cause:** the mission-lock I (Claude) wrote said _"build for THIS patron, not the textbook"_, _"don't over-design"_, _"if the patron told you cash only, do not add credit-card fields"_. The SI was doing exactly what it was told. **The instructions were wrong.**

**Fix landed in this turn:** mission-lock rewritten — the **schema discipline** section now reads _"Build the schema a competent practitioner would build for a paying client. The Webspinner prunes what they don't want — that's their next turn. Modesty is not your job; expertise is."_ With explicit examples (bookkeeping, gardening, donor logging, customer service) showing what generous looks like.

**Still pending:**

- The `propose` prompt in `weaver.ts:databaseAppPropose` says _"propose a starting database schema"_. Word "starting" needs to flip — _"propose the comprehensive schema a competent professional would build."_
- The `refine` prompt should match.
- The `build` narration should sound more confident.
- The `how-it-works.md` should match the new ambition.

### 3. Clarifying questions don't drive design

Questions like "Do you take cash, card, or both?" get answered but the schema barely changes in response. The patron's answers feel absorbed silently.

**Root cause:** the propose prompt says _"ask three or four focused clarifying questions about their specific situation."_ That's a **soft instruction** — the LLM picks questions that sound domain-appropriate but aren't bound to schema branches.

**Fix landed in this turn:** mission-lock now requires each clarifying question to **name the schema branch it gates**. _"Do you take credit cards?"_ gates the Payment-Methods enum + Card-Fee field. _"Do you have multiple locations?"_ gates the Location field on Transactions + Customers. Vague questions are now refused by the mission-lock.

**Still pending:** the `refine` prompt must enforce the branch — when the patron answers, the SI must narrate the concrete schema delta (_"You said cash-only, so I've removed the Card-Payments entity and the Card-Fee + Authorization-Number fields from Transactions."_). The current narration is too generic.

### 4. No relational concepts; no real CRUD

The current "Database Application" is a log, not a database. Each entity is standalone. The schema sometimes emits `links: [{to, describes}]` but:

- The LLM doesn't always include them.
- When it does, there's no cardinality, no owning-side, no foreign-key semantics.
- The `build` dispatcher creates plain text columns — not PocketBase `relation` fields.
- The renderer shows links as text — no searchable dropdown over linked records.
- Only Create exists. No Read-detail, no Update, no Delete. No CRUD matrix.

**Two distinct gates:** the mission-lock now requires explicit relationships with cardinality + owning side (fix landed); but the **build + renderer** need a `relation` kind that maps to PB's relation field + a searchable picker UI + full PATCH/DELETE/GET-by-id routes. That's R8.6 (still pending).

---

## The meta-question: is it the LLM, the embeddings, what?

**Not the model.** Qwen2.5-14B-Instruct on Kepler is competent. The bottleneck is **system design around the model**.

Seven structural changes that apply to every future Spinner, not just Database Application. Ordered by _leverage per unit work_:

| #     | Change                                                                                                                   | Leverage                                                                                                                                                                | Cost                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **1** | **Mission-lock posture flip** — "generous expertise + patron prunes" instead of "minimal viable + honour what they said" | High — changes the entire feel of the first draft                                                                                                                       | Zero (prompt rewrite)                                        |
| **2** | **Decompose phases into smaller LLM calls** — show the SI thinking                                                       | High — patron's perception of activity goes from 4 phase changes to 10+ over the same wall-clock                                                                        | Low (dispatcher refactor)                                    |
| **3** | **Add a Schema Critic step** — a second LLM call that critiques its own draft                                            | High — catches the missing relationships, the missing fields, the "you forgot category." This is where the "awesome SI" feel comes from — the SI noticing its own gaps. | Low (one extra Quiet Loom call per propose)                  |
| **4** | **Full CRUD matrix + relation kind in build + renderer** — the Wizard's #4 observation                                   | High — turns the demo from "log" to "database"                                                                                                                          | Medium (schema-driven renderer extension + new Loom routes)  |
| **5** | **Token streaming** — live cursor in the Observatory                                                                     | Medium — completes the "alive" feeling started by phase decomposition                                                                                                   | Medium (mlx-server SSE wiring + frontend streaming renderer) |
| **6** | **Foundation library of canonical schemas per domain** — bookkeeping shapes, gardening shapes, donor patterns            | High long-term — every Spinner reads from a curated corpus instead of guessing from a single Wikipedia article                                                          | High (corpus authoring; ongoing)                             |
| **7** | **Grammar-constrained sampling for strict JSON** — the model literally cannot emit invalid JSON                          | Medium — removes 100% of "model returned malformed JSON" failure modes                                                                                                  | Medium (mlx-server grammar config)                           |
| **8** | **Real WRAG pipeline** — reranker + grounding verification (per canon §4 stages 3, 6)                                    | Medium today; high when one Spinner is bottlenecked on quality                                                                                                          | High                                                         |

**The honest meta-message:** what the Wizard called "awesome SI" is not a model upgrade. It's an architecture upgrade. Qwen2.5-14B on Kepler can deliver patron experiences that feel meaningfully different from what shipped on 2026-05-16 — the substrate is sufficient. The shape of the work around it is what needs to change. And the changes generalise to every future Spinner; nothing is database-application-specific.

---

## State of work (as of 2026-05-17 mid-morning)

### Landed in this turn

- `~/warp/spinners/database-application/mission-lock.md` — full rewrite. Schema discipline flipped from minimal to generous expertise. Clarifying questions now must name a schema branch. Reports added as a first-class part of the schemaDraft. Narration tone shifted from cautious to confident professional advisor. VISION.md's three operative requirements quoted as the quality bar. Foundation Pledge / refused work / vocabulary discipline kept verbatim (operative law).

### Pending (next batch — paused for Wizard alignment first)

| Piece                                                    | What                                                                                                                                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `weaver.ts:databaseAppPropose` prompt                    | Replace "propose a starting database schema" with "propose the comprehensive schema a competent professional would build"; add explicit instruction to include relationships with cardinality + canonical reports per domain. |
| `weaver.ts:databaseAppRefine` prompt                     | Match the generous posture; enforce that each refine names the concrete schema delta produced by the patron's answers.                                                                                                        |
| `weaver.ts:databaseAppBuild` narration                   | Replace the modest "I created N record areas" with a confident "Your bookkeeping is live; the Profit & Loss runs the moment you record a transaction; the standard year-end summary is one click."                            |
| `~/warp/spinners/database-application/how-it-works.md`   | Update tone to match — confident professional voice; remove the "Limits, named plainly" framing where it under-sells (it's appropriate for genuine limits, not for under-promising).                                          |
| Re-sign + re-install the Spinner bundle in the Demo Cell | The bundle digest changed (mission-lock rewrite); the Weaver's integrity gate will refuse to invoke until `tools/demo-install-roster` re-signs and writes the new digest to the demo `wp_skein`.                              |

### Pending (the seven structural improvements — separate work)

In priority order, all from the table above. Each has its own DECISIONS entry when it lands.

---

## What to do next (when the Wizard signals to proceed)

1. **Wizard reviews the new mission-lock** and signals "go" or "adjust."
2. If "go": update the `weaver.ts` propose + refine + build prompts to match. Update `how-it-works.md`. Re-sign + re-install the Spinner in the Demo Cell. Run the bookkeeping flow end-to-end and verify the schema is now generous + the relationships have cardinality + the reports are declared.
3. Then: pick from the seven structural improvements — likely #2 (phase decomposition) first because it's the most visible "wow" win for the lowest code cost.

---

## A note on "Claude crashed after several days of work"

The original mission-lock was written by a prior Claude session in the 2026-05-16 work block, before the context-loss event that brought this current session in. That prior version embedded a "first, do no harm" / "honor exactly what they said" posture that ran counter to the canon's "exceeds what they imagined" intent. This is a real failure mode of LLM-authored artifacts: the model can drift toward conservative defaults that feel safe but undercut the Foundation's flagship promise.

**Defence against recurrence:** every mission-lock should be reviewed against `VISION.md`'s three operative requirements (works the first time / elegantly branded / delights and astounds) before sign + install. Pablo can be extended to do this — a `review-mission-lock` capability that walks a Spinner bundle's mission-lock against the canon and flags drift. Logged in `OPEN_QUESTIONS.md` as a follow-up.

---

_Authored 2026-05-17. The persistence the Wizard asked for. The Wizard signals when to proceed with the pending prompt + dispatcher updates._
