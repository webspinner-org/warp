# In-flight: Webbase rename + app.webspinner.ai surface + author dashboard

**Status:** in progress, started 2026-05-18.
**Branch:** `main` (Wizard authorized direct commits).
**Authorizing message (verbatim):**

> "OK, we need the 'source' to be in the author's cell. It needs to
> remain after a 'publish'. The publish lets anyone run it. When you
> modify a webbase app later you publish it again. Then the changes
> are live. If you don't see any problems with this model, then you
> can do all of this work. It won't take you 3-4 hours if you don't
> ask me any stupid quaetions. I don't need human-in-the-loop if you
> take care to protect the blast radius of your changes. Good luck."

Plus an addendum: _"Since one author can publish multiple
[applications], when they login to the app.webspinner.ai it needs to
list all of their apps in a nice UX. Identifying their published apps."_

## Operating constraints

- **Blast radius**: only the `try` demo + Warp Loom internals + the
  webspinner-try Python proxy + one Kepler cloudflared config line.
  Leave every other repo alone.
- **Never run `tools/demo-reset`** — wipes the Wizard's own apps.
- **No human-in-the-loop** for reversible changes; do not ask.
- Auto-commit at natural rest points with DCO sign-off + `Co-Authored-By: Claude Opus 4.7 (1M context)`. Push without asking is OK in this session per prior auth; never `--no-verify`; never amend.
- **Vocabulary**: SI not AI, Cell not tenant, Loom not frontend,
  Spinner not agent, Webbase not WSAP (patron-facing), Publish not
  Export, Open not Install (recipient-facing).

## Topology

- **Spindle** (`Johns-MacBook-Pro-M5-Max`) — this dev host. Edit code
  here under `/Users/johndavidmarx/warp/`, `/Users/johndavidmarx/webspinner-try/`.
- **Kepler** (`johns-mac-studio.local`, ssh works) — production Mac
  Studio. Demo Loom :3010, demo Grimoire :8091, prod cloudflared
  daemon `com.webspinner.cloudflared-prod` reading
  `~/.cloudflared/config-prod.yml`, tunnel UUID `6769505b-1212-46cd-997c-466fa52bfd1f`.
- Deploy via `tools/deploy-loom` on Kepler (rsync from Spindle if `SPINDLE_SYNC=1`).

## Architecture decisions

### Source remains in author's Cell

`wp_database_applications` row (keyed by sessionId) is the source of
truth. Publishing **copies** the design + schema into a signed
`.webbase` bundle and stores it in `wp_app_packages`. Re-publishing
the same source overwrites the same registry row so the install URL
stays stable across edits.

### Upsert key

`wp_app_packages` rows are keyed by `(cell_key_fingerprint, origin_app_id)`.
`publishPackage` looks up by this pair:

- If found → `PATCH` the row, preserving `short_code` and
  `install_token` (URL stability), bump a `version` counter, refresh
  `wsap_json`, refresh `app_name`, refresh `expires_at` (extend
  retention each republish).
- If not found → INSERT with fresh `short_code` + `install_token`.

### Naming map (patron-facing only)

| Old                                         | New                                                  |
| ------------------------------------------- | ---------------------------------------------------- |
| `.wsap` extension                           | `.webbase`                                           |
| MIME `application/x-webspinner-app+json`    | `application/x-webbase+json`                         |
| format string `wsap/v0.1`                   | `webbase/v0.1` (verify accepts BOTH for back-compat) |
| Button text "Export Application"            | "Publish"                                            |
| Modal lede "Share this application"         | "Publish this Webbase"                               |
| Route `/install/<code>`                     | `/app/<code>` (with 301 from `/install/`)            |
| Email subject "ready to install"            | "ready to share"                                     |
| Install preview button "Install in my Cell" | "Open this Webbase"                                  |
| Term _application_ (in app surface)         | _Webbase_                                            |

Internal symbols (`wsap.ts`, `WsapBundle`, `buildWsapBundle`,
`putPackage`) keep their names to limit blast radius. Only
patron-visible strings and the bundle's `format` field change.

### Author dashboard

- Live at `app.webspinner.ai/` (root).
- Login = same email-verify flow (6-digit code) but mints an
  HMAC-signed **author session cookie** `warp_author=<base64url(email|expiry|hmac)>` (7-day TTL, separate from Loom session).
- `GET /me` (or `/`) → lists all `wp_app_packages` rows where
  `sender_email = me`, sorted by `updated DESC`. For each:
  - Webbase name, patron sentence, last published, version count
  - Open URL (with token, copyable)
  - Installs remaining, expiry date
  - "Open" → goes to `/app/<shortCode>?t=<token>` (recipient surface,
    but author can use it too)

### Simple security (passphrase)

- Patron sets an optional unlock passphrase at Publish time.
- Server stores `passphrase_hash` (scrypt N=16384,r=8,p=1) + 16-byte
  salt. Never the plaintext.
- `/app/<code>` shows an unlock dialog if a passphrase is set; 3/min/IP rate-limited via in-memory map.

### Cloudflare ingress

Add to `johns-mac-studio.local:~/.cloudflared/config-prod.yml`:

```yaml
- hostname: app.webspinner.ai
  service: http://127.0.0.1:3010 # demo Loom
  originRequest:
    connectTimeout: 30s
```

Plus the DNS CNAME `app` → `6769505b-1212-46cd-997c-466fa52bfd1f.cfargotunnel.com` (Cloudflare API with `webspinner-ai-try` token).

Then `launchctl kickstart -k system/com.webspinner.cloudflared-prod`.

## Step-by-step (for crash recovery)

1. **[done]** Persist this doc.
2. **[done]** Identify topology (Spindle vs Kepler).
3. **[in progress]** Server: extend `wsap-registry.ts` collection
   schema (`cell_key_fingerprint`, `origin_app_id`, `app_name`,
   `domain`, `version`, `passphrase_hash`, `passphrase_salt`); add
   `upsertPackage`, `listPackagesBySender`.
4. **[pending]** Server: rename format string `wsap/v0.1` →
   `webbase/v0.1` in `wsap.ts`, keep verify accepting both.
5. **[pending]** Server: author session lib
   (`author-session.ts` — mint/verify HMAC cookies).
6. **[pending]** Server: routes
   - `POST /author/login/start` { email }
   - `POST /author/login/finish` { email, code }
   - `POST /author/logout`
   - `GET /me` (and `GET /` on app.webspinner.ai)
   - `GET /app/[shortCode]` (renamed from /install)
   - `GET /install/[shortCode]` → 301 to `/app/<code>`
7. **[pending]** Server: `publish/+server.ts` calls `upsertPackage`,
   optionally hashes passphrase, broadens email body.
8. **[pending]** webspinner-try (Python proxy + JS): rename copy,
   pass-through new routes.
9. **[pending]** Kepler: cloudflared config-prod + DNS CNAME +
   daemon kickstart.
10. **[pending]** Deploy both Looms, smoke test.
11. **[pending]** Commit; push.

## Resume hint

If a fresh Claude starts:

1. `cat ~/warp/INFLIGHT-WEBBASE-RENAME.md` (this file).
2. `git -C ~/warp status` to see in-flight diff vs main.
3. Continue at the first `[pending]` step.
