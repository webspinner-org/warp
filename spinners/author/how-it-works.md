# How Author Works

The closed authoring loop, end to end.

## The five phases

When the `authorSpinner` capability is invoked, Author runs five phases
in order. Each phase has a single responsibility; failure at any phase
halts the loop and returns the partial state for inspection.

### 1. Scaffold

Author selects a template (`hello-spinner` in v0; the only one
shipped) and copies its contents into `~/Cells/spinners/<slug>/`,
substituting placeholders (`{{slug}}`, `{{displayName}}`,
`{{description}}`, `{{authorEmail}}`, `{{cellFingerprint}}`,
`{{createdAt}}`).

- Failure mode: `slug-in-use` (the destination directory exists).
  Author does not delete; the Wizard decides.

### 2. Scenario-written

Author generates `~/warp/scenarios/<slug>-install.json` — a Weaver's
Tension scenario that exercises the authored Spinner end-to-end:

- Open the Skein.
- Verify the Spinner's row exists with `integrity_status: verified`.
- Open the detail page; confirm the entrypoint capability renders.
- Invoke a default capability (`greet` for hello-spinner-based bundles).
- Confirm the invoke produced output + a `wp.spinner.invoke` audit
  event.

The generated scenario uses `{{fixture.slug}}` placeholders so it's
self-describing — Witness reads the fixtures and reuses them.

### 3. Install

Author calls the existing `spinner.install` meta-runtime operation,
which lints, signs with the Cell's identity key, and writes the
`wp_skein` row. Same code path the manual `/admin/spinners/new`
form uses; same audit + op-envelope trail.

- Failure mode: `install-failed` with the install op's structured
  error attached.

### 4. Verify

Author invokes Witness's `verifyScenario` capability against the
generated scenario. Witness drives a headless Chromium against the
live Loom, walks the scenario, returns a structured report.

- Pass: every ribbon step ends in `completed` or `remediated`.
- Fail: the report's `escalation` block names the step + reason +
  evidence.

### 5. Report

Author returns a structured response:

```json
{
  "ok": true | false,
  "slug": "...",
  "scenarioSlug": "<slug>-install",
  "bundlePath": "/Users/.../Cells/spinners/<slug>",
  "skeinName": "@local/<slug>",
  "phase": "verified | failed | ...",
  "witnessReport": { ... full WitnessReport ... }
}
```

The Wizard reviews `ok` + the Witness report and decides whether to
keep the authored Spinner or roll it back.

## What Author does not do (v0)

- **No LLM-driven scaffolding.** v0 uses the hello-spinner template
  verbatim. The `intent` field is recorded but does not influence the
  generated code. v1 adds intent-to-code via Quiet Loom or Anthropic.
- **No self-healing.** If Witness reports red, Author surfaces the
  failure and exits. v2's Mender Spinner is the role that reads the
  Witness report and proposes a patch.
- **No cleanup on failure.** A partial scaffold or install is left in
  place so the Wizard can inspect what happened. The artifacts on
  disk are the evidence.

## Why this shape works

The build loop's value isn't generation. It's **trust without
faith**. Author can be imperfect — and v0 is — because Witness
verifies the output empirically. If Author scaffolds something wrong,
Witness catches it. If the install fails, the install op's
structured error surfaces. Every step audited, every claim backed.

That's the architecture: small, focused Spinners, each with a clean
contract, each verifying the next.
