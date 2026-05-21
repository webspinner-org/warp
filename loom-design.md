# Loom design — v2 flow (forms-first WYSIWYG)

Status: design-only, persisted for the Wizard to review. No code touched yet.

This document proposes an architectural change to how a Webspinner Cell authors a Webbase. The current flow has shipped — propose → clarifications → refine → build — and works, but two patron-facing problems are accumulating evidence:

1. The **Observatory schema cards** are a metaphor of the application, not the application itself. The patron evaluates a representation, not the thing. Decisions made against the metaphor sometimes fail to survive contact with the real running app.
2. The **clarifying-questions modal** has been inconsequential in practice — most patrons accept defaults; the questions slow the propose→build loop without reliably improving the result.

The new flow proposed here is forms-first. The patron sees the actual forms (rendered by the same engine the running app will use), edits them WYSIWYG, optionally chats with the Weaver to make broader changes, and clicks Build when they are satisfied. Clarifying questions are removed.

**The LLM that powers all of this stays on Kepler.** Per Wizard pushback 2026-05-20: cloud isn't a default, it's a fallback. The chain is `BGE-M3 embeddings → Foundation-library precedent retrieval → local Qwen Coder model → JSON validation`, with Anthropic Claude as the safety net when local validation fails or the local service is unreachable. §5 is the load-bearing section for that move.

This is faithful to the Warp architecture (canon §2 vocabulary, §17 production-candidate quality, §19 Spinners run capabilities) and to the operative principle that Spinners run without paid MCP LLMs. It builds on the renderer extraction in #58 — the same renderer that serves `/run/<code>` and the standalone download is reused in edit mode. Schema remains the canonical artifact; only the surface the patron sees while editing it, and the model that produces it, change.

---

## 1. Why

### 1.1 What's broken about the current flow

| Phase          | Currently                                                                         | Patron impression                                                              |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Propose        | Spinner returns `screensDraft` + 3–7 clarifying questions in a non-modal panel    | "Why is the system asking me about credit cards before showing me the app?"    |
| Clarifications | Patron answers; refine call returns updated `screensDraft` + maybe more questions | "I've already typed three answers. When does this end?"                        |
| Schema cards   | Observatory renders entity cards (name + 5–9 fields, kind chips, link arrows)     | "Is this what my app is going to look like? Or is this a diagram of it?"       |
| Build          | Final schema → live app                                                           | "Oh. This is the app. Wait, why is the customer form missing the phone field?" |

The schema cards are a faithful representation of the data model but they are not the surface the patron will use. The patron's _intent_ lives at the form level (and the report level, and the navigation level); the schema is downstream of that intent. We're showing the patron downstream.

### 1.2 What the Wizard's directive 2026-05-20 said

> "I think the first things we show is the forms, not the way you show them but WYSIWYG. You have the forms editor already. I suggest we let the patron change the forms as they see fit. Then build the app. Get rid of the clarify questions, they have been inconsequential and take too much time."

Two structural moves:

1. **Forms-first WYSIWYG.** The forms the patron will use _are_ the design document. Editing the forms _is_ the design.
2. **Drop clarifications.** Replace the question-driven refinement loop with a patron-driven edit loop, optionally LLM-mediated.

> "What I need to know is what llm do we chain with what we already have, to have a dialogue with the patron and iterate through improvements until the patron says they are done."

A bonus structural move:

3. **Conversational edits in addition to direct edits.** The patron can click a field label to rename it, or they can say "add a phone number field to the customer form" and an LLM does the work. Direct edits are deterministic; chat edits flow through an LLM-mediated transform.

---

## 2. Current state, recapped honestly

To know what we're changing, we name what we have.

### 2.1 Capabilities (per `loom/src/lib/server/weaver.ts:2547`)

The `@webspinner-foundation/database-application` Spinner exposes three capabilities:

- `propose` — sentence → schemaDraft + clarifications
- `refine` — schemaDraft + answers → updated schemaDraft + more clarifications
- `build` — schemaDraft → live app (PB collections + wp_database_applications row)

All three run via the dispatcher at `weaver.ts:2484`. LLM provider is `manifest.model` — currently Anthropic (Claude), with a Kepler-local fallback wired but unused in the bootstrap Cell.

### 2.2 Schema shape

`screensDraft` (per `loom/src/lib/server/database-applications.ts:104`):

