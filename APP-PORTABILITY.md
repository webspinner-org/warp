# APP-PORTABILITY.md — patron-built applications are portable

## What this is

The second of the two kinds of shipping in Warp:

1. **Shipping a Spinner** — Foundation-blessed bundle distributed via the Skein and installed via `tools/webspinner install`. Catalog-published. Already partially implemented (`tools/webspinner`, `wp_skein`).
2. **Shipping a patron-built application** — this document. Peer-signed, peer-shared, peer-installed. The Webspinner who builds a Database Application on their Cell can export it as a single signed file, send it to another Webspinner over any channel they like, and the receiving Cell can install it into their own PocketBase.

The unit of portability is the **Webspinner Application Package** (`.wsap`). The pair Cell + .wsap is enough to bring an app to life on any Cell — no central registry, no Foundation gatekeeping, no Anthropic in the path.

## Bundle format — `.wsap` v0.1

A single JSON object. MIME type `application/x-webspinner-app+json`. File extension `.wsap`.

```jsonc
{
  "format": "wsap/v0.1",            // bundle-format version; receiving Cell rejects unknown majors
  "kind": "database-application",   // which Spinner kind this app is for

  "createdBy": {
    "cellName": "Kepler Studio",         // patron-facing label only
    "cellKeyFingerprint": "ed25519:abc…", // identity proof for the signature below
    "displayName": "John"                // optional; first-name only; no email/address
  },

  "createdFrom": {
    "patronSentence": "I want to keep track of my small-business bookkeeping.",
    "spinnerBundleName": "@webspinner-foundation/database-application",
    "spinnerBundleVersion": "0.1.0",
    "spinnerBundleDigest": "sha256:7caa3c3…",
    "createdAt": "2026-05-17T15:32:24.028Z"
  },

  "design": {
    // The patron's screen-first design — the same shape `wp_database_applications.schema_draft`
    // carries today. Re-rendered by the receiving Cell's runtime.
    "screensDraft": { "appName": "...", "domain": "...", "screens": [...], "navigation": [...] },
    "branding": { "options": [...], "selectedPaletteId": "warm-amber", "customDescription": null }
  },

  "schema": {
    // The derived entity shape. The receiving Cell uses this DIRECTLY for collection creation —
    // it doesn't re-run deriveEntitiesFromScreens(), to guarantee identical layout to the
    // origin Cell. `screensDraftVersion` is set by the authoring Spinner so deriving logic
    // can be matched.
    "screensDraftVersion": 2,
    "entities": [
      {
        "name": "transaction",
        "describes": "...",
        "fields": [{ "name": "date", "kind": "date", "describes": "..." }, ...],
        "links":  [{ "to": "account", "describes": "..." }]
      }
    ]
  },

  "data": null,                       // v1: always null. v2 opt-in flag carries rows.

  "signature": {
    "alg": "ed25519",
    "keyFingerprint": "ed25519:abc…", // must match createdBy.cellKeyFingerprint
    "value": "base64-of-Ed25519(canonical-json-of-fields-above)"
  }
}
```

### Canonical-JSON for signing

The signature covers a _canonical_ JSON serialisation of everything in the bundle _except_ the `signature` field itself: keys sorted, no whitespace, UTF-8, no extra fields. The recipe is identical to the one already used in `tools/webspinner sign` for Spinner bundles — same code path, different kind.

## Decisions for v1 (no asking — settled in this doc)

These are the answers to the open questions I posted earlier; they're now load-bearing.

- **Data is OFF in v1.** Export carries schema + UX only. Receiver lands on an empty app with their structure. v2 adds an opt-in `"data"` field and a merge/replace prompt.
- **Extension + MIME.** `.wsap` and `application/x-webspinner-app+json`. Distinguishable from arbitrary JSON; same shape regardless.
- **Demo surface.** `try.webspinner.ai` ships **export only** ("Take your app with you"). Import lives on real operator Cells (`/admin/db-app/import`). The public demo is session-isolated; the patron's `.wsap` is for taking _off_ of the demo into their own Cell.
- **Re-editability.** A `.wsap` installs as **fully re-editable** if (and only if) the authoring Spinner's `spinnerBundleDigest` matches a Spinner installed in the receiving Cell's `wp_skein`. Otherwise the app is **frozen-as-built** — the Form Studio's _Customize first_ button is greyed out with a tooltip explaining why ("Install the Database Application Spinner v0.1.0 to edit this app's layout"). Data entry still works. Frozen apps light up the moment the Spinner gets installed.
- **App-id semantics.** Imports get a **new `appId`** on the receiving Cell. The bundle carries `createdFrom.originAppId` for provenance — auditable, displayable, but not load-bearing. Two Cells with the same `.wsap` get two independent apps. No forking semantics in v1; that's federation work.
- **Signature ceremony.** Reuses `tools/webspinner sign` infrastructure (same Ed25519 keys, same canonical-JSON, same vault). The CLI gets a `--kind=app` mode; the Loom exposes `POST /admin/db-app/{sessionId}/sign-export` and `POST /admin/db-app/import`.

