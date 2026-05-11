# Progress revealing

## The rule

Long-running async work — anything the patron waits more than a
second for — needs feedback shaped by the duration:

  - **Under 1 second.** The work feels instantaneous. No spinner
    needed. A visual transition (cursor change, button-press
    animation) is enough.
  - **1 to 10 seconds.** The work is noticeable. Show a
    **spinner** plus a one-word state label ("Saving…",
    "Computing…"). The patron stays attentive.
  - **More than 10 seconds.** The work is long enough that the
    patron's attention has wandered. Show a **progress
    indicator** with explicit state — current step name, step N
    of M if known, elapsed time, what's being computed. The
    patron decides whether to wait or come back.
  - **More than 60 seconds.** Surface the same details and add
    an explicit "this is unusual" or "this may take a minute or
    two" note. Without it the patron assumes the work is stuck.

Three states for any indicator: **idle** (not yet started),
**active** (running), **complete or error**. Idle and active
must be visually distinguishable; idle and complete must be
visually distinguishable. A spinner ring that animates the same
shape regardless of state is failure.

## Why

NN/g and Nielsen's *Usability Engineering* (1993) call out these
thresholds explicitly. They map to human attention windows: 1 s is
the limit of "I caused this"; 10 s is the limit of "I'm waiting
for this"; 60 s is the limit of "I expect a response". Past those
thresholds without feedback, the patron concludes the system is
broken and the work is lost.

Pablo enforces these on every surface that does async work — the
Spinner invocation panel, the Pablo critique panel, the bootstrap
context viewer, the Vault add form.

## How Pablo checks it

1. **Find async triggers.** Buttons with `onclick` handlers that
   fetch, forms with `use:enhance` submitters, anything that
   navigates. For each, ask: does the surface communicate state
   while the action runs?

2. **Idle / active / complete differentiation.** Inspect the
   trigger and any associated indicator. If the only state-change
   is `disabled` + opacity drop, the idle vs active distinction
   is weak. Flag *interaction: indistinguishable async state*.

3. **Past 10 s without progress.** Check for a literal `setTimeout`
   or polling pattern. If the surface has a "wait longer than 10
   seconds" path (model invocation, build, deploy) and the
   indicator does not show step/elapsed information, flag
   *interaction: missing progress at >10s threshold*.

4. **State label on the trigger.** When the trigger toggles to
   active, does its label change? "Save" → "Saving…" with a
   trailing ellipsis is the canonical pattern. "Save" → blank
   (just a spinner) is weaker; the action's identity disappears
   while waiting.

## Common failures

  - A submit button that spins forever (no completion state)
    because the response handler swallowed an error silently.
  - A loading spinner with no label — the patron knows
    *something* is loading but not *what*.
  - A multi-step async flow (compose → enrich → publish) shown
    as a single spinner instead of the three states.
  - "Generating…" with no progress for 45 s. The patron clicks
    Generate again, doubling the work.

## Sources

- Jakob Nielsen — *Usability Engineering* (1993), Chapter 5
  "Response Times: The 3 Important Limits".
- Nielsen Norman Group — *Response Times: The 3 Important
  Limits* (article version, evergreen).
  [https://www.nngroup.com/articles/response-times-3-important-limits/](https://www.nngroup.com/articles/response-times-3-important-limits/)
- Ben Shneiderman — *Designing the User Interface*, on
  graceful degradation under wait conditions.
- web.dev — *Loading Patterns* (the modern web equivalent —
  skeleton screens, optimistic UI, progressive enhancement).
  [https://web.dev/learn/design/loading/](https://web.dev/learn/design/loading/)
