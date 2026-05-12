# VISION.md — what Webspinner is for

The operative promise. Read this with `STANCE.md` (how we work),
`STANDARDS.md` (what we build to), and `IMPLEMENTATION-PLAN.md`
(the path through it). This file is the *why*.

When this file conflicts with `WARP-CANON.md`, the canon wins.
Update this file when the promise grows.

---

## The promise

**Normal people deserve real power through the effective use of AI.
The Webspinner Foundation built the architecture to make that real.**

One sentence from a Wizard becomes a working application. Authoring
is a conversation — the Cell asks, the Wizard answers, the artifact
appears. What the Cell produces works the first time, is elegantly
branded by default, and delights and astounds the author.

The audience is not engineers. Not platform teams. People who own a
business, an idea, a craft, a calling. The Wizard expresses intent in
plain words. The Cell honors the intent with a working thing.

---

## The three first authoring archetypes

The Wizard's words. These are the shapes the first authored Spinners
take. They are real use cases; demonstrating them is the work.

### 1. A complete website from one sentence

> *"I want a website for my bakery in Asheville that sells sourdough
> and pies and lets people preorder."*

The Cell produces a deployable static site — brand-aligned, well-
typed, accessibility-checked — with a preorder form bound to a
Cell-hosted microservice. The Wizard never opens a code editor.
The Wizard never picks a colour palette. The Wizard never wires a
form to a backend. Those tasks are below the level of intent the
Wizard speaks at; the Cell handles them.

### 2. An embeddable form with full microservice binding

> *"I need a contact form on my professional services site that
> captures lead source and budget range."*

The Cell produces a form snippet ready to embed in any host site,
plus a microservice endpoint that receives, validates, audits, and
routes submissions. The form's JSON Schema, its Svelte renderer,
its endpoint manifest, its data-binding, its email-notify path —
all generated. The Wizard pastes one snippet. It works.

### 3. A whole-application package

> *"Create an integrated accounting package for my small business."*

The Cell knows what this implies — General Ledger, Accounts
Payable, Accounts Receivable, invoice + statement production, check
writing, financial statements — because the Cell carries industry
best-practice patterns as Spools the authoring conversation draws
from. It produces the application as a composed set of Spinners +
Warp Threads + Spools + Loom surfaces. The Wizard's small business
runs on it.

These three archetypes are not exhaustive. They are exemplary. Any
Spinner the Foundation ships should serve a comparably-sized intent.

---

## The authoring conversation

A Spinner is an Input–Process–Output atom. A Wizard who has never
written code does not produce an I-P-O atom by typing JSON. The
Cell scaffolds the atom through dialogue.

The pattern, in five turns:

1. **The Wizard speaks one sentence.** Intent in plain words.
2. **The Cell searches the Skein and the Foundation library** for
   the closest matching precedent. *Webspinner has done something
   like this before; here is the shape we know works.*
3. **The Cell proposes a starting point** and surfaces a dynamic
   form of clarifying questions — the questions are specific to the
   precedent, not generic.
4. **The Wizard answers.** The form adapts as answers arrive
   (questions reveal questions). The artifact specializes.
5. **The Cell produces the artifact.** Pablo reviews the UX,
   Bootstrap audits the prose, the artifact is staged through
   draft → reviewed → audited → polished → delivered. What lands in
   front of the Wizard is the polished version. It is the artifact.

If the Wizard says *"make it more X,"* the Cell adapts. The
conversation continues. The Wizard never sees scaffolding, never
sees an error, never sees an "incomplete" intermediate. The Cell's
internal stages are private; the Wizard sees only the artifact, and
only when it is ready.

---

## The quality bar

Three operative requirements, named by the Wizard, binding on every
patron-facing artifact:

1. **Works the first time.** There is no "v0 ships rough, v1
   polishes it" pattern. The first thing the Wizard sees is the
   polished thing. Pablo runs before delivery; Bootstrap runs before
   delivery; the staging gate is the quality gate.

2. **Elegantly branded.** The Foundation's design discipline — dark
   canvas, gold and cyan, manuscript voice, em-dashes preserved,
   WCAG AA, AAA on prose — is the default. The Wizard does not
   choose this; the Wizard receives this.

3. **Delights and astounds.** Every artifact exceeds what the Wizard
   imagined when they spoke the sentence. Defaults are excellent.
   Edge cases are designed. Error states are illustrated. The
   Wizard's reaction is *"how did you know I needed that?"*

The bar is high deliberately. The Foundation's differentiation against
contemporary AI tooling is precisely this: every other tool ships
something usable and asks the user to refine. Webspinner ships
something *finished* and asks the Wizard if they want to refine
further. The default state is good.

---

## What this vision implies for the implementation work

A consequence map. Each is reflected in `STANDARDS.md` and
`IMPLEMENTATION-PLAN.md`.

- **The first authored Spinners are not operator-internal tooling.**
  Essay-drafting, journal-recording, Cell-provisioning — those are
  the substrate. The first Spinners we *demonstrate* are the
  archetypes above. The plan's Tier 1.3 templates retarget
  accordingly.

- **The authoring conversation is itself a Spinner.** The "meta-
  Spinner" that takes a Wizard's sentence and produces a new
  Spinner is the architectural primitive that turns a one-Wizard
  Cell into a non-technical-Wizard's tool. It uses precedent
  retrieval (Spool reads against the Foundation library), dynamic
  form generation, and the same I-P-O contract every other Spinner
  uses.

- **The Foundation library is unbounded.** Today it has Pablo's
  design-rules library. It must grow to carry industry-best-practice
  patterns — accounting, intake forms, donor tracking, e-commerce,
  CRM, education, etc. Each pattern is a Spool. Precedent-based
  authoring depends on this corpus existing.

- **Pablo and Bootstrap are reviewers, not just authors' tools.**
  Pablo gates every UI-producing Spinner's output. Bootstrap gates
  every prose-producing Spinner's output. They are operative parts
  of the patron-facing pipeline, not optional pre-publication
  hygiene.

- **Composition is essential, not aspirational.** Whole-application
  archetypes (the accounting package) are not single Spinners;
  they are compositions. The Warp Thread executor is therefore not
  a Tier 2 nice-to-have — it is a Tier 1 prerequisite for the
  most ambitious archetype.

---

## The principle behind the promise

The Foundation's reason to exist is that the synthetic-intelligence
revolution otherwise concentrates power in the operators of
hyperscale systems. The Pledge (canon §11) names what the Foundation
will refuse to do. This vision names what the Foundation will
*build*.

Normal people — bakers, lawyers, small-business owners, teachers,
artists, parents — have real intent. They speak it in plain words.
The contemporary stack asks them to learn another tool, configure
another platform, pay another vendor, copy-paste from another
tutorial. Webspinner replaces all of that with one Wizard, one Cell,
one sentence.

The architecture is the contract. The Cell is the vessel. The
Spinners are the work. The Wizard is the subject.

---

*Updated 2026-05-12. This vision belongs to the current epoch. When
the first non-technical Wizard stands up a Cell from a Foundation-
provided template and produces their first artifact, the vision
evolves.*