## Install flow (receiving Cell)

```
patron drops bundle.wsap on /admin/db-app/import
  │
  ├─► verify bundle signature against bundle.signature.keyFingerprint
  ├─► verify format/kind match what this Cell supports
  ├─► display preview to patron:
  │       "App: {appName}
  │        From: {createdBy.cellName} (key: {fingerprint})
  │        Built from: \"{patronSentence}\"
  │        Built on: {createdAt}
  │        Built by Spinner: {spinnerBundleName}@{version} {digest}
  │        Entities to create in your Cell:
  │          - transaction (7 fields, 1 relation to account)
  │          - account (5 fields)
  │          - …
  │        Re-editable: yes ✓  (Spinner is installed)"
  ├─► patron clicks Install
  ├─► allocate new appId (random; not from the bundle)
  ├─► for each entity in bundle.schema.entities:
  │       create PB collection app_{appId}_{slug} with the bundle's schema
  ├─► insert wp_database_applications row { appId, sessionId=null, design=bundle.design, ... }
  └─► land on /db-app/{appId} → patron sees their fresh empty app
```

The patron's identity is decoupled from the imported app — `sessionId` is null on imports. The app is _theirs_ now, owned by the receiving Cell.

## Export flow (authoring Cell)

```
patron clicks "Export this app" in app-mode
  │
  ├─► Loom GET /admin/db-app/{sessionId}/export
  ├─► fetch wp_database_applications row by sessionId
  ├─► construct unsigned bundle: { format, kind, createdBy, createdFrom, design, schema, data: null }
  ├─► canonicalise JSON; sign with Cell's vault key
  ├─► attach signature; return as Content-Type: application/x-webspinner-app+json
  └─► browser saves as {appName}-{appId}.wsap
```

## Tooling layout

| Tool / route                           | Lives at                           | Purpose                                        |
| -------------------------------------- | ---------------------------------- | ---------------------------------------------- |
| `tools/wsap pack <appId>`              | `~/warp/tools/wsap`                | CLI export — useful for ops, not patron-facing |
| `tools/wsap verify <bundle>`           | same                               | inspect a bundle without installing            |
| `tools/wsap install <bundle>`          | same                               | CLI import — useful for ops                    |
| `GET /admin/db-app/{sessionId}/export` | Loom                               | patron-facing export (auth required)           |
| `POST /admin/db-app/import`            | Loom                               | patron-facing import (auth required)           |
| `Export this app` button               | try.webspinner.ai app-mode top bar | patron-facing on demo                          |

## Open questions parked for v2+

- **Data ferrying**. Default off; opt-in toggles "include my records" — needs merge/replace UX on the receiving end.
- **Asset bundling**. If a Spinner ever supports image upload / file attachments, they have to travel. Format flips from JSON to zip-archive containing `manifest.wsap` + `assets/`.
- **Federation primitives**. Forking, syncing, multi-Cell co-ownership. `originAppId` is the breadcrumb we need to thread this later.
- **App.id collision on multi-import**. If the patron imports the same `.wsap` twice, they get two apps. Need a dedupe-or-import prompt in v2.
- **Migration**. When the screensDraft schema bumps (v2 → v3), receiving Cells need a migration table. Bundle's `screensDraftVersion` is the trigger.

## Cross-references

- `WARP-CANON.md §19 (Vocabulary)` — add `Webspinner Application Package (.wsap)` alongside Spinner, Cell, Loom, Spool, Silk Pattern, Skein, Warp Thread.
- `ARTIFACTS-AND-STORAGE.md` — add the `.wsap` to the design-time artifact list.
- `tools/webspinner` — gets a `--kind=app` mode for re-using the Ed25519 ceremony.
- `OPEN_QUESTIONS.md` — close the "two kinds of shipping" entry once the export endpoint ships.

---

_Authored 2026-05-17 in the same session as Form Studio v1. Sequence: this doc → export endpoint → patron-facing export button → import endpoint → tools/wsap CLI._
