# Witness

The verification Spinner of the Warp build loop. Drives a Weaver's Tension
scenario end-to-end through the live Loom via headless Chromium and
returns a structured report.

- Capability: `verifyScenario({ scenarioSlug, authMode?, cleanupSpinnerSlug?, runTimeoutMs? })`
- Output: `{ ok, runId, totalSteps, completedSteps, remediatedSteps, failedSteps, escalation?, durationMs, ribbon[] }`
- Voice: empirical. Reports what happened, not what should happen.

See `mission-lock.md` for the role contract and `how-it-works.md` for the
detailed flow.

## License

Apache 2.0. The name *Witness* is trademark-pending of the Webspinner
Foundation; the implementation is open source.