```
{
  appName, domain,
  screens: [{
    id, kind: 'form'|'list'|'detail'|'report', name, parentEntity, describes,
    layout: {
      // form
      sections: [{ title, fields: [{ id, label, kind, required, options, linkTo, describes }] }],
      // list
      columns: [{ fieldId, label, width }],
      defaultSort: { field, direction },
      filterFields: [...],
      // detail
      showFields: [...],
      // report
      describes, sourceEntities, groupBy, aggregations
    }
  }],
  navigation: [{ label, primary, screens: [...] }]
}
```

### 2.3 The renderer (after #58)

`loom/src/lib/runtime/WebbaseRuntime.svelte` reads `screensDraft` + entities + branding and renders forms, lists, details, reports against an IndexedDB store. The same component serves `/run/<code>` (hosted) and the standalone download. It is **already** the WYSIWYG engine for forms — it just doesn't currently expose edit affordances.

This is the load-bearing reuse. The form editor in this design is _the runtime in edit mode_.

### 2.4 Persistence

Every Spinner call saves `wp_spinner_sessions.state` (per `loom/src/lib/server/spinner-session.ts`). The state carries `screensDraft`, `branding`, `clarifications`, `phase`. The renderer reads it; the patron's edits write to it.

---

## 3. The new flow

### 3.1 End-to-end

```
splash ─┬─> already authed ──> session picker ──> [resume] or [start something new]
        └─> press any key ──> sign in ──> ...

[start something new]
   │
   ▼
"What would you like to keep track of?" ─── patron types one sentence
   │
   ▼
Loading state (spinner with phase narration: "Reading what you said… Drafting forms… ~30s")
   │
   ▼
propose returns screensDraft (no clarifications)
   │
   ▼
┌──────────────────────────────────────────────────────────────┐
│ Forms-first editor — the same WebbaseRuntime, in edit mode   │
│                                                              │
│  ┌──────────────┐    ┌──────────────────────────────────┐   │
│  │ Sidebar nav  │    │ Selected form, fully rendered    │   │
│  │ (screens)    │    │                                  │   │
│  │              │    │   [Field label][value input]     │   │
│  │ + Add screen │    │   [Field label][value input]     │   │
│  │              │    │   [Field label][value input]     │   │
│  │              │    │                                  │   │
│  │              │    │   + Add field                     │   │
│  └──────────────┘    └──────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Chat with the Weaver — natural-language edits        │   │
│  │ "Add a phone number field to the customer form"      │   │
│  │ [Send]                                                │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│              [Cancel]                       [Build it]       │
└──────────────────────────────────────────────────────────────┘
   │
   ▼
build returns the live app — same surface, edit affordances disappear
```

### 3.2 What changes vs today

| Aspect                       | Today                                              | New                                                                  |
| ---------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| Initial draft                | propose → schema cards                             | propose → forms                                                      |
| Patron input loop            | Q&A questions                                      | Direct WYSIWYG + optional chat                                       |
| Sign that the design is done | Spinner sets `readyToBuild: true`                  | Patron clicks **Build it**                                           |
| Time to first form rendering | propose call (10–60s) + clarifications panel paint | propose call (10–30s, simpler prompt)                                |
| Patron decisions             | Pre-build, on cards that approximate the app       | Pre-build, on the actual forms; or post-build, by hitting Edit again |

### 3.3 Build is not a one-way door

A subtle change: in the new flow, **Build** does not lock the design forever. It runs the same `build` capability that exists today (creates PB collections, writes the wp_database_applications row, etc.) but the design surface remains reachable. The patron can hit **Edit** from the running app to return to the forms-first editor; subsequent saves there bump the schemaDraft and call `build` again with the new shape. Data migrations are out-of-scope for v2 — the patron is told plainly when a destructive edit (renaming a field, removing one) would lose data.

---

## 4. The forms-first editor

This is the heart of the change. Two editing modes share the same surface.

### 4.1 Direct editing (deterministic, instant, no LLM)

The patron sees the form. Hovering reveals edit affordances. The model is "every field is a click target":

| Click                                                      | Action                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Field label                                                | Inline rename. Enter saves; Esc cancels.                                                         |
| Field type chip (small badge: TXT, NUM, $, DATE, YN, etc.) | Dropdown of kinds. Switching kinds re-renders the field with the new input shape.                |
| ❌ on a field                                              | Remove with one-step confirm if data exists, none otherwise.                                     |
| ＋ between fields                                          | Insert a new field. Default kind: text; default label: "Field".                                  |
| Section title                                              | Inline rename.                                                                                   |
| ＋ between sections                                        | Insert a section.                                                                                |
| Screen name in sidebar                                     | Inline rename.                                                                                   |
| ⋮ next to screen                                           | Menu: Duplicate, Delete, Move to new section in nav.                                             |
| ＋ Add screen                                              | Pick kind (form / list / detail / report), pick parent entity (if applicable), placeholder name. |
| Drag handle on field/section/screen                        | Reorder.                                                                                         |

