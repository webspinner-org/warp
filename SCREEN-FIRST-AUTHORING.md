# SCREEN-FIRST-AUTHORING.md — the SI as electricity

The Wizard's 2026-05-17 reframe of the Database Application Spinner's authoring flow. Captures the design talk that supersedes the schema-first approach in `SI-QUALITY-DESIGN.md` and the schema-driven runtime decision in `DECISIONS.md` 2026-05-16 (_Schema-driven Database Application runtime_).

When this conflicts with `WARP-CANON.md` or `VISION.md`, the canon wins. This document is operative _direction_ for the next architectural decision; the Wizard signals "go" before it becomes operative law.

---

## The reframe, verbatim

> _"Synthetic Intelligence has to be like electricity. It just works. While we need to give the patron a way to clarify the design, I think I may have misled you on the whole 'Schema' idea. What if instead of the Schema, we start with the modal forms of the application, and then when we have the screens write, we just 'take care of' the database based on the UX design?"_

This is the right framing. A non-technical Webspinner does not think in entities, fields, types, relationships. They think in _the form I fill out to record a transaction_ and _the screen I look at to see this month's books_. The SI's job is to give them those screens. The database is engineering. **Engineering is hidden by good design — like electricity.**

---

## What changes

### The authoring flow

**Before (schema-first):**

1. Spinner proposes `{entities, fields, links}` — abstract schema.
2. Patron answers clarifying questions about cardinality, types, fields.
3. Build creates PB collections from the schema.
4. A generic schema-driven renderer (tabs + table + Add modal) renders the patron's app.

**After (screen-first):**

1. Spinner proposes the **screens** that make up the patron's app — actual UI mockups, in their domain words. Forms (for entering data), lists (for browsing), details (for inspecting a single record), reports (for the canonical views the practice expects).
2. Patron sees screens and refines them in screen terms — _"rename this field,"_ _"add a yes/no for tax-exempt,"_ _"move this column to the right,"_ _"replace this text box with a dropdown of vendors,"_ _"add a year-end summary screen."_
3. Build derives the database shape from the screens: every field on every form implies a column; every dropdown implies a relationship or an enum; every list view implies a query; every report implies an aggregation. Build creates the PB collections + binds the screens to them.
4. Patron lands in their app — not in a generic table UI, but in the screens they designed.

### The Spinner's output shape

**Before**: `schemaDraft: { entities: [{ name, describes, fields: [...], links: [...] }] }`.

**After**: `screensDraft: [{ kind: 'form' | 'list' | 'detail' | 'report' | 'dashboard', name, displayName, layout: [...] }]`. Each screen carries its layout (fields with kinds + labels + descriptions, list columns, report aggregations). The schema is _implicit_; it's derivable from the screens but not the patron's concern.

A bookkeeping app's screens might be: _Record a Transaction_ (form), _Record an Invoice_ (form), _This Month's Transactions_ (list), _All Customers_ (list + filter), _Profit & Loss_ (report), _Year-End Summary_ (report). The schema falls out of those.

### The clarifying questions

Before, the questions were about schema branches: _"Do you take credit cards?"_ gates a Payment-Methods enum field. After, the questions are about **screens**: _"Should the transaction form have a 'card details' section, or just the amount?"_ — same answer, but the patron understands the question because they see the form. They can say _"yes, with a section for card type and last four digits"_ and the SI updates the form's fields directly. The schema mutation is implicit.

### The build step

Build becomes two coordinated acts: derive + instantiate.

1. **Derive the schema** from the screens. Static analysis of the screen layouts — every field on every form becomes a column on the entity that screen records. Every dropdown that points at _"a Customer"_ becomes a relation. Every list view's columns trace back to the entity's columns. Reports are SQL aggregations against the entity's collection.
2. **Instantiate the collections + bind the screens**. PB collections come from the derived schema. The screens become entries in a new `wp_application_screens` collection (one per screen) that the renderer reads to render the patron's app. The wp_database_applications row binds screens → entities → collections.

### The renderer

**Before**: a generic schema-driven renderer (entity tabs + table + Add modal) that worked for any schema.

**After**: a screen-driven renderer that reads `wp_application_screens` rows and renders each screen specifically. A _form_ screen renders its layout as inputs. A _list_ screen renders its columns + filter affordances. A _detail_ screen renders the fields with edit-in-place affordances. A _report_ screen renders the aggregated query.

The renderer becomes more specific (per-screen) but also more useful — the patron's _List of unpaid invoices_ screen actually looks like a list of unpaid invoices, not a generic table of "Invoices."

### The mission-lock

The current Database Application mission-lock (rewritten this morning) is about _schema discipline_. It needs another rewrite focused on _screen design discipline_:

