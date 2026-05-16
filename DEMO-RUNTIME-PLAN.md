# DEMO-RUNTIME-PLAN.md — the patron-facing Spinner runtime

The architectural plan for the public Spinner runtime at `try.webspinner.ai`. Generalized for **any** patron-facing Spinner, not just Database Application — this is the canonical AI Agent Orchestration substrate for Foundation-hosted, anonymous-patron Spinner invocation.

When this plan conflicts with `WARP-CANON.md`, the canon wins. When this plan is read by a Claude session that died mid-work, the **Status** column below tells the resume point.

---

## Intent — what this is for

The public demo lets a normal person walk in off the street through `try.webspinner.ai`, describe what they want, and have a Spinner do the work. With **zero login**, **only local LLMs on Kepler**, **complete isolation from operator state**, and **one-command cleanup**.

The architecture below is designed once and reused. As the Foundation ships more Spinners — the meta-Spinner that authors Spinners, the iPhone App archetype, the Website archetype, the Simple Game archetype, the Custom AI Spinner archetype, the `weave-form` Spinner, future Webspinner Spinners — they all install into the same demo Cell, get exposed through the same FastAPI proxy, and get wiped by the same reset tool. **No per-Spinner deployment work.**

The Wizard's standing rule (canon §17.3 — _Production-Candidate Quality Only_) is operative: every primitive built here must serve every future Spinner, not just Database Application.

---

## Architecture — the Demo Cell pattern

Two parallel Cells on Kepler, sharing stateless compute:

```
                                              ┌──────────────────────────────┐
                          (LAN/Tailscale)     │ Operator Cell (existing)     │
                       ┌─────────────────────▶│  Loom        :3000           │
                       │                      │  Grimoire    :8090           │
   Wizard ── Spindle ──┤                      │  bootstrap creds ~/.warp/    │
                       │                      └──────────────────────────────┘
                       └─────────────────────▶  Quiet Loom  :11445  (shared)
                                                Embeddings  :11446  (shared)
                                              ┌──────────────────────────────┐
   Anonymous ────── try.webspinner.ai         │ Demo Cell (new)              │
   Patron       (Cloudflare Tunnel            │  Loom        :3001           │
                 webspinner-prod)   ┌────────▶│  Grimoire    :8091           │
                       │            │         │  bootstrap creds             │
                       │            │         │    ~/.warp/bootstrap-demo/   │
                       ▼            │         │  Spinners: roster-defined    │
                  FastAPI proxy ────┘         └──────────────────────────────┘
                  (port 11900)
```

### Service topology