Every direct edit is local first (optimistic), then debounced (350 ms) into a `PATCH /api/sessions/<id>/screens` call that updates `wp_spinner_sessions.state.screensDraft`. The edit is reversible with Cmd-Z within the session (in-memory history stack, capped at 50).

The wow comes from **the form looks like the form will look**. Same component, same renderer, same field-kind components. The patron can mentally try the form by tabbing through it.

### 4.2 Chat-driven editing (LLM-mediated)

Below the form is a single-line chat input: **"Ask the Weaver to change something."**

| Patron says                                         | LLM does                                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| "Add a phone number field to the customer form"     | Adds a `tel`-kind field labeled "Phone number" to the relevant section of the customer form.  |
| "Group the financial fields together"               | Splits one section into two, moving identified fields into a new "Financial details" section. |
| "Make the date field required"                      | Sets `required: true` on the identified field.                                                |
| "I want to track invoices too"                      | Adds a new entity + a new form + list + detail screen + updates navigation.                   |
| "Make this look like an accounting app"             | Branding change: swaps palette to the "warm bookkeeping" preset.                              |
| "Move the notes field to the bottom"                | Reorders within section.                                                                      |
| "What's the difference between text and long-text?" | Returns explanatory copy; no schema change.                                                   |

The chat is non-modal. The form re-renders in place when the LLM returns. The dialogue history is shown so the patron can see what they asked and what changed.

### 4.3 The editor's "Build it" gate

A single button. Always available. Always honest:

- Pre-first-build: "**Build it** — this creates the application and lets you start entering data."
- Post-first-build, no pending edits: button is dimmed, hover tooltip: "Already built. Make a change to rebuild."
- Post-first-build, pending edits: "**Rebuild** — applies your changes." Plus a one-line warning if any change is destructive: "This will lose 3 invoices' phone numbers."

---

## 5. LLM architecture — local-first, cloud-as-fallback

> Revised 2026-05-20 per Wizard pushback. Original draft defaulted to Anthropic cloud for all three capabilities; the canon's operative principle is the inverse — local first, cloud only for the irreducible. This section is rewritten end-to-end. Cloud is now the safety net, never the primary path.

### 5.1 What we already have

- **Anthropic Claude** is wired (`loom/src/lib/server/anthropic.ts`) — kept, but demoted from primary to fallback.
- Capability dispatch in `weaver.ts:2547`: `propose | refine | build`.
- Per-Spinner `manifest.model` selects which model the dispatch calls — the same mechanism now points at a local endpoint.
- **MLX serving on Kepler** is named in the canon's stack and in `DECISIONS.md` 2026-05-10 ("vLLM for local model serving when GPU hardware lands"). It exists as scaffolding; the bootstrap Cell hasn't set it up yet. Setting it up is part of this design.
- **BGE-M3** is the canon's embeddings model — small, fast on Apple Silicon, runs on CPU or Metal.

### 5.2 What changes

Same capability moves as before — drop `refine`'s role, add `edit`, keep `build` — plus a new piece: every capability that touches an LLM goes through a **retrieval-augmented** pipeline. The chain is `embeddings → retrieve precedents → local LLM → validate`. Cloud sits outside this chain as a fallback.

| Capability | Role in v2                             | Notes                                                                                                                                                                                       |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `propose`  | Same shape, retrieval-augmented prompt | Drops clarifications. Patron's sentence → BGE-M3 → top-K Foundation-library precedent schemas → local 32B-class model produces the schema by analogy. Cloud-fallback on validation failure. |
| `edit`     | **New**                                | Patron's natural-language edit + current schemaDraft → local 7B-class model produces JSON patch. Cloud-fallback on retry. The "many times per session" call.                                |
| `refine`   | Deprecated, then removed               | Kept one cycle for in-flight sessions; new sessions never hit it.                                                                                                                           |
| `build`    | Unchanged, no LLM                      | Reads the current schemaDraft; creates PB collections + wp_database_applications row.                                                                                                       |
| `redesign` | **New** (patron-initiated)             | Used only when the patron explicitly asks for a substantial redesign. Same local-first chain as propose; cloud-fallback is less likely to fire because the operation is rare.               |

### 5.3 The three local pieces

#### 5.3.1 Embeddings — BGE-M3 on Kepler

