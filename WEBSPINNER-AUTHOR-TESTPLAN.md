# WEBSPINNER-AUTHOR-TESTPLAN.md — end-to-end UX test for the first Webspinner-author arc

The first Webspinner-shaped test of the Warp architecture: a Wizard (or eventual
Webspinner) sits at the Loom in their browser and produces a working Spinner
end-to-end through the admin UI. This file is the running checklist for
"are we ready to do that test yet?"

Updated as batches in the Webspinner-author arc land. The Wizard executes the
live test when every required surface is checked.

---

## The scenario — what the Webspinner does, in order

```
1.  /admin                  — Cell status loads
2.  /admin/operations       — recent ops visible
3.  /admin/spinners         — Skein listing with integrity badges
4.  click "New Spinner"     — opens the authoring form
5.  pick "hello-spinner"    — template dropdown
6.  fill name, slug, desc   — form fields
7.  click Save              — install op runs (~5s)
8.  redirected to detail    — /admin/spinners/<slug>
9.  invoke capability       — output renders
10. back to /admin/spinners — new Spinner shows "verified"
11. /admin/operations       — install + invoke ops linked
12. /admin/audit            — wp.spinner.installed event recorded
13. /admin/spinners/<slug>  — Refresh integrity button confirms still verified
```

A successful run produces:

- One signed bundle at `~/Cells/spinners/<slug>/` on Kepler.
- One `wp_skein` row with `integrityStatus: 'verified'`.
- Two `wp_operations` rows: `spinner.install`, `spinner.invoke`.
- Three `wp_audit` events: `wp.spinner.installed`, `wp.spinner.invoke`,
  optionally `wp.spinner.integrity-checked` if the Webspinner clicks refresh.
- Zero soft-failures on the Loom side.

---

## Already in place

| Surface                                                   | Status | Commit    |
| --------------------------------------------------------- | ------ | --------- |
| Spinner bundle digest + ed25519 sign/verify (SDK)         | ✓      | `ea8763a` |
| Provenance on disk (`provenance/`)                        | ✓      | `0ba7f47` |
| `webspinner sign / verify` CLI + `wp_operations` envelope | ✓      | `d665052` |
| `wp.spinner.signed / verified` audit events               | ✓      | `de870d2` |
| `tools/ship` end-of-batch wrapper                         | ✓      | `9ef2131` |
| `/admin/operations` list + detail UI                      | ✓      | `35cc6af` |
| Dependency + simplicity principles persisted              | ✓      | `1899019` |
| `tools/spinner-lint` + the lint gate in `tools/ship`      | ✓      | `bf5c01f` |

---

## What remains in the arc

| #     | Batch                                                          | Unblocks scenario step(s)                        | Status    |
| ----- | -------------------------------------------------------------- | ------------------------------------------------ | --------- |
| **2** | `wp_skein` writer + reader                                     | 3, 10, 13 — install records + integrity badges   | ✓ shipped |
| **3** | `spinner.install` meta-runtime op + `tools/webspinner install` | 7 — the install pipeline writes a `wp_skein` row | ✓ shipped |
| **4** | First template: `hello-spinner` + scaffold helper              | 5, 6 — the scaffold the form copies from         | ✓ shipped |
| **5** | Weaver dynamic dispatch for Cell-authored Spinners             | 9 — invoking the newly-authored Spinner          | pending   |
| **6** | `/admin/spinners/new` UI                                       | 4, 6, 7 — the Webspinner-facing form             | pending   |

Each batch is a separate LLD + approval + build cycle.

---

## Environmental requirements (independent of code)

```
[ ] Deploy current state to Kepler: tools/deploy-loom on Kepler.
    Today the running Loom predates every batch ea8763a → bf5c01f.
    Until deploy: none of the new substrate (wp_cell_identity,
    wp_operations, /admin/operations, /admin/signing/*, /admin/spinners/lint)
    is live.

[ ] Working PB superuser creds at ~/.warp/bootstrap/ on the host that
    runs the CLIs. Today the creds on the dev host (~/.si-native/bootstrap/)
    don't match the live Loom — every batch's audit/journal/bootstrap step
    soft-fails. The Wizard either syncs creds to ~/.warp/bootstrap/ on the
    dev host OR runs the CLIs from Kepler directly.

[ ] PocketBase + Loom + Quiet Loom (mlx-server) all running on Kepler
    under their launchd plists.

[ ] Retroactive sweep on Kepler — for every shipped batch, run:
      tools/audit <each-changed-doc>
      tools/wj write decision <batch-name> "<summary>"
      tools/wj bootstrap --write
    So BOOTSTRAP.md reflects current state for the next Claude Code session.
```

