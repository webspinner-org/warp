# How Witness Works

A patron-facing explanation of the verification flow Witness runs.

## The shape of a verification

When Author commits a diff, or when the Wizard wants to confirm a scenario
still passes, Witness's `verifyScenario` capability is invoked with a
single argument — the scenario slug. Everything else has sensible defaults.

What Witness does, in order:

1. **Authenticate.** Witness reads the Loom's PocketBase credentials from
   the environment (`WARP_PB_EMAIL` / `WARP_PB_PASSWORD`), gets a
   superuser token. If `authMode: 'webspinner'`, Witness then idempotently
   creates (or finds) a verified test user, auths as them, and uses
   THAT token as the browser's session cookie. Privilege-boundary bugs
   that only appear on the user-collection path surface here.

2. **Clean up state.** If `cleanupSpinnerSlug` is given, Witness deletes
   any matching `wp_skein` row and removes the bundle directory at
   `~/Cells/spinners/<slug>`. This makes the verification idempotent — a
   second run produces the same green report as the first.

3. **Launch Chromium.** Headless. Same-origin to the Loom. Inject the
   session cookie. Navigate to `/admin/weavers-tension`.

4. **Start a run.** Click the scenario card's "Start a run" button.
   Wait for the redirect to `/admin/weavers-tension/<slug>/<runId>`.
   Click ▶ Start on the player.

5. **Watch.** Poll the ribbon every 750ms. Track per-step status
   (pending / active / completed / remediated / failed / escalated).
   Capture the run's status (running / paused / completed / aborted /
   failed). Track the live action label. If an `.escalation` panel
   appears, capture its reason text and evidence JSON.

6. **Report.** When the run terminates (completed, failed, or aborted),
   Witness reads the final ribbon, packages the report, and returns it.

## What a passing report looks like

```json
{
  "ok": true,
  "scenarioSlug": "webspinner-author",
  "runId": "e0f26c16-b1f7-47e4-8e7d-f94ed7a68836",
  "totalSteps": 14,
  "completedSteps": 14,
  "remediatedSteps": 0,
  "failedSteps": 0,
  "durationMs": 47213,
  "ribbon": [
    { "key": "open-admin", "title": "Open the Loom", "status": "completed" },
    ...
  ]
}
```

## What a failing report looks like

```json
{
  "ok": false,
  "scenarioSlug": "webspinner-author",
  "runId": "...",
  "totalSteps": 14,
  "completedSteps": 8,
  "remediatedSteps": 0,
  "failedSteps": 1,
  "escalation": {
    "stepKey": "save-and-install",
    "reason": "Verifier(s) failed",
    "evidenceText": "I expected the Skein to show a 'tension-demo' row..."
  },
  "durationMs": 28391,
  "ribbon": [...]
}
```

`escalation.reason` is the SI's plain-English narration from the player's
panel. `evidenceText` is the JSON dump from the collapsible evidence
panel. Together they're enough for Author/Mender to propose a corrective
diff without rerunning the scenario manually.

## What Witness does NOT do

- It does not author scenarios. The scenario JSON exists; Witness reads it.
- It does not patch bugs. It reports them.
- It does not lie about partial success. If a single verifier failed,
  `ok` is `false`.

## Bootstrap dependencies

Witness needs:

- The Loom listening at `loomBase` (default `http://johns-mac-studio.local:3000`).
- PocketBase reachable from the Loom (Witness uses the Loom-known PB URL).
- Playwright + Chromium installed in the Loom's `node_modules`
  (`pnpm exec playwright install chromium` is run during Loom setup).
- The scenario file present at `~/warp/scenarios/<slug>.json`.

Witness fails fast (`auth-failed`, `iframe-load-failed`, `scenario-not-found`)
when any of these are missing, with a structured error consumer Spinners
can recognize.
