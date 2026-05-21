# Loom design — v2 flow (forms-first WYSIWYG)

Status: design-only, persisted for the Wizard to review. No code touched yet.

This document proposes an architectural change to how a Webspinner Cell authors a Webbase. The current flow has shipped — propose → clarifications → refine → build — and works, but two patron-facing problems are accumulating evidence:

1. The **Observatory schema cards** are a metaphor of the application, not the application itself. The patron evaluates a representation, not the thing. Decisions made against the metaphor sometimes fail to survive contact with the real running app.
2. The **clarifying-questions modal** has been inconsequential in practice — most patrons accept defaults; the questions slow the propose→build loop without reliably improving the result.

The new flow proposed here is forms-first. The patron sees the actual forms (rendered by the same engine the running app will use), edits them WYSIWYG, optionally chats with an LLM to make broader changes, and clicks Build when they are satisfied. Clarifying questions are removed.

This is faithful to the Warp architecture (canon §2 vocabulary, §17 production-candidate quality, §19 Spinners run capabilities). It builds on the renderer extraction in #58 — the same renderer that serves `/run/<code>` and the standalone download is reused in edit mode. Schema remains the canonical artifact; only the surface the patron sees while editing it changes.

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

## 5. LLM architecture

### 5.1 What we already have

- Anthropic Claude is wired (`loom/src/lib/server/anthropic.ts`).
- Capability dispatch in `weaver.ts:2547`: `propose | refine | build`.
- Per-Spinner `manifest.model` selects which model the dispatch calls.
- Local-Kepler MLX is wired as a fallback path, intentionally unused in the bootstrap Cell ("we only use Anthropic now to get the Spinner done" — operative principle).

### 5.2 What changes

Add one capability, remove the role of one, keep two:

| Capability | Role in v2                 | Notes                                                                                                                                                                                                                                                                                                     |
| ---------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `propose`  | Same shape, simpler prompt | Drops the clarifications synthesis. The prompt becomes: "Given this sentence, produce the most likely useful schema. Never ask the patron a clarifying question; pick reasonable defaults; the patron will edit afterwards." Output: `screensDraft` + `branding`. No `clarifications`, no `readyToBuild`. |
| `edit`     | **New**                    | Input: current `screensDraft` + patron's natural-language edit request + recent dialogue history. Output: updated `screensDraft` + a one-sentence narration of what changed ("I added a phone field to the customer form"). Used in the chat-driven editing loop.                                         |
| `refine`   | Deprecated, then removed   | Kept in the codebase for one cycle to honor in-flight sessions; new sessions never hit it. Eventually deleted.                                                                                                                                                                                            |
| `build`    | Unchanged                  | Reads the current `screensDraft` from the session; creates the PB collections + wp_database_applications row.                                                                                                                                                                                             |

### 5.3 What LLM to use for each

The Wizard's question. Empirical observations + the canon's "Anthropic until Kepler-local lands":

**Initial `propose` — synthesis from one sentence into a multi-entity, multi-screen schema.**

- Recommended: **Claude Sonnet 4.6** (`claude-sonnet-4-6`).
- Reasoning: this is the hard call. One sentence → ~10 screens, ~6–8 entities, ~50 fields, palette + navigation. Sonnet's strength is synthesis with structured output. Latency ~15–30s for a worked-out schema is acceptable on a one-time call. Cost per propose is low (~$0.02–0.05 estimated).
- Alternative: Opus 4.7 if the patron's sentence is gnarly. Auto-escalate when the proposed schema has fewer than 2 entities (i.e., the model couldn't decompose the domain) and re-call with Opus.

**Conversational `edit` — small, frequent transformations of an existing schema.**