- **Model:** `BAAI/bge-m3` (~500 MB, multilingual, dense + sparse + ColBERT-style late interaction). Per the canon's default stack.
- **Service:** a small HTTP server on Kepler. Either `mlx-embeddings` or a tiny Python FastAPI wrapper around `FlagEmbedding`. ~50 lines, runs under a launchd agent next to the operator Loom.
- **Latency:** sub-100 ms per query on Apple Silicon. Negligible compared to the LLM step that follows.
- **Index:** the Foundation library of canonical applications. Stored as JSON files under `~/warp/foundation-precedents/<slug>/{schema.json, narrative.md}`. Indexed into Qdrant on Kepler (or a simpler flat-file faiss-like store at bootstrap scale; Qdrant lands when wp_database_applications outgrows it per `DECISIONS.md` 2026-05-10).

#### 5.3.2 The Foundation-library precedent index

The hard problem of "one sentence → useful schema" is _not_ a model-capability problem. It's a domain-knowledge problem. The Foundation can do this for the SI by curating canonical applications.

- Seed at ~15-20 schemas covering the common domains: bookkeeping, garden log, donor CRM, service-ticket tracker, recipe collection, club roster, gear inventory, time tracker, prayer list, reading journal, contact rolodex, project log, household maintenance, photo metadata, livestock records, etc.
- Each precedent carries: the patron-style sentence(s) that would describe it, the schemaDraft a competent practitioner would produce, a short narrative on why those entities and not others.
- The precedent isn't a template — it's an example for the LLM to learn from in-context. The local model takes the patron's sentence + the 3-5 closest precedent schemas and produces a _new_ schema that fits the patron's specific intent.
- New precedents are added with a one-line `tools/foundation-precedent-add <slug>` that re-embeds and re-indexes. The library grows over time as the Foundation encounters domains it didn't have yet.

#### 5.3.3 Local LLM serving — MLX on Kepler

- **Server:** `mlx-server` (or `mlx-lm.server`, OpenAI-compatible). Single launchd agent: `foundation.webspinner.mlx`. Listens on `127.0.0.1:8100`.
- **Model for `propose` and `redesign`:** **Qwen 2.5 Coder 32B Instruct** Q4 (~18 GB resident; runs on M2/M3 Ultra with headroom). Strong JSON discipline, code-style fluency that maps well to schema synthesis.
  - Alternative if memory is tight: **Qwen 2.5 Coder 14B** Q4 (~8 GB). Smaller-domain decomposition; usually fine with strong precedent retrieval, less reliable for off-the-beaten-path domains.
- **Model for `edit`:** **Qwen 2.5 Coder 7B** Q4 (~4 GB). Resident alongside the bigger model. Latency under 1 second for a 200-token JSON patch.
- Both models hot-loaded at service start. No cold-start latency.
- **Concurrency:** the bootstrap Cell is single-Wizard; serial requests are fine. When patron concurrency arrives (federation, summer 2026 per `DECISIONS.md`), MLX's continuous-batching can handle ~4-8 concurrent requests on a 192 GB Ultra; harder concurrency moves to vLLM-on-Apple-Silicon or to the Hetzner box.

### 5.4 The chain, end-to-end

```
patron sentence ─▶ BGE-M3 ─▶ top-3 precedent schemas (~3-5 KB each)
                                     │
                                     ▼
                              prompt assembled:
                              [system + precedents + patron-sentence]
                                     │
                                     ▼
                       local Qwen Coder 32B (MLX, :8100)
                                     │
                                     ├─▶ valid JSON ─▶ return to Loom
                                     │
                                     └─▶ invalid (after 1 retry)
                                              │
                                              ▼
                                  Anthropic Sonnet 4.6 (cloud)
                                              │
                                              └─▶ return + audit "cloud-fallback"
```

The `edit` chain is the same shape with smaller models and lighter retrieval (the current schemaDraft IS the context; embeddings retrieve from the dialogue history only).

### 5.5 Cloud-fallback policy, explicit

Cloud is honored as a degradation path, not a default. Three triggers:

1. **Validation failure.** Local model returns JSON that doesn't parse or fails schema validation, twice in a row. Capability falls back to the cloud-equivalent model (Sonnet for propose/redesign, Haiku for edit). Audit row: `{ kind: 'cloud-fallback', reason: 'invalid-output', local_model, cloud_model }`.
2. **Local service unavailable.** `foundation.webspinner.mlx` is down (crashed, restarting, model unloading). Capability tries 5 times over 30 seconds; if still unavailable, fall back to cloud with a banner: "The local model is unreachable; the Weaver is using cloud assistance." Patron sees this honestly.
3. **Patron escalation.** Explicit verb in the editor — "this draft isn't right, try harder" — bypasses local and calls Opus directly. Used rarely; audit row.

