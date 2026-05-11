# TESTPLAN.md — v0.7.0 walkthrough

A numbered functional test of the Webspinner Foundation Cell. Each step
states the action, the expected result, and what it validates. The
Wizard runs it once, end-to-end, with Claude alongside; gaps and rough
edges get logged in `OPEN_QUESTIONS.md` (or fixed inline if cheap).

## Pre-flight

Run on Kepler:

```sh
launchctl list | grep foundation.webspinner          # loom + grimoire both loaded
curl -sS http://127.0.0.1:8090/api/health | head     # {"code":200,"message":"API is healthy."}
curl -sS http://127.0.0.1:11445/v1/models | python3 -c "import json,sys;d=json.load(sys.stdin);print([m['id'].rsplit('/',1)[-1] for m in d['data']][:3])"
curl -sS http://127.0.0.1:11446/health 2>/dev/null   # MiniLM sidecar (best-effort)
```

Run on Spindle (or wherever you'll open the browser):

```sh
ping -c 1 johns-mac-studio.local
```

If any of those fail, stop here and fix the unhealthy service before walking the UX.

---

## §1 — Splash → register → verify

**1.1** Open `http://johns-mac-studio.local:3000/` in a fresh browser
(or an incognito window — easier to avoid the dev-bypass cookie
state).

> Expect: the WARP splash. A single clickable area, "Webspinner Foundation Cell", styled. Click it.

**1.2** You land on `/login`. Click "Register" at the bottom.

> Expect: `/register` form — Name, Email, Password, Confirm password.
> If Turnstile keys aren't in the vault yet, no widget appears (bootstrap mode).

**1.3** Fill in: a real email, a name, a 12+ char password.
Submit.

> Expect: redirect to `/verify-pending`. Branded card titled "Verify your email". Says the
> email it sent (or would have sent) to. A "Bootstrap mode" panel inside the card with a
> "Verify directly →" link (because Resend keys aren't vaulted yet).

**1.4** Click the bootstrap "Verify directly →" link.

> Expect: brief "Verified" / "Email verified" page → redirects to `/admin`. You are now
> a registered Wizard with `verified: true`.

**Validates:** registration server action, honeypot, rate-limit (won't hit unless you
spam), email-verification token issue, bootstrap-fallback cookie, admin-layout auth
gate accepts a verified user.

---

## §2 — The /admin landing

**2.1** After verification, you're at `/admin`. Look at the hero.

> Expect:
>   - Title "Webspinner Foundation Cell" in manuscript serif.
>   - "Signed in as <your-email>" italic underneath.
>   - Five stat tiles on the right: Release (`v0.6.0`), commit (`baab449` or
>     similar 7-char hash), Spinners (`4`), Journal entries (`?`), Loom up (e.g. `2m`).

**2.2** Look at the three action cards.

> Expect: Ask Bootstrap, Write a journal entry, Send to Pablo (with ⌘⇧P).
> Hover — they lift slightly. Tab through them with keyboard; focus rings on each.

**2.3** Scroll down: Recently shipped (last 6 commits, each one a row with hash · subject · date) and Recent journal entries (empty or with a few rows).

**2.4** At the bottom: a `<details>` "Cell roles + reach + federation" disclosure. Click it open.

> Expect: the old three-card config (Cell roles, Reach, Federation) inside.

**Validates:** the live landing reads version, commits, Spinner count, journal count,
Loom uptime. Every visit will look slightly different (uptime + commits + entry count
move).

---

## §3 — Pablo critiques this page

**3.1** With `/admin` open, press **⌘⇧P** (or **Ctrl+Shift+P** on a non-Mac). Or click
the cyan "Review this page" pill in the ribbon.

> Expect: a panel slides in from the right titled "Pablo's read". Pablo shows a spinner
> for ~15-30 seconds while the Quiet Loom processes. (Watch the spinner; if it never
> finishes, check the mlx-server log.)

**3.2** When the panel populates:

> Expect:
>   - Verdict pill: `passes`, `concerns`, or `fails`.
>   - One-sentence plain verdict line.
>   - "Pablo's voice" blockquote in italic serif — theatrical French painter register.
>   - 0-5 findings as severity-bordered cards. Each has a category chip, a source path
>     (e.g. `library/contrast.md`), the offending finding, the verbatim evidence in
>     monospace, and a `Fix:` line.

**3.3** Press **ESC** to close the panel.

> Expect: panel closes.

**Validates:** the ribbon trigger, the keyboard shortcut, the computed-styles capture
(Pablo's evidence should reference resolved `rgb(...)` values, not `var(...)`), the
Spinner library Spool retrieval, the Pablo dispatch end-to-end through Quiet Loom.

---

## §4 — Bootstrap Spinner

**4.1** Click "Open Bootstrap →" on the /admin landing (or nav → Installed → Bootstrap Spinner).

> Expect: `/admin/spinners/bootstrap`. Hero with thumbnail. Capabilities tabs (Consult,
> Audit, Record, Surface). Silk Pattern metrics (invocations / successes / errors / avg
> duration / last invoked). Integrity status. Capability table. Spool list. Documentation
> tabs.

### 4.1 — `consult`

**4.1.1** Tab is on Consult by default. Type a question: "What does the Foundation
Pledge say about hyperscale operation?"

**4.1.2** Click **Run**.

> Expect: ~10-20s wait. Then a prose result rendered in manuscript serif — Pablo
> retrieval pulled passages from `WARP-CANON.md`; the Quiet Loom answered. A
> "Citations" chip row with `WARP-CANON.md §11` or similar. A faint provenance line:
> `kepler.quiet-loom · Qwen2.5-14B-Instruct-4bit · N of 77 passages · cache hit`.

### 4.2 — `audit`

**4.2.1** Click the "Audit" tab. Subject: `README.md`. Kind: File path (the default).

**4.2.2** Run.

> Expect: ~15-30s wait. Drift report — either "No drift found. The Foundation blesses
> this artifact." or a severity-tagged list of findings. Evidence quoted verbatim from
> the README.

### 4.3 — `record`

**4.3.1** Click "Record". Title: `Test entry from the walkthrough`. Body: `This is a
test of the record capability. Why: validates the format.` Leave Supersedes empty.

**4.3.2** Run.

> Expect: instant (no LLM). A drafted DECISIONS.md entry rendered in monospace:
>   ```
>   ## 2026-05-11 — Test entry from the walkthrough
>
>   **Decision:** This is a test of the record capability.
>
>   **Why:** validates the format.
>   ```
> Plus a "Copy" button that copies to your clipboard.

### 4.4 — `surface`

**4.4.1** Click "Surface". No input needed.

**4.4.2** Run.

> Expect: list of unfinished threads grouped by kind. Many `open-question` entries
> (one per `OPEN_QUESTIONS.md` heading). Likely some `spec-pending` markers from
> WARP-CANON. `todo` entries if any source files carry dated TODOs.

**Validates:** all four Bootstrap capabilities end-to-end, including retrieval +
Quiet Loom (consult, audit), pure formatting (record), and file-system probing
(surface).

---

## §5 — Wizard's Journal

**5.1** Press **⌘⇧J** from anywhere, or click "Write an entry" on the landing.

> Expect: `/admin/journal`. Title "Wizard's Journal", italic lede.

**5.2** Quick-entry form. Choose kind: **learning**. Title: `Walked the v0.7
TESTPLAN with Claude`. Body: `End-to-end test of the Cell. Found these gaps: …`
(write something real or use this template). Tags: `walkthrough, v0.7, founding`.
Public toggle: off.

**5.3** Click **Record entry**.

> Expect: success banner ("Recorded …"). Form clears. The entry appears in the recent
> list below, top, with a green `learning` chip.

**5.4** Click the **Learnings** filter chip.

> Expect: only your `learning`-kind entry shown.

**5.5** Scroll to "Session context". Click **Generate**.

> Expect: ~1-2s. Markdown viewer fills with a "Resume context" block — current
> focus (your latest entry), recent actions if any, last decisions (from DECISIONS.md
> tail), open questions teaser, recent learnings. A `Copy` and `Download .md` button
> above it. Stats row says `X of Y entries · 14-day horizon`.

**5.6** Click **Copy**. Paste into a scratch file.

**Validates:** journal record + recall (via filter) + bootstrap end-to-end. The
collection auto-created on first visit.

---

## §6 — `tools/wj` from the terminal

On Kepler:

```sh
~/warp/tools/wj write action "First terminal entry" "Tested tools/wj write" --tags terminal,walkthrough
~/warp/tools/wj recall "TESTPLAN" --limit 3
~/warp/tools/wj bootstrap --horizon 7 --write
```

> Expect:
>   - First command: `recorded · action · First terminal entry` + id + timestamp.
>   - Second: 2-3 entries with cosine similarity scores.
>   - Third: full markdown context printed, plus `wrote: /Users/johndavidmarx/warp/BOOTSTRAP.md`.

Verify `~/warp/BOOTSTRAP.md` exists and has the markdown context.

**Validates:** the CLI login flow (form-action JSON descriptor parse), the journal
HTTP path, the `writeTo` file write.

---

## §7 — `tools/audit` from the terminal

```sh
~/warp/tools/audit spinners/pablo/mission-lock.md
~/warp/tools/audit --text "We are using AI to help our tenants manage their accounts."
```

> Expect:
>   - First: "No drift found. The Foundation blesses this artifact." (mission-lock
>     is canon-aligned).
>   - Second: drift findings — "AI" should be flagged (SI not AI), "tenants" should
>     be flagged (Cell not tenant), "accounts" likely flagged.

**Validates:** the Bootstrap.audit capability via CLI; retrieval + Quiet Loom +
evidence discipline.

---

## §8 — Pablo Spinner detail

**8.1** Nav → Installed → Pablo.

> Expect: hero with Pablo's portrait (the painter SVG), capabilities tab on Review.

**8.2** Click **Review**.

> Expect: typed form — Surface label, Wizard intent, Rendered HTML textarea (mono).
> The hint suggests `tools/pablo <route>` for the CLI loop.

**8.3** Test the in-Loom path: type `Pablo self` into the Rendered HTML. Run.

> Expect: Pablo returns a verdict + a couple of findings on the tiny input (or a
> "passes" with a Pablo voice line). Validates the dispatch path.

For the realistic path:

```sh
~/warp/tools/pablo /admin/spinners/pablo
```

> Expect: terminal output with Pablo's findings on his own detail page. (Meta.)

**Validates:** Pablo dispatch via UI + CLI; the computed-styles snapshot is in-browser
only, so tools/pablo CLI findings may be less precise than ⌘⇧P findings.

---

## §9 — Genesis Spinner

Nav → Installed → Genesis Spinner. The four read-only capabilities, then the four
write capabilities.

### 9.1 — `provisionToolchain` (read-only)

Click **Provision Toolchain** tab. Run.

> Expect: ~5-10s. JSON result (fallback rendering for Genesis):
>   ```json
>   {
>     "host": { "platform": "darwin", "uname": "Darwin Johns-Mac-Studio …", "macosVersion": "ProductVersion: …" },
>     "tools": {
>       "brew": { "present": true, "version": "Homebrew …", "path": "/opt/homebrew/bin/brew" },
>       "node": { "present": true, "version": "vXX.X.X", "path": "/opt/homebrew/bin/node" },
>       …
>     },
>     "missing": [],
>     "ready": true,
>     "note": "Toolchain is ready. Genesis can proceed to deployGrimoire / deployLoom."
>   }
>   ```

### 9.2 — `verifyCell` (read-only)

Tab **Verify Cell**. Leave defaults (probes 127.0.0.1:3000 and :8090). Run.

> Expect: JSON with `ready: true` and per-check results (loom-root 200, loom-admin-gate
> 303, grimoire-health 200, vault-collection 401 — meaning the collection exists).

### 9.3 — `syncRepo` (mutating but low-risk; uses target `~/warp` so it would over-rsync existing)

**SKIP for now** — it would rsync over your existing `~/warp` and you'd lose
uncommitted local changes. (We'll come back to this when there's a sandbox target.)

### 9.4 — `buildWorkspace`

**SKIP for now** — would re-run `pnpm install && pnpm -r build` in `~/warp`.
Long; not necessary for the walkthrough.

### 9.5 — `generateBootstrapState`

**Cautious test:** in the form, leave Force unchecked, set Email domain to `cell.local`
(default). Tick the "Yes, run it" confirmation box. Run.

> Expect: JSON with `directory`, `files: [{path, state: "existed", mode: "0600"}, …]`.
> Because the files already exist and Force is off, every state should be `existed`.
> If they didn't exist, they'd be `created` and you'd see new mode-0600 files at
> `~/.warp/bootstrap/`.

### 9.6 — `seedVault`

**SKIP** — needs real secrets. Defer until you have Resend/Turnstile keys ready to
seed.

### 9.7 — `deployGrimoire` / `deployLoom`

**SKIP** — they would write plists at `~/Library/LaunchAgents/`. The Loom and Grimoire
are already running from existing plists. Re-running would be a no-op if the content
matches; with Force on, would bootout/bootstrap the running service (risk of disconnect
mid-test). Defer.

**Validates:** Genesis dispatch, shell-allowlist gate, the four read-safe capabilities.

---

## §10 — Vault round-trip

Nav → Vault.

**10.1** Click into the form. Enter Name: `test-secret-walkthrough`, Description:
`temp from v0.7 walkthrough`, Value: `not-a-real-secret-12345`. Submit.

> Expect: "Saved test-secret-walkthrough" banner. Row appears in the table.

**10.2** Verify the Created and Updated dates render as real dates (not "Invalid Date").

**10.3** Click **Delete** on the row. Confirm the browser prompt.

> Expect: "Removed test-secret-walkthrough" banner. Row gone.

**Validates:** vault CRUD round-trip, AES-GCM encrypt/decrypt, date formatting,
delete confirmation, e2e test path mirrored.

---

## §11 — Audit log

Nav → Audit log.

**11.1** Look at the page. Should show all the activity from §3 onward.

> Expect:
>   - Header "Audit log" + lede saying "N entries total; showing the M most recent."
>   - Three filter dropdowns: event type, result, window.
>   - Wide table with When · Type · Source · Subject · Actor · Result · Reason.

**11.2** Use the "event type" dropdown → filter to `wp.spinner.invoke`. URL gains
`?type=wp.spinner.invoke`. Page reloads.

> Expect: only Spinner-invocation events; your recent Bootstrap/Pablo/Journal invokes.

**11.3** Use the "result" dropdown → filter to `success`. URL gains both filters.

> Expect: only successful invocations.

**11.4** Window dropdown → last 25.

> Expect: smaller window.

**Validates:** server-side filter passthrough, the underlying audit chain is being
written for every Spinner invocation.

---

## §12 — Skein listing

Nav → Installed (`/admin/spinners`).

**12.1** Look at the page.

> Expect: "Skein" title, italic lede with the Spinner count. Search input + filter
> chips (All / Verified / Threadable / Pending install). Four rows: Bootstrap Spinner,
> Pablo, Wizard's Journal, Genesis Spinner. Each row has an icon, name, name+meta,
> short description, chevron.

**12.2** Type `pab` in search.

> Expect: only Pablo visible. Count updates: "1 of 4".

**12.3** Clear search. Click "Threadable" chip.

> Expect: all four shown (all are threadable). Click "Pending install".

> Expect: zero rows ("No Spinners match this filter.").

**12.4** Click "All" to reset.

**Validates:** Skein search + filter UX, scales to thousands of Spinners by design.

---

## §13 — Use the BOOTSTRAP.md

If §6 wrote `~/warp/BOOTSTRAP.md`, open it.

> Expect: markdown with `# Resume context — generated …`, Current focus, Recent
> actions, Last decisions, Open questions, Recent learnings.

Next time you open Claude Code in `~/warp/`, `CLAUDE.md` boot-order step 3 reads
this file. Verify by starting a fresh Claude session: ask it "what's our current
focus?" and it should answer from BOOTSTRAP.md without you pasting context.

**Validates:** the meta-bootstrap loop — Journal `bootstrap` → BOOTSTRAP.md →
Claude session pickup. The bridge between sessions.

---

## §14 — Logout + session

Click "Sign out" in the ribbon.

> Expect: redirect to `/`. Visiting `/admin` redirects to `/login` (session cleared).

Sign in again. The Loom remembers nothing about cookies but does load the prior
user. You're back at `/admin`.

**Validates:** session lifecycle.

---

## §15 — Wrap-up

Open `/admin/journal` and write the founding entry:

  - kind: **decision**
  - title: `Webspinner Foundation Cell — v0.7.0 functional test complete`
  - body: `Walked TESTPLAN.md end-to-end. Gaps found: <list yours>. Next: <list yours>.`
  - tags: `walkthrough, founding, v0.7`
  - public: off

Run `tools/wj bootstrap --write` from terminal. The new entry becomes the current
focus in the resume context.

**Validates:** the loop closes — Wizard writes the test result; the test result
becomes the next session's bootstrap; the next Claude session knows what shipped.

---

## What this test plan does *not* cover

- Genesis writes (`generateBootstrapState` with `force`, `seedVault`, `deployGrimoire`,
  `deployLoom`) — they touch live services and should run only against a fresh host
  or with explicit intent to reprovision.
- Email send via Resend — requires `resend-api-key` in the vault.
- Turnstile widget — requires `turnstile-site-key` and `turnstile-secret-key` in
  the vault.
- Federation (Capability Bus) — open work; no peers yet.
- Warp Thread runtime — manifest exists, executor doesn't.
- Spinner integrity verification — manifests have digests; signing is open work.

These are tracked in `OPEN_QUESTIONS.md` and stay there until they ship.

---

## When things break

If a step doesn't behave as expected:

  - **`/` or `/admin` returns HTTP 500 with "Cannot find module '...chunks/<hash>.js'"** — stale build manifest. Run `~/warp/tools/deploy-loom` on Kepler (clean rebuild + bootout/bootstrap; the safe reload). `launchctl kickstart -k` alone is NOT enough after a rebuild that regenerates chunk hashes — it restarts the process but the on-disk manifest references chunks vite already deleted.
  - **Loom unreachable (no response at all)** — `launchctl kickstart -k gui/$(id -u)/foundation.webspinner.loom` on Kepler. If kickstart doesn't help, run `~/warp/tools/deploy-loom` (full reload).
  - **Quiet Loom slow / hanging** — `tail ~/Library/Logs/webspinner-mlx-server/stderr.log`; if the semaphore-leak signal appears (`OPEN_QUESTIONS.md` — *Quiet Loom — 14B model stability*), bootout/bootstrap the mlx-server.
  - **PocketBase errors in the Loom log** — `tail ~/Library/Application Support/Webspinner Foundation/Loom/logs/loom.err.log`.
  - **Pablo hallucinated CSS** — the in-browser button captures computed styles; the CLI path doesn't (yet). Use ⌘⇧P for accuracy.
  - **A finding looks wrong** — write a journal entry tagged `pablo-feedback` with the surface name and the misread. The Mission Lock evolves from these.