- Recommended: **Claude Haiku 4.5** (`claude-haiku-4-5`).
- Reasoning: edits are local transforms. "Add a phone field" is a 50-line schema mutation against a 5000-line schema context. Haiku is ~10× faster (~1–2s round-trip) and ~10× cheaper than Sonnet at this shape. The patron will hit Send many times; Haiku is what makes that affordable and snappy. Haiku has the structured-JSON output discipline we need.
- Fallback: if Haiku returns invalid JSON or fails to apply (no field matches the patron's reference, etc.), one automatic retry on Sonnet with the same prompt. If that also fails, surface the failure honestly: "I couldn't make that change. Try rephrasing, or do it directly."

**Optional `redesign` — patron says "start over with a new sentence" or "I want this to be much bigger".**

- Recommended: **Claude Opus 4.7** (`claude-opus-4-7`).
- Reasoning: rare, expensive, deserves the heaviest reasoning. Patron-initiated only.

### 5.4 The chain in one paragraph

The patron's first sentence goes to **Sonnet**, which seeds the schema. From there, **Haiku** is the workhorse — every chat-driven edit, every retry, every iteration. **Opus** is on standby for the "redesign" verb or for a propose retry when Sonnet's first pass came out too thin. The patron never sees these names; they see "the Weaver." The model identifiers live in `manifest.model` per capability, exactly as today.

### 5.5 Future state (post-WWDC reassessment per `DECISIONS.md`)

When the Kepler GPU lands and MLX hosts a local model good enough for the `edit` shape, the chain becomes:

- `propose` → Sonnet (still cloud — synthesis-heavy)
- `edit` → Kepler-local MLX (the cheap iteration moves on-box)
- `build` → no LLM
- `redesign` → Opus (still cloud)

This is the operative principle "we use the LLMs… without any paid MCP LLM" cashed out concretely.

### 5.6 Prompt sketches (not the prompts themselves — the _shape_)

**propose** (Sonnet):

- System: "You are the Webspinner Database Application Spinner. Your job is to design a database application from a single patron sentence. Never ask clarifying questions. Pick the most useful defaults. Output JSON exactly matching this schema: { screensDraft, branding }. The patron will edit afterwards — design for editability, not for ambition."
- User: the patron's sentence.

**edit** (Haiku):

- System: "You are the Weaver. The patron is editing a Webbase via natural language. You produce JSON patches to a screensDraft. Output JSON: { screensDraft, narration, kind }. `kind` is 'edit' | 'clarify' | 'no-change'. If the patron asks a question, set kind='clarify' and answer in narration without touching the schema. If the patron's request is ambiguous (multiple ways to interpret), make the safest interpretation and say so in narration."
- User: current screensDraft + last 5 turns of dialogue + the new patron message.

**redesign** (Opus):

- System: "The patron wants a substantial redesign. Treat the existing schema as one option and the new sentence/intent as the brief. You may keep, modify, or discard the prior design."
- User: prior screensDraft + new sentence.

### 5.7 Structured output discipline

All three capabilities use Anthropic's tool-use / JSON-mode discipline to force-valid output. The frontend validates against the schema interfaces in `database-applications.ts:104` before accepting. Invalid output → automatic one-shot retry with the same prompt → if still invalid, surface honestly ("the Weaver returned something I couldn't apply; try rephrasing").

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

### 11.1 Existing sessions

Sessions currently in `phase: 'proposing'` or `'refining'` can complete via refine (kept alive). Sessions with `phase: 'ready'` or `'built'` are unaffected. Newly proposed sessions enter the new flow.

### 11.2 Feature flag

A single env var: `WARP_LOOM_FLOW=v2`. When set, the propose path drops clarifications and the editor mounts. When unset (or `v1`), the old flow runs. Both code paths coexist for one cycle.

The Wizard turns it on in his Cell first, lives with it for a few days, decides whether to flip the default.

### 11.3 What can be deleted after the flag flip

- `ClarificationsModal` UI (after v2 default for 2 weeks)
- `clarifications` field in the schema interface
- `refine` capability in dispatcher + `databaseAppRefine` (after 1 month)
- The "refining" phase enum value

### 11.4 What the patron sees on the transition

Nothing surprising. If they had an in-progress session in the old flow, they finish it the old way. New sessions get the new flow. The first time they hit Build in v2, they go through the same build animation they already know.

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

## 13. Open questions for the Wizard

Things this design takes a position on that you may want to push back on:

1. **Build doesn't lock.** Patrons can re-edit and rebuild as often as they like. Data is preserved on additive edits, lost on destructive ones (with a warning). Is that the right default, or should Build be one-way for v2 simplicity?

2. **The chat panel position.** I've put it below the form. An alternative is a slide-over drawer on the right (the current Weaver chat panel's slot in the studio). I prefer below-the-form because it keeps the form as the primary surface — the patron edits, then asks a question, then edits — and the chat is referential, not central. You may prefer the drawer.

3. **Sonnet for propose.** Or do we go straight to Opus on the first call? Sonnet is the safer first try; Opus is the heavier hitter. The auto-escalate-on-thin-schema rule in §5.3 is my hedge. Could be a flag.

4. **"What would you like to keep track of?" — same opener?** Or do we name the offering more concretely now that this is the path? "Tell me one sentence about the application you want and I'll draft it as forms you can edit."

5. **WYSIWYG editing of layout vs schema.** Renaming a field is a schema change. Reordering fields within a form is a layout change (no schema impact). Both happen in the same surface. Should we visually distinguish — different colour highlight on save, e.g. — so the patron sees which edits would migrate data and which are pure cosmetic?

6. **Reports.** Reports are the canon's wow-as-baseline lever for "the SI knew what I needed". They are currently rendered as report screens but the editor for _report content_ (which fields, group-by, aggregations) is not specified above. I'd push that to v2.1 — get forms editing solid first, then reports.

---

## 14. Summary

| Decision                                 | This design                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| What does the patron see first?          | The forms, rendered exactly as the live app will render them.                                                                              |
| What do they do?                         | Edit directly (click, drag, inline rename) OR chat with the Weaver.                                                                        |
| What model does the chat use?            | Haiku 4.5 — fast and cheap, fits the per-turn shape.                                                                                       |
| What model does the initial propose use? | Sonnet 4.6 — heavier synthesis for the one-shot start.                                                                                     |
| What model handles redesign?             | Opus 4.7 — patron-initiated only.                                                                                                          |
| When is the design "done"?               | The patron clicks **Build it**.                                                                                                            |
| What happens to clarifying questions?    | Removed. Defaults pick, patron edits.                                                                                                      |
| What stays?                              | The renderer (one component for /run and edit-mode), the schema as the canonical artifact, the build capability, the Spinner architecture. |
| What's added?                            | An `edit` capability, an editor mode on the renderer, a chat panel, a screens PATCH endpoint.                                              |
| What gets deleted (after one cycle)?     | Clarifications UI + field + the refine capability.                                                                                         |

This is a tractable change. The hard part — patron-sovereignty, standalone download, identity, file browser, delete actions — is shipped. The remaining work is mostly composition: turn the renderer we have into an editor, add a chat, swap one Spinner capability for another.

Read this when you have time. Push back on §13. When you signal go, I'll break this into tasks and start with the renderer's `editable` prop (smallest unit, biggest enabler).

— Composed 2026-05-20 by the Loom session. Faithful to WARP-CANON §2, §17, §19. Builds on #58 (renderer extraction) and the 2026-05-20 Loom rename.