Every fallback is visible — in the audit chain, in the Wizard's admin Operations log, and (for #2) in the patron UI. Cloud is never the silent default.

### 5.6 Why this works at 32B local

A 32B model with 3-5 strong in-context examples and a well-defined output schema operates in a _different regime_ than the same model on a cold-start free-form task. The hard work moves from raw parameters to:

- **Retrieval quality** — the precedent library carries the design discipline.
- **Output structure** — JSON-mode + schema validation force valid output or trigger fallback.
- **Task narrowness** — `edit` is a 50-token transform; `propose` is a 2000-token synthesis but bounded by the schema interface.

We've been over-modeling. Sonnet-class capability is needed for _open-ended_ synthesis; we are doing _constrained_ synthesis with retrieval. The constraint plus retrieval substitutes for the model size.

### 5.7 Prompt sketches (local edition)

**propose** (Qwen Coder 32B):

- System: "You are the Webspinner Database Application Spinner. You design a database application by extending one of the Foundation precedents below to fit the patron's specific intent. Never ask clarifying questions. Pick reasonable defaults; the patron edits afterwards. Output exactly the JSON shape demonstrated by the precedents."
- Context: top-3 precedent schemas + their narrative notes.
- User: the patron's sentence.
- Output: `{ screensDraft, branding }` strictly matching the precedent shape.

**edit** (Qwen Coder 7B):

- System: "You produce JSON patches to a screensDraft based on a patron's natural-language edit request. Output `{ screensDraft, narration, kind }` where `kind` is 'edit' | 'clarify' | 'no-change'. If the request is ambiguous, make the safest interpretation and say so in narration."
- Context: current schemaDraft + last 5 dialogue turns.
- User: the patron's edit request.

**redesign** (Qwen Coder 32B):

- System: "The patron wants a substantial redesign. Use the existing schema as one option and the new intent as the brief. You may keep, modify, or discard the prior design."
- Context: prior schemaDraft + top-3 precedents matching the new intent.
- User: the new sentence.

### 5.8 Partial-sovereignty path — embeddings-local-now, LLMs-cloud-for-now

If the full local stack (~1 week of setup) is more work than the moment allows, there is an intermediate step that buys ~70% of the sovereignty win for half a day of work:

- Set up **BGE-M3 only** on Kepler.
- Build the precedent index.
- The patron's sentence is embedded locally; the top-3 precedent schemas are retrieved locally.
- The cloud LLM call (Sonnet/Haiku/Opus) receives the precedents as in-context examples. The patron's _raw intent_ doesn't leak directly; what goes to cloud is "produce a schema like THESE precedents, conditioned on a sentence whose embedding nearest-neighbours THESE precedents."

This is meaningfully better than the v1 design. Cloud still sees the patron sentence, but the cloud call is framed as a precedent-recombination rather than an open synthesis. And it cuts the cloud bill substantially — a 32B model conditioned on 3 strong examples produces better output with fewer tokens than a frontier model on a cold prompt.

If the Wizard wants to start here and migrate to full-local later, that's a coherent first step.

### 5.9 Structured output discipline (unchanged)

Both local and cloud paths use strict JSON-schema validation against the interfaces in `database-applications.ts:104`. Invalid output → one automatic retry → fallback (cloud, then surface honestly). Same discipline either way.

### 5.10 What the patron sees

