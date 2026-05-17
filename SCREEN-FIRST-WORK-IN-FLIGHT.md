# SCREEN-FIRST-WORK-IN-FLIGHT.md — refactor checklist

Started 2026-05-17 after the Wizard signalled "go" on `SCREEN-FIRST-AUTHORING.md`.

Blast radius: `~/warp/spinners/database-application/`, `~/warp/loom/`, `~/webspinner-try/`. **Nothing else.** Operator Cell, other tenant services, the rest of `~/warp/spinners/*` — all untouched.

The Wizard asked: get it far enough along that I test it myself before he sees it, so the test loop **wows**.

## What ships in this refactor

| #   | Piece                                                                                                                                    | Status                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Mission-lock rewrite — screen design discipline + branding posture                                                                       | **done**                                                                                 |
| 2   | New types: `ScreensDraft`, `Screen`, `ScreenLayout`, `BrandingOption`                                                                    | **done**                                                                                 |
| 3   | `databaseAppPropose` reshaped — asks for screens + 3 palette options                                                                     | **done**                                                                                 |
| 4   | `databaseAppRefine` reshaped — applies patron answers as screen-level deltas; settles on palette                                         | **done**                                                                                 |
| 5   | `databaseAppBuild` reshaped — derives schema from screens, creates collections, writes screens + branding to `wp_database_applications`  | **done**                                                                                 |
| 6   | Loom routes return screens + branding alongside entities                                                                                 | **done**                                                                                 |
| 7   | FastAPI proxy passes screens + branding through                                                                                          | **done** (no changes needed — generic JSON pass-through)                                 |
| 8   | Observatory result mode renders **screen mockups** (form previews, list previews) instead of schema cards                                | **done**                                                                                 |
| 9   | Clarifications modal grows a palette selector — visual swatches + custom-description option                                              | **done** (swatches + free-text reference URL; custom-description as free-text follow-up) |
| 10  | Observatory app mode is **screen-driven** — one navigable surface per screen, with the selected palette applied as CSS custom properties | **done**                                                                                 |
| 11  | End-to-end self-test: propose → refine → build → patron uses app with their chosen palette                                               | **pending Kepler deploy** (demo Cell + Quiet Loom are Kepler-only)                       |
| 12  | Commit + deploy + smoke                                                                                                                  | **in flight**                                                                            |

## Decisions for this refactor (smaller than CELL-ARCHITECTURE-NOTES)

- **Screen storage**: as JSON inside `wp_database_applications.screens`, not a separate collection. Light-touch v1; can extract to a collection later if per-screen queries become a thing.
- **Branding storage**: alongside, as `wp_database_applications.branding` JSON.
- **Palette as CSS custom properties** applied at runtime — the renderer reads the patron's selected palette and writes CSS vars onto the app's root.
- **Schema derivation in build**: form fields → entity columns; `link-to` fields → PB relation fields; list/report/dashboard screens are query-only, no entity backing.
- **Progress phases**: more than today's 4 — add `researching-conventions`, `drafting-screens`, `drafting-navigation`, `drafting-branding-options` between identifying-domain and proposed. Patron sees more activity for the same wall-clock.
- **Output token budget**: bump from 2048 → 4096 for the bigger output shape.

## Deferred (named so it doesn't drift)

- Full per-step LLM decomposition (one LLM call per phase). v1 keeps the single big propose call; future iteration breaks it up.
- Direct-manipulation edit-in-place over the screen mockups. v1 uses the existing clarifications modal pattern with screen mockups visible.
- Reports as fully rendered (P&L, year-end summaries). v1 declares them in `screensDraft` + shows them in nav, but the runtime rendering of aggregated queries is deferred to a follow-on.
- Reference-URL branding extraction ("mirror this website's style"). v1 ships the 3-palette + custom-description choices; the URL-reference option is named in the UX but the SI does not yet inspect the URL.

## Test plan (for my own self-test before the Wizard sees it)

1. `start over` → fresh session
2. Speak: _"I want to keep track of every customer's service history."_ (different from yesterday's bookkeeping; tests generality)
3. Watch: Observatory should animate through more phases — at least _identifying-domain_, _researching-conventions_, _drafting-screens_, _drafting-navigation_, _drafting-branding-options_, _proposed_.
4. Expect: Observatory result mode renders **screen mockups** — form previews for the entry forms, list previews for the browse views.
5. Expect: Clarifications panel includes **palette swatches** as a choice + a free-text "describe your branding" option.
6. Answer clarifications + pick a palette → refine kicks in → screens update + palette settles.
7. Click _Build my application_.
8. Expect: Observatory transitions to app mode showing the screens with the patron's palette applied as accent colours.
9. Add a record via the form → it appears in the list → the patron's app is alive.

If steps 3-9 all pass cleanly, the loop wows.
