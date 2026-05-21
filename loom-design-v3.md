# Loom design — Phase 3: WRAG training from patron iterations

Status: design-only. v3 in the sequence — v1 = the current production flow, v2 = forms-first + local-LLM (see `loom-design.md`), v3 = this document. v3 builds on v2.1 and does not replace it.

The motivation: v2.1 introduced a local LLM chain (Qwen Coder via MLX) and a retrieval step (BGE-M3 against a Foundation precedent library). That library is **seeded** by the Foundation and **grown manually** by the Wizard. v3 makes it grow **automatically from patron iterations**.

Every successful Webbase a patron builds — and every edit dialogue that produced it — is data. Today that data dies with the session. v3 captures it, curates it, and feeds the best of it back into the same WRAG retrieval the next patron's `propose` call will pull from. The Loom gets better at what it does the more it does it. Same model weights, smarter context.

This is not fine-tuning. It is **precedent accumulation**. The model is fixed; the _examples in its context window_ grow richer.

---

## 1. Why phase 3 needs a separate document

v2.1 is a coherent ship. It can land without v3 and the Loom is still better than v1. v3 layers on top:

- v2.1 needs to ship before v3 has any signal to capture. There must first be patron sessions producing schemas before there's anything to learn from.
- v3 involves patron-data-handling questions (consent, anonymisation, cross-Cell sharing) that the v2.1 design didn't have to face. Those questions deserve their own treatment, not a footnote.
- v3 touches the WRAG architecture, the federation question (which is summer-2026 work per `DECISIONS.md`), and the Foundation Pledge — bigger surface than v2.1.

Treating v3 as a separate phase keeps v2.1 shippable now and v3 in flight as a separate decision.

---

## 2. What "training" means here — and what it doesn't

### 2.1 What it means

- **Precedent accumulation.** Successful patron schemas become new entries in the Foundation precedent library that future `propose` calls retrieve against.
- **Edit-pattern extraction.** Recurring (patron-sentence → schema-patch) pairs from edit dialogues become a second-tier retrieval surface — when a future patron says "add a phone number field" the local LLM gets actual examples of what previous edits looked like, not just the prompt template.
- **Curation, versioning, decay.** Bad precedents are removed. Old precedents that no longer match the design discipline are deprecated. The library has a heartbeat, not a graveyard.

### 2.2 What it does NOT mean

- **No model fine-tuning.** Qwen Coder's weights are unchanged. We are not training a new model. We have neither the compute nor the dataset volume for that to be useful, and the risks (forgetting, regression, drift) outweigh the modest gain a small fine-tune would buy over rich retrieval.
- **No adversarial inference about the patron.** We capture (anonymously, per §6) what the patron _made_, not who they are.
- **No always-on auto-promote.** Every promotion to precedent passes through a curation step (auto-quality-filter + optional Wizard review). The patron's session is not silently exfiltrated.

The discipline: WRAG learns from what the Foundation curates from patron sessions. Patrons opt in. The Foundation owns the library; patrons own their apps.

---

## 3. The two kinds of learning

### 3.1 Schema precedents — for `propose`

A schema precedent is one full Webbase: a patron sentence, the final schemaDraft, optionally the branding choice. v2.1's library is 15-20 of these, hand-seeded.

After v3, the library grows from each successful build that the patron consents to share. Curation lifts a session to a precedent. Future `propose` calls retrieve against the larger library.

Effect: a patron who says "track customer orders for my food truck" eventually finds that the closest precedents are _other patrons' food-truck schemas_, not the Foundation's seed CRM. The synthesis improves because the analogies sharpen.

### 3.2 Edit precedents — for `edit`

This is the new piece v3 introduces. The chat-driven edit loop in v2.1 sends `current schemaDraft + patron edit-request` to the local 7B model. v3 adds a retrieval step in front of that:

- BGE-M3 embeds the patron's edit request.
- Top-K matches against an **edit-precedent index**: triples of `(natural-language request, before-schema-fragment, after-schema-fragment)`.
- The retrieved edit-precedents go into the local LLM's context as concrete examples of what kind of patch this kind of request produces.
- The LLM still produces the actual patch, but with informed priors.

Edit-precedents are extracted automatically from dialogues that survived to build. A turn is a candidate if:

