# AGENTIC-BUILD-LOOP.md

Strategic thinking note. Captured 2026-05-12 at the end of the v2
Weaver's Tension iteration. Not canon yet — a working artefact for
the next session to pick up.

## The problem the Wizard named

Claude Code on Opus 4.7 + Wizard-in-the-loop is a **broken paradigm**
for the work Warp is trying to do. Symptoms observed today:

- Iterations require human-in-the-loop turns even when the failure
  mode is well-defined enough that an SI could resolve it
  autonomously (e.g., "the verifier expected slug X, found slug Y").
- The single-agent shape "fights" automation: Claude Code is
  simultaneously authoring, testing, critiquing, and chat-partnering
  the Wizard. Each role pulls against the others. The chat-partner
  role bottlenecks the rest.
- Tests are taking roughly as much time to write as the code. The
  pattern is sound (verification before ship) but the **unit of
  verification** is wrong: we're writing line-level test fixtures
  when scenario-level behavioural verification (Weaver's Tension
  itself) would be cheaper to maintain and more correct.
- The Wizard is the only quality-assurance loop. That's not what he
  signed up for. He wants to be the **release gate**, not the
  iteration runner.

## What Pablo already proved

A **fit-for-purpose SI** (Pablo: design-quality reviewer with the
specific shape of "read rendered HTML, find drift from the
manuscript voice + Patterns") can interact with a Claude Code
session, iterate, and improve the output **without the Wizard in the
loop**. This was already validated — the prior arc shipped Pablo as
a working Spinner with `tools/pablo <route>` as the invocation
surface.

Pablo is the existence proof. The architectural question is whether
we can generalise Pablo's shape into a cluster of cooperating SIs
that close the build-loop end-to-end.

## The shape — proposed Spinners

Named, narrow, separable. Each owns one role in the build loop and
nothing else.

| Role     | Spinner name (working)     | What it does                                                                                                                           | When it runs                                                                                   |
| -------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Author   | **Weaver** (or "Author")   | Generates code from a brief — slug, intent, target route. Output is a diff + an updated scenario JSON.                                 | On a new ticket / patron request.                                                              |
| Verifier | **Witness**                | Drives a Weaver's Tension scenario end-to-end via the existing e2e harness. Reports pass/fail per step with plain-English narration.   | After every Author commit; on every push.                                                      |
| Critic   | **Pablo** (already exists) | Reads rendered output + the diff. Flags drift from manuscript voice / Patterns / the canon.                                            | After Witness reports green; before merge.                                                     |
| Healer   | **Mender**                 | Reads Witness failures + Pablo flags + the diff. Proposes a follow-up patch that addresses the root cause. Loops Witness on the patch. | Whenever Witness or Pablo is red. Capped iterations (e.g. 3 healing passes before escalating). |

Loom is the orchestrator (the meta-runtime). The Wizard is the
**release gate**: when the cluster reports green AND the diff has
passed every gate the Wizard cares about, he says "ship it."
Everything before that runs without him.

This is the next pillar after Weaver's Tension. WT proved we can
drive the Loom programmatically; the build loop proves we can drive
_the authoring of Spinners_ programmatically.

## What "human-in-the-loop" becomes

A **safety valve**, not the engine. Three remaining places:

1. **Release gating.** The Wizard sees the green build and either
   merges or pushes back. The pushback re-enters the loop as a brief
   ("Pablo flagged X, fix it differently").
2. **Strategic direction.** Decisions like "what should the next
   Spinner do" — the Wizard intent, not the implementation, are
   human input.
3. **Pledge enforcement.** When the Author or Healer proposes
   something that crosses a Pledge line, the Loom halts and waits
   for the Wizard. Auditable refusal.

Everything else — driving syntax errors out, healing flaky tests,
chasing the "wait, the deploy didn't pick up the new chunk"
hairpin — is the cluster's job, not the Wizard's.

## On tests — the pattern simplification

The Wizard's observation: _"we seem to be spending as much time
writing tests as writing code."_ This is true today and it's the
wrong cost curve. The fix isn't fewer tests; it's the **wrong unit
of verification**:

- **Unit tests** verify code shape. They're cheap to write but
  prove nothing about behaviour. They go red when the code wobbles
  internally even though the system still works.
- **Scenario tests** (Weaver's Tension) verify _the actual
  experience_. They're more expensive to write but they prove the
  thing that matters. Plus they double as patron-facing demos.

Proposal: **make Weaver's Tension scenarios the primary verification
substrate**. Unit tests stay for tight algorithms (digest
canonicalisation, placeholder substitution) but the _integration
layer_ drops to scenario-only. The Witness Spinner runs the
scenarios on every commit; that's the green light, not 140 unit
tests.

Witness is the load-bearer here: if Witness can reliably drive
scenarios and report behavioural truth, the unit-test layer can
become opt-in rather than mandatory.

## Open questions to answer next session

1. **Where do the new Spinners run?** Locally (in-Cell) is the
   bootstrap answer. Eventually they're Foundation-recognized
   Spinners every Cell can install.
2. **What's the brief format the Wizard hands to the Author?** A
   sentence? A scenario JSON skeleton with the verifications
   pre-filled and the actions blank? A Weaver Thread declaration?
3. **How does the cluster talk to each other?** Through `wp_audit`
   correlation (each Spinner reads recent events tagged with the
   build's run-id)? Through a dedicated `wp_build_loop` collection?
   Through a Capability Bus topic (ch. 8)?
4. **How is the Wizard kept informed without being interrupted?**
   The Loom should surface a "build in flight" panel showing each
   Spinner's current state. The Wizard glances; doesn't drive.
5. **Backstop with Anthropic.** The Wizard noted he doesn't mind
   backing one or more of these with Anthropic API directly (rather
   than Quiet Loom). For Author and Healer this is probably right
   — those need the long-context reasoning Anthropic's models
   provide. Pablo / Witness are already Quiet-Loom-friendly because
   their reasoning is bounded to the input artifact.
6. **What's the MVP cut?** Author + Witness is the minimum closed
   loop. Pablo already exists. Mender is the most ambitious — defer
   to a later phase. So the MVP is: Author writes code, Witness
   verifies, Pablo critiques. The Wizard pushes back as needed.
   Mender is v2.
7. **What about Claude Code itself?** It still has a role — it's the
   surface the Wizard uses for _one-off shell work_ and for
   onboarding. But it shouldn't be the build engine. The build
   engine is the Spinner cluster.

## What "doing this" looks like as a next-batch arc

Rough order:

1. **Witness v0** — wrap the existing `loom/tests/weavers-tension-e2e.ts`
   harness in a Spinner shape. Capability: `verifyScenario(slug)`.
   Output: a structured report (pass/fail per step + evidence).
   This is the smallest first move and gives Author something to
   verify against.
2. **Author v0** — given a brief + a target Loom surface, generate
   a Spinner skeleton (template-driven for v0). Capability:
   `authorSpinner({ intent, scenarioOutline })`. Output: a diff +
   a scenario JSON.
3. **Closed loop v0** — Wizard hands a one-paragraph brief →
   Author drafts → Witness runs → either green (Wizard reviews,
   merges) or red (Wizard reads the failure narration, redirects).
   No Mender yet; the Wizard is the redirect mechanism.
4. **Mender** — when (3) is stable, add a Spinner that reads
   Witness's failure narration and proposes a corrective diff
   without involving the Wizard. Cap retries; escalate on cap.

This is the Pillar that follows Weaver's Tension. It's also where
the architecture starts paying for itself: every future Spinner is
authored through the loop, so the loop's quality compounds.

## Persistence pointer

Cross-reference from `OPEN_QUESTIONS.md` (Agentic build loop).
Future decisions on this thread land in `DECISIONS.md` with the
date and supersede this note as appropriate.