| Service                         | Operator                                                              | Demo                                                                      | Notes                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Loom (SvelteKit + adapter-node) | `foundation.webspinner.loom` :3000                                    | `foundation.webspinner.loom-demo` :3001                                   | Same codebase; different env (`PORT`, `WARP_PB_URL`, `WARP_PB_EMAIL`/`PASSWORD`, `WARP_VAULT_MASTER_KEY`). |
| Grimoire (PocketBase)           | `foundation.webspinner.grimoire` :8090, `pb_data` under operator path | `foundation.webspinner.grimoire-demo` :8091, separate `pb_data` directory | Independent data store. Demo wipe = drop demo `pb_data`.                                                   |
| Bootstrap creds                 | `~/.warp/bootstrap/`                                                  | `~/.warp/bootstrap-demo/`                                                 | Independent PB superuser + vault master key.                                                               |
| Cell identity key               | `4d243e2e40d9986b` (today's operator)                                 | New demo-cell identity key, generated on first demo Loom start            | Demo Spinner installs are signed by the demo Cell's identity, not the operator's.                          |
| Quiet Loom (mlx-server)         | shared                                                                | shared                                                                    | Stateless inference; no state to isolate.                                                                  |
| Embeddings sidecar              | shared                                                                | shared                                                                    | Stateless.                                                                                                 |
| Public tunnel                   | none (admin is LAN-only)                                              | `webspinner-prod` → `try.webspinner.ai` → FastAPI on :11900               | Demo Loom never gets a public hostname. Only the FastAPI proxy is public.                                  |

### Isolation guarantee

A demo patron's worst-case action affects only:

- The demo Grimoire's collections (`wp_audit`, `wp_silk_pattern`, `wp_spinner_sessions`, `wp_skein`, any future `wp_database_applications`)
- The demo Loom's process (which can be bounced)

It cannot reach:

- The operator's Grimoire (different PB instance)
- The operator's vault (different bootstrap creds + master key)
- The operator's audit log, Skein, sessions
- The shared Quiet Loom's _state_ (Quiet Loom is stateless — every call is independent)

**Cleanup is one tool:** `tools/demo-reset` → stop demo Loom → wipe demo `pb_data` → restart → re-install roster Spinners. Atomic, fast, repeatable.

---

## The Roster — what makes this generalize

**`~/warp/demo-roster.json`** (canonical name; lives in the warp repo, rsync'd to Kepler). Declares which Spinners the demo Cell installs at boot / reset:

```jsonc
{
  "rosterVersion": "1.0",
  "spinners": [
    {
      "slug": "database-application",
      "bundleRelativePath": "spinners/database-application",
      "exposeAs": "Database Application",
      "menuTile": "available",
      "introPrompt": "Tell me what you'd like to keep track of.",
    },
    // future entries — iPhone App, Website, Simple Game, Custom AI Spinner —
    // land here without code changes elsewhere.
  ],
}
```

Every piece of infrastructure reads from the roster:

- **`tools/demo-reset`** loops the `spinners[]` and re-installs each into the demo Cell.
- **The FastAPI proxy** validates incoming invoke requests against the roster's slugs.
- **The frontend** queries `/api/roster` to render the menu image's per-tile state (`available` vs `kitchen-out`).
- **The Loom-side install** uses `tools/webspinner install <bundleRelativePath>` against the demo Loom for each entry.

When a new Spinner is ready for the public demo, **adding it is one PR**: bundle goes under `spinners/<slug>/`, roster entry added, `demo-reset` rebuilds, frontend's menu lights up automatically.

When a Spinner needs to come _off_ the public demo (security incident, model issue, scope change): remove the roster entry, run `demo-reset`. The Spinner stays in the warp repo but is no longer installed in the demo Cell.

---

## Pieces (R0 – R4)

Status column tells the resume point. Update as work lands.

| #        | Piece                                             | Status          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------- | ------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R0**   | Demo Cell infrastructure                          | **not started** | Two launchd plists (Grimoire-demo on :8091, Loom-demo on :3001) + bootstrap creds at `~/.warp/bootstrap-demo/` + demo Cell identity key + demo PB data directory. Boot once, idempotent.                                                                                                                                                                                                                                                                                                   |
| **R0.1** | Roster file + first entry                         | **not started** | `~/warp/demo-roster.json` with the Database Application entry.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **R0.2** | Demo Loom installs roster Spinners on first boot  | **not started** | A startup-time `ensureDemoRoster()` step OR `tools/demo-reset --first-boot` that reads the roster and installs each Spinner via `tools/webspinner install`.                                                                                                                                                                                                                                                                                                                                |
| **R1**   | Loom invoke route forwards `sessionId`            | **not started** | `loom/src/routes/admin/spinners/[name]/invoke/+server.ts` — pull `sessionId` from the request body, pass into `invoke()`. Shared code change; both operator and demo Loom inherit it on next deploy.                                                                                                                                                                                                                                                                                       |
| **R2**   | `tools/demo-reset` script                         | **not started** | Stop demo Loom → drop demo `pb_data` directory → restart Grimoire-demo → restart Loom-demo → loop roster + re-install each Spinner. Prints what it did.                                                                                                                                                                                                                                                                                                                                    |
| **R3**   | FastAPI proxy in `~/webspinner-try/app/main.py`   | **not started** | Generalized routes `POST /api/spinners/<slug>/<capability>` (NOT hardcoded to database-application). Reads bootstrap-demo creds, caches PB-superuser cookie, posts to demo Loom. Validates slug + capability against `/api/roster`. Includes `GET /api/roster` proxied from the demo Loom or read from `~/warp/demo-roster.json` on Kepler.                                                                                                                                                |
| **R4**   | Frontend wiring in `~/webspinner-try/site/app.js` | **not started** | After the existing intro arc, when a menu tile is `available` and the patron's sentence arrives, generate/reuse a `demo-<uuid>` session id in `localStorage`, POST to `/api/spinners/<slug>/propose`, render the structured response. The menu's tile states come from `/api/roster`; tiles flagged `kitchen-out` stay as "coming soon." When new Spinners land, the menu image is updated (cleanly versioned via the asset-mtime cache busting we already have) but no JS changes needed. |

---

## Open deployment decisions (resolve before R0 lands)

Four sub-decisions the Wizard needs to confirm. Defaults below are "mirror operator conventions"; override any of them in this section.

1. **Demo PB data directory.**
   - Default: `~/warp-demo-data/pb_data/` on Kepler (parallel to whatever the operator's PB uses).
   - Alternative: under `~/Library/Application Support/Webspinner Foundation/Loom-Demo/pb_data/`.

2. **Demo Loom env source.**
   - Default: a dedicated env file at `~/warp-demo-data/loom.env` loaded by the launchd plist.
   - Alternative: env vars in the plist directly.

3. **Demo Cell identity key.**
   - Default: generate fresh on first demo Loom boot via the existing `loom/src/lib/server/identity.ts` flow.
   - Alternative: skip signing (install unsigned; the demo Loom's Spinner integrity gate stays as `unsigned` — warning, not gate).

4. **Launchd plist location for the demo services.**
   - Default: `~/Library/LaunchAgents/foundation.webspinner.{grimoire,loom}-demo.plist` (same dir as the operator's plists).
   - Alternative: a separate `~/Library/LaunchAgents/demo/` subdirectory.

---

## Future-Spinner readiness checklist

When a new Spinner is ready to ship to the demo Cell, this is the checklist:

- [ ] Spinner bundle under `spinners/<slug>/` (Genesis-tier) or `~/Cells/spinners/<slug>/` (Cell-authored) on Spindle.
- [ ] Bundle passes `lintSpinnerBundle` (errors: 0).
- [ ] `manifest.json` declares `model: "kepler/<...>"` (sovereign-only on the patron path).
- [ ] `outboundAllowlist` (if any) lists only the credible references the Foundation has approved for public-patron use.
- [ ] `mission-lock.md` enforces the refused-work categories (canon §13) — never tracking another person without consent, never storing credentials, etc.
- [ ] `how-it-works.md` is patron-readable, plain-language, no engineering jargon.
- [ ] Capability handlers wired in `loom/src/lib/server/weaver.ts` if Genesis-tier; or dynamic-import shape for Cell-authored.
- [ ] Roster entry added to `~/warp/demo-roster.json`.
- [ ] `tools/demo-reset` re-runs cleanly.
- [ ] At least one Witness scenario verifies the loop end-to-end.
- [ ] The menu image at `~/webspinner-try/site/brand/menu.jpg` is updated to reflect availability (or the menu becomes data-driven from the roster — Tier-2 refinement).
- [ ] DECISIONS.md entry recording the addition.

When all boxes are checked, the Spinner is live in the demo on next `demo-reset`.

---

## Operating notes — concurrency, rate limits, sandbox

The architecture as designed today serves **one patron at a time** comfortably on Kepler's M2 hardware. Beyond that, these constraints matter:

- **Quiet Loom throughput.** mlx-server on Kepler serializes generations. Two concurrent invocations from two patrons queue at the model. Wall-clock for the second patron grows by the first's duration. For scale beyond ~10 patrons/hour, either: (a) provision a second mlx-server on Hetzner when federation begins (per RUNNERS.md §4), or (b) cap concurrent in-flight invocations in the proxy.

- **Per-session serialization.** `wp_spinner_sessions` is last-writer-wins with no optimistic-concurrency check (per `spinner-session.ts:25-31`). The proxy must serialize calls per `sessionId` — only one in-flight per session. Cross-session calls can proceed in parallel up to the Quiet Loom cap.

- **Per-IP rate limit.** Modest cap (e.g. 3 new sessions per IP per minute, 20 invocations per session per hour) at the FastAPI proxy. Cloudflare Turnstile in front when adversarial traffic appears (deferred — wire when needed).

- **Cost containment.** No paid LLM in scope today — sovereignty constraint. If a future Spinner declares a BYOK model (which the patron-path gate currently refuses), this constraint reasserts: the demo Cell does not use any operator's BYOK keys for patron invocations.

- **Spinner-runtime sandbox.** Today the dispatcher runs in-process inside the demo Loom. A misbehaving Spinner could exhaust the Loom's memory or CPU. The canonical answer (RUNNERS.md) is Firecracker microVMs on a dedicated runner host (Spindle for bootstrap, Hetzner for production). That's Tier 2.1 work; the demo Cell runs in-process until then. The blast radius is bounded by: (a) the demo Loom restart is one launchctl command; (b) state is in the demo Grimoire which is wipeable; (c) no operator data is reachable.

---

## Resume instructions for a fresh Claude session

If the prior session died mid-work and you're picking up:

1. Read `WARP-CANON.md` and `CLAUDE.md` if not already in context (per the boot order).
2. Read this file — the **Status** column tells you the exact resume point.
3. Read `OPEN_QUESTIONS.md` for the _Demo Cell runtime — patron-facing Spinner orchestration_ entry (mirrors this file's open decisions).
4. Read `DECISIONS.md` for the _Demo Cell pattern — patron-facing Spinner runtime architecture_ entry (the durable record of the architectural choice).
5. Continue from the first piece marked **not started**.

Commits land on `main` and push to `origin` after the Wizard has reviewed each piece. Deploy to Kepler via `rsync ~/warp/ johns-mac-studio.local:warp/` then `ssh johns-mac-studio.local 'cd ~/warp && tools/deploy-loom --typecheck'` (operator Loom) and the analogous flow for the demo Loom once R0 is in place.

---

_Authored 2026-05-16. The plan is operative until R0–R4 land and the demo runtime is live. Once live, this file becomes the operating reference for adding future Spinners to the demo Cell._