- The patron's request was natural language (not a direct GUI edit).
- The LLM's output was applied (no undo within the next 3 turns).
- The session eventually built (the patron clicked Build, didn't abandon).

Effect: the most common edits — adding fields, reordering sections, splitting forms, renaming entities — accumulate examples in the library. The 7B model gets ~10× more leverage on the common shapes.

---

## 4. Capture — what we record per session

A wp_session_captures collection sits next to wp_spinner_sessions. One row per session that the patron consented to share. Fields:

```
{
  session_id,
  patron_email_hash,     // SHA-256(email + cell_salt), one-way, per §6
  cell_id,
  consent_granted_at,    // null if no consent — row not captured
  consent_revoked_at,    // patron can revoke; promoted precedents are then withdrawn
  initial_sentence,
  precedents_retrieved,  // which precedents the retrieval surfaced for this patron
  propose_output_schema, // initial schemaDraft from propose
  dialogue_turns: [
    { patron_text, before_schema_hash, after_schema_hash, applied, survived_3_turns, ts }
  ],
  final_schema,
  built_at,
  built_app_id,          // wp_database_applications row id, when built
  branding_choice,
  build_outcome,         // 'built' | 'abandoned' | 'redesign'
  quality_signals: { ... }   // see §5.2
}
```

Capture is opt-in (per §6). When opt-in, every Spinner call writes a turn row. When opt-out, nothing is captured beyond what wp_spinner_sessions already needs to function.

Patron names, free-text data entered into the running app, and any patron-identifying info are excluded from the capture. We capture the _design_, not the _use_.

---

## 5. Curation — from captured session to precedent

The pipeline runs nightly on the Foundation Cell (and any federated Cell that opts to contribute). Three stages.

### 5.1 Quality filter (automatic)

Reject capture rows that don't meet basic quality bars before any human looks at them:

- `build_outcome != 'built'` → reject (patron didn't finish).
- `dialogue_turns` count > 50 → reject (probably a stuck session).
- `final_schema` has < 2 entities → reject (likely under-developed).
- `final_schema` has > 30 entities → reject (likely runaway).
- Edit dialogue has > 10 consecutive undo/redo flips → reject (patron was wrestling, not designing).
- Patron used redesign (full reset) more than once → reject (the iteration didn't converge).

These thresholds get tuned. They are conservative on day 1 — better to reject useful sessions than promote bad ones.

### 5.2 Quality signals (scored, not gates)

Surviving rows get a composite quality score. Signals:

- **Convergence:** dialogue turns trend toward fewer schema changes per turn (the patron stopped editing, started using).
- **Coverage:** the final schema has all the canonical-domain entities a competent practitioner would have. Compared against the Foundation precedent's expected entity count for the inferred domain.
- **Use:** if the patron used the built app (entered records, opened it multiple times) post-build, score boost. Patrons don't keep apps they don't use.
- **Edit survival:** edit-dialogue patches that survived to build, weighted by recency.

Score is a 0-100 number. The Wizard sees it in the Operations console.

### 5.3 Curation (decision)

A row's quality score gates the curation path:

- Score ≥ 80: candidate for **auto-promote** if the Wizard has set `WRAG_AUTO_PROMOTE=true` for the Cell. Otherwise lands in the Wizard's review queue.
- Score 50–79: Wizard review queue, with the score and a one-line summary.
- Score < 50: dropped silently.

Wizard review is a single admin page: a list of candidates, each with the patron sentence, a thumbnail of the schema (renderer reuse), and Promote / Reject / Modify buttons. Modify lands the schema in a `tools/foundation-precedent-add` workflow with a chance to edit the narrative before adding.

Edit-precedents go through a parallel pipeline: an edit turn that survived 3+ turns and contributed to a built session is a candidate, scored by pattern recurrence (how often does this kind of request show up in other sessions).

### 5.4 Promotion

Promoted schema precedents are added to `~/warp/foundation-precedents/<slug>/` with the same shape as the seed precedents (`schema.json` + `narrative.md`). BGE-M3 re-embeds the new entries. The index gets re-built (small enough to rebuild from scratch in seconds at bootstrap scale; incremental updates when Qdrant lands).

Promoted edit precedents go to `~/warp/foundation-edit-precedents/<id>/` as JSON triples + a one-line narrative.

Both are versioned. A precedent has a created-at, a promoted-by (auto or Wizard), and a source-session reference (for revocation; see §6.3).

---

## 6. Consent, anonymisation, sovereignty

This is the section the Foundation Pledge insists on. Three principles cashed out concretely.

### 6.1 Opt-in, never default

Capture is off until the patron flips it on. Two ways:

- **Session-level prompt** at first sign-in to the Loom: "Would you let the Foundation learn from your designs? Your finished Webbases (anonymised) might help future patrons build theirs. You can change this anytime." Default: off.
- **Per-session toggle** in the editor's footer: "Sharing on" / "Sharing off." Patron can flip mid-session.

When off, no row in wp_session_captures is created. When flipped from off → on mid-session, only turns from that point forward are captured (no retroactive collection).

### 6.2 Anonymisation, structurally

What's captured:

- **The design.** Patron sentence, schema, dialogue turns. These describe _what the patron asked for_.

What's never captured:

- **The data.** Anything entered into the running Webbase. IndexedDB content. The actual customer names, garden plants, transaction amounts.
- **Personally identifying info beyond a one-way hash.** Email hashed with a per-Cell salt (so even the Foundation can't reverse it without the Cell's salt).
- **Network metadata.** No IP capture, no user-agent, no precise timestamps beyond minute granularity.

The patron's sentence and dialogue _are_ preserved verbatim — that's what makes the capture useful. The Wizard's review queue surfaces these. If a sentence contains identifying info ("track inventory for John's Pet Store on Main Street") that's the patron's choice; the Foundation may redact during curation.

### 6.3 Revocation

Patrons can withdraw consent retroactively. The session's capture row is deleted. Any precedent promoted from that session is _withdrawn_ (file removed, index rebuilt). Future patrons no longer retrieve against that precedent.

Mechanism: a "Forget this session" link in the patron's Account Status panel (already shipped per the 2026-05-20 work). One click, confirmation, gone.

### 6.4 The patron-sovereignty argument

This is consistent with the Pledge:

- The patron owns the Webbase. Always.
- The patron owns the _design intent_ of the Webbase. They choose whether to share it.
- The Foundation owns the _curated library_. It can publish, share, version, deprecate. But it cannot publish without patron consent.

Federation extends this: Cell A's library can grow from Cell A's patrons. Cell A may publish its library to other Cells (opt-in at the Cell-Wizard level too). The Foundation Cell is the canonical publisher — Cell-Wizards subscribe.

---

## 7. Federation — Cell-local vs Foundation-shared

v2.1's precedent library is per-Cell, seeded from a Foundation-shipped baseline. v3 must say how growth flows.

### 7.1 Two registries

- **Cell-local library** — every Cell carries its own precedent index. v3 captures and curates within the Cell. The Cell's `propose` calls retrieve against its own library first.
- **Foundation library** — the Foundation publishes a curated, versioned bundle of precedents. Cells subscribe and pull updates. The Foundation library is the union of:
  - The hand-seeded baseline (v2.1).
  - The Foundation Cell's own promoted precedents.
  - Curated contributions from federated Cells that opted to contribute.

A Cell can choose to:

- Retrieve from its own library only (privacy-maximal).
- Retrieve from its own library + the Foundation library (default; the larger context wins).
- Contribute promoted precedents back to the Foundation library (opt-in at the Cell-Wizard level).

### 7.2 Trust and quality

The Foundation library is _gated_. A Cell's contribution is reviewed at the Foundation before it's published. This is the same gate the Wizard's review queue applies locally — extended one level up. A precedent the Foundation publishes carries an implicit "the Foundation believes this is a good example of what a Webbase looks like."

Bad precedents are deprecated, not deleted. A `deprecated_at` field on the precedent means: still searchable in archives, never returned by retrieval. This matters when the Foundation realises a precedent reflected last-quarter's design discipline that's no longer canon.

### 7.3 Timing

The Cell-local capture + curation lands in v3.0. The Foundation-shared registry lands when federation does — summer 2026 per `DECISIONS.md` 2026-05-10. Until then, each Cell grows its own library and the Foundation Cell happens to be the only one populating it.

---

## 8. Retrieval architecture, updated

v2.1's retrieval was: `patron sentence → BGE-M3 → top-3 precedents → into prompt`.

v3 extends this in two ways.

### 8.1 Multi-source retrieval

For `propose`:

```
patron sentence ─▶ BGE-M3 ─┬─▶ Cell library (top-3)
                            │
                            ├─▶ Foundation library (top-3)
                            │
                            └─▶ Edit-precedent library (top-3, for the edit chain)
                                  │
                                  ▼
                       deduped + re-ranked union
                                  │
                                  ▼
                          top-5 into prompt
```

Re-ranker: BGE-reranker-v2-Gemma per the canon's stack. Boosts precedents that match on more than the embedding's surface-level similarity — entity-count fit, domain-overlap, etc.

### 8.2 Edit-time retrieval

For `edit` — the new bit:

```
patron edit-request ─▶ BGE-M3 ─▶ Edit-precedent library (top-3)
                                       │
                                       ▼
                            into 7B model's context
                                  +
                       current schemaDraft (always)
                                  +
                       last 5 dialogue turns (always)
```

The 7B model produces better patches when it sees concrete examples of what kind of patch this kind of request usually produces.

### 8.3 The seven-stage WRAG pipeline

Per `WARP-CANON.md` §16 (WRAG chapter): the canonical pipeline is seven stages. v2.1 used a simplified subset; v3 fills it in:

1. **Query analysis** — classify the patron's intent (new app vs edit vs question).
2. **Multi-source retrieval** — Cell + Foundation + Edit precedents.
3. **Re-ranking** — BGE-reranker-v2.
4. **Context assembly** — prompt template + top-K precedents + system+user.
5. **Generation** — local Qwen Coder, with cloud fallback per v2.1 §5.5.
6. **Validation** — JSON schema validation; retry; fallback.
7. **Capture** — write to wp_session_captures if consent is granted.

v3 lights up stages 1, 3, and 7. Stages 2, 4, 5, 6 already exist from v2.1.

---

## 9. Implementation order — staged build

Phase 3 is itself three steps. Each is shippable and useful on its own.

### 9.1 v3.0 — Passive capture

- `wp_session_captures` collection.
- Capture hooks in propose / edit / build that write rows when consent is granted.
- Patron-facing consent prompt + per-session toggle.
- Account Status panel: "Sharing: on/off" + "Forget this session" link.

No retrieval changes. No curation yet. This is just turning on the recorder.

Value: data accumulates. Even before curation lands, the Wizard can hand-pick interesting sessions and promote them via the existing `tools/foundation-precedent-add`.

### 9.2 v3.1 — Curation queue + auto-promote

- Nightly curation job: quality filter + score + promotion.
- Wizard review page at `/admin/wrag/queue`: list of candidates, scoreboard, Promote / Reject / Modify.
- `WRAG_AUTO_PROMOTE=true` env switch for high-score auto-promotion (the Wizard sets it once trust is calibrated).
- Re-embedding + index rebuild on promotion.

Value: the library grows without constant Wizard attention.

### 9.3 v3.2 — Edit precedents + edit-time retrieval

- Edit-precedent extraction from captured dialogues.
- `wp_edit_precedents` collection or filesystem layout under `~/warp/foundation-edit-precedents/`.
- BGE-M3 indexing of edit precedents.
- Wire retrieval into the `edit` capability's prompt.

Value: the edit loop in the chat panel gets noticeably sharper as the library grows. Patrons' second-week-of-use chat edits "just work" more often.

### 9.4 v3.3 — Federation registry

- Foundation-published precedent bundle, signed, versioned.
- Cell subscription mechanism: `tools/foundation-precedents-pull` fetches and verifies.
- Cell contribution mechanism: `tools/foundation-precedents-contribute` submits a promoted precedent for Foundation review.
- Lands when federation lands (summer 2026 per `DECISIONS.md`).

---

## 10. What the patron sees

Almost nothing different. The new surfaces:

- **Account Status panel** (already shipped) gains a "Sharing" row with on/off toggle and a "Forget this session" link per session.
- **First sign-in to the Loom** gets a one-time consent card — same modal pattern as splash, single yes/no choice, "you can change this anytime."

Otherwise, the patron's experience is identical to v2.1. The Loom just gets better at its job over time without the patron noticing why.

---

## 11. What the Wizard sees

- **Admin / WRAG queue** at `/admin/wrag/queue` — the curation review surface. Candidate sessions with scores, promote/reject buttons, occasional notification when high-score candidates land.
- **Admin / WRAG library** at `/admin/wrag/library` — read view of the active precedent library. Cell-local entries, Foundation-published entries, deprecated entries (greyed). Click an entry to see its schema, narrative, source.
- **Admin / Operations log** gains rows of kind `wrag.capture`, `wrag.curate`, `wrag.promote`, `wrag.deprecate`. Auditable like everything else.

---

## 12. Quality bar — when this is working

The signals that v3 is delivering value:

1. **`propose` quality improves over time.** A `propose` call's output six months in produces less wrong schemas than month-one. Measured by: fewer destructive edits in the subsequent edit dialogue, faster convergence to Build.
2. **`edit` calls land more often.** The 7B model with edit-precedent retrieval produces valid-and-applied patches at a higher rate than the 7B model alone. Measured by: fewer cloud-fallbacks, fewer undos.
3. **The Foundation library grows but doesn't bloat.** Precedent count climbs steadily; deprecated count also climbs as old entries age out. The library stays curated, not hoarded.
4. **Patrons opt in.** If the consent prompt yields < 30% opt-in, the value proposition isn't clear enough; the prompt copy needs sharpening, not the mechanism abandoning.

---

## 13. What this does NOT change

To name the things that stay:

- The renderer (one component for /run, edit-mode, and standalone download). Unchanged from v2.1 + #58.
- The schema interface in `database-applications.ts:104`. Unchanged.
- The local LLM chain (Qwen Coder 32B + 7B, MLX serving). Unchanged from v2.1.
- The cloud-fallback policy. Unchanged.
- The build capability. Unchanged.
- The Foundation Pledge. Unchanged; v3 is what the Pledge looks like applied to the learning loop.

---

## 14. Open questions for the Wizard

Things this design takes a position on that may need pushback.

1. **Opt-in default.** I've set the default to _off_. The Pledge-friendly choice. Alternative: default-on with a prominent off-toggle. Default-on would yield substantially more data but would lean against the Pledge's spirit.

2. **Per-Cell vs federated growth.** I've sequenced the federation registry as v3.3, after Cell-local capture/curate/promote. Alternative: design the federation registry first, treat every Cell-local library as a fork of the Foundation library. Slower to v3.0 ship, cleaner long-term shape.

3. **Email hashing salt.** Per §6.2 I've proposed a per-Cell salt for the email hash. That makes cross-Cell reidentification impossible. Alternative: a Foundation-global salt — enables the Foundation to detect when the same patron operates Webbases across multiple Cells (useful for some federation-time bookkeeping). I lean per-Cell; you may want the global salt.

4. **Auto-promote threshold.** I've put it at score ≥ 80. That number is uncalibrated — there's no data yet. v3.1 should ship with auto-promote off by default; the Wizard turns it on after eyeballing 50 promotions and getting a feel for what 80 means.

5. **Bad-precedent recovery.** A precedent that turns out to be bad (misleading, off-canon, just wrong) is deprecated. What about precedents that were _retrieved by past patrons_ before the deprecation? Their schemas already incorporate the bad analogy. Do nothing? Surface a "this schema was influenced by a deprecated precedent — review when you have a moment" banner? I lean do-nothing — the schema is the patron's now, judge it on its own merits.

6. **Foundation-published bundle signing.** When the federation registry lands (v3.3), the Foundation library is signed (Ed25519, same as Webbase bundles per #58). Cells verify before installing. I haven't specified the key-rotation story for the Foundation library; it should follow the cell-key rotation we already have. Not urgent for v3.0–v3.2.

---

## 15. Summary

| Aspect                   | v2.1 (loom-design.md)                          | v3 (this document)                                                         |
| ------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------- |
| Precedent library source | Hand-seeded by Foundation                      | Hand-seeded + curated from patron sessions                                 |
| Library growth           | Wizard runs `tools/foundation-precedent-add`   | Automatic capture + curation, Wizard reviews                               |
| Edit support             | LLM produces patches from prompt + schemaDraft | LLM produces patches from prompt + schemaDraft + retrieved edit-precedents |
| Federation               | Cell-local                                     | Cell-local + opt-in Foundation publish/subscribe (summer 2026)             |
| Patron consent           | Implicit (their session, their data)           | Explicit (opt-in capture, can revoke)                                      |
| WRAG pipeline            | 4 of 7 stages                                  | All 7 stages                                                               |
| Effect over time         | Static                                         | The Loom gets better at its job                                            |

The bet of phase 3: **the precedent library is the asset.** A 32B local model with a rich, well-curated, growing library of precedents beats a frontier cloud model with no domain context. v2.1 made that bet structurally. v3 is what cashes it in over time.

This is design only. v2.1 ships first; v3.0 lights up after v2.1 has been live long enough for the consent prompt to feel like a real choice (not "what's even being captured?"). When the Wizard signals go, the order of build is v3.0 → v3.1 → v3.2 → v3.3.

— Composed 2026-05-20 by the Loom session. Faithful to WARP-CANON §2 (vocabulary), §11–§12 (Pledge + Covenant), §16 (WRAG chapter), §19 (Spinner architecture). Builds on `loom-design.md` v2.1 and on the patron-sovereignty work shipped 2026-05-19/20.