---

## Acceptable gaps for this test

These are known-incomplete features that **do not block** the human-in-the-
loop run. Documented so the test isn't surprising.

- **Cancel button** on `/admin/operations/<opId>` — renders, disabled with
  tooltip "_needs meta-runtime resumability (Tier 2)_". The scenario doesn't
  hit a long-running op; install is synchronous in Tier 0.
- **Re-run button** — same treatment.
- **Authoring-by-conversation** — the _"one sentence → Spinner"_ path from
  `VISION.md` is **not** in this arc. This arc demonstrates the
  _"template + form → Spinner"_ path. Conversational authoring is Tier 1.2.
- **Pablo + Bootstrap auto-polish loop on the authored Spinner** — the
  install op (batch 3) signs and registers, but does NOT auto-invoke
  Pablo/Bootstrap. The Webspinner does that manually via existing buttons.
  Auto-polish is a future enhancement.
- **SI log-interpreter** — operation errors show their `kind` string
  (`manifest-invalid`, `signature-invalid`) not plain-language explanations.
  Substrate is in place; the interpreter Spinner is Tier 3.
- **Webspinner auth** — this test runs as Wizard (`_superusers`). The Webspinner-
  user flow (with per-user filtering on `wp_skein` and `wp_operations`) is
  Tier 3.
- **`/admin/signing/{sign,verify}` rename to `/admin/spinners/{sign,verify}`**
  — naming inconsistency; existing routes work; cosmetic. Future cleanup.

---

## Pre-flight checklist (run on Kepler before the live test)

```
[ ] tools/deploy-loom (clean rebuild + bootout/bootstrap)
[ ] tools/wj reconcile pass for every shipped batch
[ ] tools/wj bootstrap --write  (refresh BOOTSTRAP.md)
[ ] tools/spinner-lint ~/warp/spinners/bootstrap
[ ] tools/spinner-lint ~/warp/spinners/pablo
[ ] tools/spinner-lint ~/warp/spinners/wizards-journal
[ ] tools/spinner-lint ~/warp/spinners/genesis
    — confirm all four Genesis Spinners lint clean
[ ] tools/pablo /admin/spinners           — visual regression on list
[ ] tools/pablo /admin/spinners/new       — review the new form (batch 5)
[ ] tools/pablo /admin/spinners/pablo     — visual regression on detail
[ ] tools/pablo /admin/operations         — sanity check
[ ] curl /admin (no session) → 303
    curl /login → 200
    curl /admin/spinners (with cookie) → 200
[ ] Browser walk-through of steps 1–13 above
```

If any pre-flight check fails, the failure surface is one of:

- Deploy hygiene (run `tools/deploy-loom` again with `--typecheck`)
- Creds (re-check `~/.warp/bootstrap/` on the host running CLIs)
- A Webspinner-author batch having a regression (re-lint, re-run tests)
- Pablo finding a UI regression on the refactored pages (fix and re-ship)

---

## Success criteria — the live test passes when

1. **Every step 1–13 completes without an error surfacing to the Webspinner.**
   Operation rows + audit events get written. The Spinner directory exists
   on disk. The integrity badge says "verified."

2. **The Wizard can read every artifact the test produced**:

   ```
   /admin/spinners/<new-slug>       — detail with signed digest + signers
   /admin/operations/<install-opId> — full envelope + linked audit
   /admin/operations/<invoke-opId>  — full envelope + linked audit
   /admin/audit?type=wp.spinner.installed — the install event
   ~/Cells/spinners/<new-slug>/                — bundle on disk
   ~/Cells/spinners/<new-slug>/provenance/     — signed
   ```

3. **No soft-failures on the Loom side.** No `console.error` from any of
   the op finish() helpers. No stuck rows. No orphaned `wp_operations` rows
   without correlated audit events.

4. **The Wizard's reaction is "that was easy."** This is the architectural
   target from `VISION.md` §"The quality bar": _delights and astounds._
   The Webspinner-author arc gets us to _"works the first time."_ Delight is a
   later, polish-driven concern.

---

_Updated as batches land. This file is the running test plan for the
Webspinner-author arc; reconcile after every commit that touches batch 2–5._
