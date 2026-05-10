# Loom — testing

Two harnesses, both runnable from `loom/`:

## Vitest — unit tests for server modules

```sh
pnpm test          # one-shot
pnpm test:watch    # watch mode
```

What's covered today:

- `src/lib/server/shell.test.ts` — the shell-capability allowlist, no-shell-spawn invariant, cwd sandbox to `$HOME`, timeout behaviour.
- `src/lib/server/journal.test.ts` — the cosine similarity invariant the recall pipeline relies on (L2-normalised embeddings → dot product).
- `src/lib/server/markdown.test.ts` — `renderMarkdown` headings, em-dash preservation (canon §14), inline and fenced code.

Add new specs as `src/**/*.{test,spec}.ts`; they're picked up by `vitest.config.ts`.

## Playwright — end-to-end browser tests

```sh
# default — assumes a Loom at localhost:4173 (SvelteKit preview)
pnpm preview &
pnpm test:e2e

# against the deployed Loom on Kepler (LAN + Tailscale)
WARP_E2E_BASE_URL=http://johns-mac-studio.local:3000 pnpm test:e2e
```

`test:e2e` reads PocketBase superuser creds from `~/.warp/bootstrap/pb-email` and `~/.warp/bootstrap/pb-password`. They're surfaced as `WARP_PB_EMAIL` / `WARP_PB_PASSWORD` to the suite.

What's covered today:

- `e2e/vault.spec.ts` — splash → login → vault add → verify dates render → delete.
- `e2e/skein.spec.ts` — Skein listing shows registered Spinners; search filters in real time.
- `e2e/journal.spec.ts` — record a journal entry → appears in recent → filter by kind retains it; bootstrap context generates and contains the expected header.

Single worker; sequential — tests mutate shared PocketBase state and we don't want races. Browsers tested: Chromium and WebKit (Safari surface). For fast iteration run `--project=chromium` only.

## Notes

- Playwright tests must run against a host matching the Loom's `ORIGIN` env (`http://johns-mac-studio.local:3000` in the bootstrap topology). Calling `127.0.0.1:3000` from outside the Loom process triggers SvelteKit's CSRF protection on POST forms — 403 "Cross-site POST form submissions are forbidden".

- Journal entries written by e2e are uniquely named (`e2e-journal-<timestamp>-<rand>`) so reruns don't collide. The collection accumulates them; clean up with a PB query if it gets noisy.

- The vault test creates and immediately deletes its own secret.

- Pablo's `review` capability is not yet covered by e2e (each invocation costs ~15-30s of Quiet Loom inference). Manual smoke via `tools/pablo <route>` is the current loop.