- Propose the screens a competent professional would build for this domain — the forms, the lists, the details, the canonical reports. _Generously_; the patron prunes.
- Each clarifying question must name a screen-level decision (_"should the transaction form include a notes field?"_ gates the notes field on the form + the column on the derived schema).
- Narration in screen terms: _"I've drafted six screens — a transaction entry form, a customer entry form, a vendor form, a list of this month's transactions, a P&L report, and a year-end summary. The schema underneath supports all of that."_ The schema is mentioned as the supporting fact, not the patron's concern.

### The clarification UX

The clarifications modal becomes screen-relative. Instead of _"Do you take credit cards? [cash, card, both]"_, the patron sees the actual _Record a Transaction_ form mockup with a payment-method dropdown highlighted, and the modal asks _"Should the payment method dropdown include card details, or just the amount?"_ — with the form mockup visible behind. Their answer changes the form they're looking at, in real time.

This is closer to a Webflow or Figma-style edit-in-place than a Q&A.

---

## What doesn't change

The `CELL-ARCHITECTURE-NOTES.md` decisions stay operative:

- **Data layer**: PocketBase + SQLite for OLTP (still); DuckDB satellite for reports (still); embedded engines only (still). The schema is _derived_, not absent — and what gets derived still lands in PB collections. **No change to the storage decision.**
- **LLM choice**: still Qwen2.5-14B-Instruct-4bit on Kepler today; still host-adaptive selection for portable Cells; still no closed-API models on the patron path.
- **RAG strategy**: the Foundation library is still the highest-leverage SI-quality move. The library's content shifts from _canonical schemas per domain_ to _canonical screens per domain_. _"Here are the screens a small-business bookkeeping app typically has"_ is the corpus; the schema is derived per Cell, per patron.
- **Cell packaging**: Cell.app per platform, embedded engines, single data directory portable across hosts.
- **Sovereignty**: every reasoning step still on Kepler local LLMs; Anthropic / OpenAI still off the patron path.

The architecture below the patron-facing line is unchanged. The architecture above the patron-facing line gets re-shaped.

---

## What this means for the work in flight

### `~/warp/spinners/database-application/mission-lock.md`

The mission-lock was rewritten this morning (`310d140`) with the _generous-expertise + patron-prunes_ posture, but framed around **schema** as the patron-facing artifact. That framing now misses. The mission-lock needs **another rewrite** — same generosity-as-default discipline, but reframed around **screens** as the patron-facing artifact.

The schema-discipline section becomes a _derived_ concern (back-end, invisible to the patron, the SI handles). The new patron-facing discipline is **screen design discipline**:

- Every domain proposal starts with the screens (forms, lists, details, reports) — not the entities.
- Clarifications name screen decisions, not schema branches.
- Narration speaks in screens.

**The schema is still load-bearing in the SI's internal reasoning** — the SI has to know the data shape to design the screens. But it's a _tool_, not a _deliverable_.

### `weaver.ts:databaseAppPropose` + `databaseAppRefine` + `databaseAppBuild`

- Propose's output shape changes from `schemaDraft` to `screensDraft`. The Quiet Loom prompt asks for screens, not entities.
- Refine applies patron answers as screen-level edits, not field-level edits.
- Build derives the schema from the screens, creates collections, writes the screens to `wp_application_screens`, returns the patron's app URL.

### The schema-driven renderer (`Observatory` app mode in `app.js`)

Today it's a generic _entity-tabs + table + Add modal_ renderer. Per this reframe, it becomes a **screen-aware renderer**: each screen is rendered specifically per its kind. A form is a form; a list is a list; a report is a report. The renderer reads `wp_application_screens` instead of just the entity list.

### The frontend modal

The clarifications modal evolves from a Q&A form to an _edit-in-place_ affordance over the proposed screens. Patron sees the form mockup; modal asks about a specific element; patron's answer modifies the mockup live. Bigger UX lift; substantially better feel.

---

## Why this is right (and why I missed it)

The schema-first authoring flow comes from how _developers_ think: model the data first, then build the views. The screen-first flow comes from how _people who use software_ think: I have screens I fill in, screens I look at, screens that show me the truth.

The Foundation's audience is the people-who-use-software side. The schema-first flow exposes the _developer's_ mental model to a patron who doesn't share it. The screen-first flow exposes the _patron's_ mental model and hides the developer's.

Per VISION.md: _"The Wizard expresses intent in plain words. The Cell honors the intent with a working thing. Those tasks are below the level of intent the Wizard speaks at; the Cell handles them."_ Schema design is below the level of intent. The Cell should handle it.

