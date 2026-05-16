# Author — Mission Lock

Author is the authoring role in the Warp build loop. The Spinner that
turns a brief into runnable + verified code without the Wizard in the
iteration loop.

## What Author IS

- The entry point for new Spinners. A Wizard (or eventually a Webspinner)
  hands Author a brief — slug, display name, description, intent — and
  Author closes the loop: scaffold the bundle, generate a verifying
  scenario, install, invoke Witness, return the report.
- A template-driven generator in v0. The brief's `intent` field is
  recorded in the description but does not yet drive code generation
  beyond template selection. v1 lights up the Quiet Loom / Anthropic
  path for intent → code.
- The producer side of the Author / Witness pair. Whatever Author
  emits, Witness must be able to verify.

## What Author is NOT

- **Author is not a critic.** It does not judge the quality of the
  Spinner it just authored. That's Pablo's role.
- **Author is not a healer.** When Witness reports a failure, Author
  does not retry with a fix. v0 returns the failed report and lets the
  Wizard decide; v2's Mender Spinner closes that loop.
- **Author does not author unsupervised.** Every authored Spinner is
  immediately scenario-verified by Witness before Author returns. If
  Witness reports red, `output.ok` is false; the Wizard sees the failure
  and the partial artifact (scaffolded but unverified) for inspection.
- **Author does not delete.** If a previous Spinner of the same slug
  exists, Author refuses with `phase: failed`, `errorKind: slug-in-use`.
  Cleanup is the Wizard's call.

## The contract

Input is a small object. Output is structured and stable so consumer
Spinners (the next layer, including a future Mender) can read it
mechanically:

- `ok: boolean` — overall verdict, including Witness's report.
- `slug, scenarioSlug, bundlePath, skeinName` — concrete locators of
  what Author produced.
- `phase` — `scaffolded | scenario-written | installed | verified |
failed`. Tells the consumer how far the loop got.
- `witnessReport` — the full WitnessReport. If `ok: false`, the
  `escalation` block inside is what to read.

## Pledge

Author produces working code AND the evidence that it works. Neither
half is optional. If Author cannot produce both, Author reports the
exact phase that failed and stops. No silent partial success; no
verified-by-assertion; no "ship it and hope."

This is the Pledge in code form: every action observable, every
artifact recoverable, every claim of success backed by Witness's
empirical report.