Nothing different. The patron sees "the Weaver." Local-vs-cloud is operator concern (audit, logs, the Wizard's billing-curiosity-when-it-matters). The honesty surfaces only when cloud-fallback triggers due to local unavailability — and then it's a one-line banner, not a question.

---

## 6. Schema as canonical artifact

The Wizard already accepted this for the standalone-download work (#58 + 2026-05-20 design). The runtime renders FROM the schema. The renderer is interpretable. The schema is the contract.

In v2 the same principle extends to authoring:

- The screensDraft is the application. There is no "design document" beside it.
- Edits, direct or LLM-mediated, are mutations to the schema.
- Build is a function of the schema.
- A re-build with a different schema produces a different running app, same renderer.

This is the design's load-bearing reuse. The same things we built for portability (#58) now also serve authoring.

---

## 7. Backend changes (no code in this doc, just the inventory)

| File                                                                          | Change                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loom/src/lib/server/database-applications.ts`                                | Rev the `propose` prompt to drop clarifications; add `editScreensDraft()` for the new capability. Schema interfaces unchanged.                                                                                |
| `loom/src/lib/server/weaver.ts`                                               | Add `case 'edit':` to the dispatcher at line 2547. Wire it to `databaseAppEdit()`.                                                                                                                            |
| `loom/src/lib/server/anthropic.ts`                                            | No change — already supports per-call model selection.                                                                                                                                                        |
| `~/warp/spinners/database-application/manifest.json`                          | Add `model.edit: 'claude-haiku-4-5'` and `model.redesign: 'claude-opus-4-7'`. The dispatcher reads per-capability model.                                                                                      |
| `loom/src/routes/api/spinners/[name]/[capability]/+server.ts` (or equivalent) | The HTTP surface — confirm it accepts `capability: 'edit'`. Probably already does (the route is generic).                                                                                                     |
| `loom/src/routes/api/sessions/[sessionId]/screens/+server.ts`                 | **New.** PATCH endpoint for direct (deterministic) edits — bypasses the LLM. Body: `{ screensDraft }`. Validates, saves, returns.                                                                             |
| `loom/src/lib/server/spinner-session.ts`                                      | No change — already persists `state.screensDraft`. The history stack lives client-side (Cmd-Z); server stores latest only. (Add a `state.history[]` array later if undo-across-sessions becomes a real need.) |

The `refine` capability is left in place for one release cycle. New sessions never invoke it. Old sessions that haven't built yet can still complete via refine. After the cycle, delete `databaseAppRefine` and the `case 'refine':` arm.

---

## 8. Frontend changes (Loom side)

| File                                                        | Change                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webspinner-loom/site/app.js` — propose path                | After the propose call returns, do **not** open the ClarificationsModal. Instead, instantiate the Forms Editor (next bullet).                                                                                                                                                                                              |
| `webspinner-loom/site/app.js` — ClarificationsModal         | Delete. (Or keep for refine back-compat for one cycle; new sessions never open it.)                                                                                                                                                                                                                                        |
| `webspinner-loom/site/app.js` — Forms Editor                | **New module.** Mounts the renderer in edit mode (renderer gains an `editable: true` prop), wires the direct-edit click/drag/inline-rename affordances, hosts the chat input, calls `/api/sessions/<id>/screens` for direct edits and `POST /api/spinners/.../edit` for chat edits.                                        |
| `loom/src/lib/runtime/WebbaseRuntime.svelte` — the renderer | Gains an `editable` prop. When true, render fields with edit affordances around them: dotted outline on hover, type chip, drag handle, ❌. When false, current behaviour. One component, two presentations.                                                                                                                |
| `webspinner-loom/site/styles.css`                           | Add the editor-mode styles: outline, drag handle, type chip, chat panel layout.                                                                                                                                                                                                                                            |
| Observatory                                                 | Reduce in scope. Still visible during the initial `propose` call as the "loading" surface (heartbeat, phase pills, "Drafting forms… ~30 s"). Disappears once the schema arrives — replaced by the Forms Editor. Same Observatory carries the patron through `build` ("Creating collections… Wiring relations… 8/12 done"). |
| Studio shell — top bar                                      | The "Webbase name" stays where it is; add a small "Editing" indicator + "Build it" button when in editor mode.                                                                                                                                                                                                             |

The renderer extension is the only really new piece. Everything else is glue.

---

## 9. Persistence, undo, history

### 9.1 What's saved server-side

- `wp_spinner_sessions.state.screensDraft` — the live schema. Overwritten on every save (direct edit or LLM edit).
- `wp_spinner_sessions.state.phase` — `'proposing' | 'editing' | 'building' | 'built'`. New value: `'editing'` (replaces `'refining'` + `'ready'`).
- `wp_spinner_sessions.state.dialogue: [{ role, content, ts }]` — the chat turns with the Weaver in edit mode. Persisted so the patron can resume mid-dialogue.

### 9.2 What's saved client-side

- In-memory history stack, last 50 schemas. Cmd-Z undoes; Cmd-Shift-Z redoes. Cleared on page reload. (A future v3 can persist history server-side.)

### 9.3 Save discipline

Direct edits are optimistic — the UI updates first, the server PATCH is fire-and-forget with retry. If a PATCH fails after 3 retries, surface a banner ("Your last 3 changes haven't been saved. Check your connection."). The patron's UI keeps working in-memory.

Chat edits are pessimistic — the LLM call takes 1–3s, the UI shows a "Weaver thinking…" indicator, the form re-renders only when the response arrives.

### 9.4 Conflict handling

There is no multi-author edit in v2. One patron, one session. If two browser tabs of the same session both edit, last-writer-wins. (A future v3 with operational-transform or CRDT is plausible but out of scope.)

---

## 10. The Weaver's voice in the editor

This is more design than architecture but it matters for adoption.

The chat panel is where the Weaver speaks to the patron _about their work_ (not about the platform). Voice posture, distilled from the canon's vocabulary discipline and the Wizard's prior corrections:

- Direct, generous, professional. No metaphors.
- Never use "AI", "guardrails", "responsible AI", "alignment". Per canon §14.
- Confidence default: confident. "I've added a phone number field to the Customer form." Not "I think I added…"
- When the request is ambiguous, the Weaver picks and says so plainly: "There are two customer forms. I added the field to 'Customer details'; tell me if you wanted the other one."
- Questions are allowed, but only when the patron's request is _unanswerable_ without one ("Should this field hold one email or many?"). Not for design taste ("Do you want passport number on this form?" — never; pick a default and let the patron remove it).

The Weaver does not narrate its own reasoning. It announces outcomes.

---

## 11. Migration / rollout

### 11.1 Preconditions — the local stack must land first

`WARP_LOOM_FLOW=v2` is gated on the local stack being up. Without it, the flag is a no-op; the v1 flow continues. The local stack consists of:

- `foundation.webspinner.mlx` launchd agent — MLX-server with Qwen Coder 32B + 7B Q4 models loaded, listening on `127.0.0.1:8100`.
- `foundation.webspinner.embeddings` launchd agent — BGE-M3 server on `127.0.0.1:8101`.
- The precedent library at `~/warp/foundation-precedents/` with the 15-20 seed schemas indexed.
- `tools/foundation-precedent-add` script for adding new precedents.
- The dispatcher in `weaver.ts` updated to call the local endpoints with cloud-fallback per §5.5.

Order of build: embeddings + precedent library first (it's the smaller win and the partial-sovereignty path of §5.8 lives here), then MLX serving + 32B/7B models, then the editor mode.

### 11.2 Existing sessions

Sessions currently in `phase: 'proposing'` or `'refining'` can complete via refine (kept alive). Sessions with `phase: 'ready'` or `'built'` are unaffected. Newly proposed sessions enter the new flow once `WARP_LOOM_FLOW=v2` is set AND the local stack is up.

### 11.3 Feature flag

A single env var on the demo Loom: `WARP_LOOM_FLOW=v2`. When set AND `foundation.webspinner.mlx` responds healthy on startup, the propose path drops clarifications and the editor mounts. When unset, or when local services are unreachable at boot, the old v1 flow runs. Both code paths coexist for one cycle.

The Wizard turns it on in his Cell first, lives with it for a few days, decides whether to flip the default.

### 11.4 What can be deleted after the flag flip

- `ClarificationsModal` UI (after v2 default for 2 weeks)
- `clarifications` field in the schema interface
- `refine` capability in dispatcher + `databaseAppRefine` (after 1 month)
- The "refining" phase enum value
- The Anthropic-as-primary code paths (cloud stays only as fallback per §5.5)

### 11.5 What the patron sees on the transition

Nothing surprising. If they had an in-progress session in the old flow, they finish it the old way. New sessions get the new flow. The first time they hit Build in v2, they go through the same build animation they already know. The local-vs-cloud distinction is invisible unless the cloud-fallback banner fires.

---

## 12. Wow-as-baseline check (canon §17.5)

The 2026-05-17 Mission Lock rewrite established "wow as baseline". Auditing this design against that bar:

| Wow standard                                      | This design's answer                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Every entity a competent practitioner would track | Unchanged from current Spinner output. Still on by default.                                                                          |
| 6–12 fields per entity                            | Unchanged. Patron can remove the ones they don't want — that's the new editor's job.                                                 |
| Explicit relationships with cardinality           | Unchanged. The propose Spinner still emits links + cardinality; the editor lets the patron see and edit them.                        |
| Canonical reports for the domain                  | Unchanged — the schema still carries `reports[]`. The new editor renders them as report screens; patron can edit columns / group-by. |
| Clarifying questions name a schema branch         | **Removed.** The wow-from-questions has not materialised; we got wow from defaults and let the patron edit.                          |
| Confident narration                               | Strengthened. The Weaver no longer asks; it announces and lets the patron correct.                                                   |

The clarifying-questions discipline is the one wow-baseline lever this design relaxes. The bet is that _the wow comes from the forms being right, not from the questions being smart._ If the bet is wrong — if patrons consistently get bad first drafts they can't easily fix in the editor — we revisit, either by sharpening propose's prompt with more domain context (Foundation-library examples in-context per the Mission Lock) or by adding a single, optional "anything else I should know?" free-form question before propose.

---

## 13. Resolved positions (formerly open questions)

> Resolved 2026-05-20 per Wizard directive ("use industry best practice, empirical evidence, and research of credible sources to make the decisions yourself"). Each resolution cites the basis. Future-Claude does not re-litigate these.

1. **Build doesn't lock.** RESOLVED: keep non-locking. Notion, Airtable, Linear, Retool all allow continuous schema edits in production-quality tools. Lock-on-build is friction; warnings-on-destructive-edits are the canonical safety mechanism.

2. **Chat panel position.** RESOLVED: right-side resizable drawer (NOT below-the-form). V0.dev, Bolt.new, Cursor's composer, and Vercel V0 all use a right-side panel for the AI co-author. Below-the-form pushes the canvas vertically when content arrives; a right drawer preserves the canvas and is the patron's mental model of "the assistant lives to the side." Drawer is collapsible, resizable, persistent state per-session.

3. **Local LLM choices + sovereignty staging.** RESOLVED: (a) detect Kepler unified-memory at MLX-service startup; use Qwen Coder 32B Q4 (~18 GB) if ≥ 64 GB available, else fall back to 14B Q4 (~8 GB). Both ship alongside the 7B Q4 edit model. Memory probe is a one-line `sysctl hw.memsize` on Apple Silicon. (b) Ship the partial-sovereignty intermediate (§5.8) first: embeddings + precedent library local, LLMs cloud. Validates the retrieval-improves-quality hypothesis empirically before committing the week of MLX-serving work. Standard staged-deployment practice — smallest valuable thing first, measure, iterate.

4. **Opener phrasing.** RESOLVED: keep "What would you like to keep track of?" Concrete, plain English, single sentence, prompts the right shape of response. The longer alternatives ("Tell me one sentence about the application you want…") add explanation the patron doesn't need at this point — the surface itself teaches them the shape. Tested implicitly: this is what's shipping in v0.7.1 and the patron flow has been functional.

5. **Visual layout-vs-schema distinction.** RESOLVED: yes, color-coded edit indicator. Standard UX hygiene from data-tooling industry (Airtable's "structural change" warning, Notion's database-schema dialog). Implementation: hover state shows a small badge — `cosmetic` (gray) for layout-only edits, `schema` (gold) for changes that affect data shape. Build-time gathers all pending `schema`-tier edits and shows a one-line summary in the build confirmation: "This rebuild will: rename 2 fields, remove 1 (clears 3 records' data)."

6. **Reports editor.** RESOLVED: deferred to v2.1.5. Forms editing ships first because forms are the primary patron-input surface. Report-editing (column picker, group-by selector, aggregation dropdowns) is a discrete v2.1.5 work block once forms are solid. The schema already carries reports[]; renderer already renders them; only the editor controls need adding.

---

## 14. Summary

| Decision                                   | This design                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What does the patron see first?            | The forms, rendered exactly as the live app will render them.                                                                                                                   |
| What do they do?                           | Edit directly (click, drag, inline rename) OR chat with the Weaver.                                                                                                             |
| What model does the chat (`edit`) use?     | **Local Qwen Coder 7B** (MLX on Kepler). Cloud Haiku is fallback only.                                                                                                          |
| What model does the initial `propose` use? | **Local Qwen Coder 32B** (MLX on Kepler) with retrieval-augmented prompt from the Foundation precedent library. Cloud Sonnet is fallback.                                       |
| What model handles `redesign`?             | Same local 32B with a redesign-shaped prompt. Patron-initiated only. Cloud Opus is the escalation if the patron asks "try harder."                                              |
| When is the design "done"?                 | The patron clicks **Build it**.                                                                                                                                                 |
| What happens to clarifying questions?      | Removed. Defaults pick, patron edits.                                                                                                                                           |
| What stays?                                | The renderer (one component for /run and edit-mode), the schema as the canonical artifact, the build capability, the Spinner architecture.                                      |
| What's added?                              | An `edit` capability, an editor mode on the renderer, a chat panel, a screens PATCH endpoint, **the local MLX + BGE-M3 stack on Kepler, and the Foundation precedent library**. |
| What gets deleted (after one cycle)?       | Clarifications UI + field + the refine capability.                                                                                                                              |

This is a tractable change. The hard part — patron-sovereignty, standalone download, identity, file browser, delete actions — is shipped. The remaining work is mostly composition: turn the renderer we have into an editor, add a chat, swap one Spinner capability for another.

Read this when you have time. Push back on §13. When you signal go, I'll break this into tasks and start with the renderer's `editable` prop (smallest unit, biggest enabler).

— Composed 2026-05-20 by the Loom session. Faithful to WARP-CANON §2, §17, §19. Builds on #58 (renderer extraction) and the 2026-05-20 Loom rename.