The reason I missed this: I wrote a mission-lock and a runtime around the schema-first flow because that's the cleaner _engineering_ abstraction. But the cleaner engineering abstraction is not the same as the cleaner _patron_ abstraction. The Foundation's North Star is patron experience; the engineering follows.

**Electricity metaphor applies hard.** Nobody buying an appliance thinks about volts and amps. They think about what the appliance does. The Spinner's job is to be the appliance, not the wiring diagram.

---

## Open questions

1. **What's the canonical set of screen kinds?** I named _form / list / detail / report / dashboard_. That probably covers most use cases. Some domains may want more (calendar, kanban, map, timeline). The Foundation curates the canonical kinds; future Spinners can add new kinds with their own renderer plug-ins.

2. **How does the patron edit screens live?** The "edit-in-place" idea is appealing but big work. v1 might still use a clarifications modal with the screen-mockup visible, asking screen-level questions. v2 introduces direct manipulation (drag-drop, rename, re-order).

3. **What about screens that don't map to an entity?** Dashboards aggregate across entities. Reports aggregate. Some screens are pure analytics. The schema derivation has to handle this — those screens read from collections via SQL queries, not by 1:1 binding.

4. **How does the SI propose layouts?** A form has fields; what's the _order_? What's the _grouping_? Layout is part of UX. The SI has to propose more than the field list. The Foundation library of canonical screens per domain is what teaches it good layout.

5. **What about Spinners that don't produce database apps?** The Database Application archetype is screen-first; the _iPhone App_ / _Website_ / _Simple Game_ / _Custom AI Spinner_ archetypes have different output kinds. Screen-first is the right model for "build a tool the patron uses through screens." For _generate a marketing site_ or _author a small game_, the patron's mental model is different (page-first, level-first). The architecture should admit per-archetype mental models, not force one frame on all of them. Each Spinner's mission-lock + dispatcher knows what kind of artifact it produces.

6. **Where does the data live for ad-hoc / pure-text content?** A _Personal Journal_ Spinner might be screens that are mostly free text + photos. The schema is thin (entry, date, body, attachments). The screen-first frame still applies, but the _generous-schema_ discipline doesn't — sometimes the right answer _is_ minimal. The mission-lock has to admit this.

---

## What to do next (when the Wizard signals to proceed)

This is a bigger reframe than the morning's mission-lock flip. Order of work:

1. **Wizard confirms the screen-first direction is operative.** No more code until this is settled.
2. **Rewrite the mission-lock again** — screen discipline, not schema discipline. The schema-derivation section becomes a back-end concern in the mission-lock; the patron-facing primitives are screens.
3. **Redesign the `propose` / `refine` / `build` output shapes** in TypeScript. Define `ScreenDraft`, `ScreenKind`, `ScreenLayout`. The schema becomes a derived type. The JSON Schema for the SI's strict output mirrors the new shape.
4. **Update the dispatcher prompts in `weaver.ts`** to ask for screens. Include the canonical screen kinds, layout vocabulary, examples per domain. The build step gains a _derive-schema-from-screens_ phase.
5. **Update the renderer** to read `wp_application_screens` and render per-screen. The Add modal becomes per-form-screen, not per-entity.
6. **Start the Foundation library of canonical screens per domain.** Bookkeeping has these forms / lists / reports; gardening has these; donor management has these. Build the corpus.
7. **Defer the v2 edit-in-place clarification UX** — v1 ships the modal with the screen mockup visible, asking screen-level questions. Direct manipulation lands when the patron flow is otherwise stable.

The current Demo Cell's installed Spinner is still on yesterday's bundle digest (the morning's mission-lock change isn't deployed). When the screen-first work lands, it will be a single coherent re-deploy.

---

## A note on the prior posture

The schema-first design was authored by an earlier Claude session and ratified by the Wizard yesterday. The Wizard says _"I think I may have misled you on the whole Schema idea."_ In fact: he didn't mislead me; he was working through the design, and the deeper insight came when he saw what schema-first feels like to a patron. The fact that he could course-correct cleanly mid-week is exactly the kind of evolution the Foundation's iteration cadence (`STANCE.md` — _"daily iteration is the unit of progress"_) is built for. This document is the seam.

Yesterday's `DECISIONS.md` entry _"Schema-driven Database Application runtime — patron's app lives in the Observatory"_ still holds for its core claims (Observatory hosts the patron's app; cohesive UX; sovereignty by construction). What changes is the _abstraction the patron interacts with_ — screens instead of schema. A successor `DECISIONS.md` entry captures the shift when the Wizard signals to proceed.

---

_Authored 2026-05-17. Persisted at the Wizard's request before any code touches this redirection. The Wizard signals which sections become operative law._
