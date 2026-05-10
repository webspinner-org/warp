# How the Genesis Spinner Works

The Genesis Spinner provisions a Webspinner Cell on a fresh host — macOS or Linux — and brings it to the point where the Webspinner can sign in to the Loom and take over. It is the encoded version of the work Claude Code did once at the founding (`DECISIONS.md` 2026-05-10 — *Bootstrap Weaver runs inside the Loom*; *God-once exception*), so that no Cell ever needs that exception again.

## Why it exists

A Webspinner who provisions a new Cell should never paste a CLI command. They click `Run` on the Genesis Spinner from an existing Loom (the Foundation's reference Cell, or another operator's Loom that has signed federation rights) and the new Cell stands itself up.

For the very first Cell — the chicken-and-egg case where no Loom yet exists — the Genesis Spinner runs from a tiny CLI bootstrapper (`~/warp/cli/genesis-bootstrap`, open work) that reads the manifest and executes the capabilities locally. After the first Loom is up, every subsequent Cell is provisioned through it.

## What it does (capability by capability)

1. **Provision Toolchain.** Ensures Homebrew (macOS) or apt (Linux) is present. Installs Node (≥ 24), pnpm, PocketBase, Tailscale. Idempotent — re-runs are no-ops on an already-provisioned machine. Verifies versions against the canon's pinned minimums. The bootstrap that founded this Cell ran this manually on Kepler: `brew install node pnpm pocketbase`.

2. **Sync Repo.** Places the Warp repo on the target. For the founding Cell, this was an `rsync` from the operator's authoring machine (Spindle) to the target (Kepler). For Cells provisioned through a Loom, this is a git clone from a signed Foundation mirror or peer-Cell mirror.

3. **Build Workspace.** Runs `pnpm install` and `pnpm -r build` on the target. Produces the SDK's typed bundle, the Loom's SvelteKit Node bundle, every Spinner's compiled entrypoint. The lockfile pins versions; the build is reproducible.

4. **Generate Bootstrap State.** Creates `~/.warp/bootstrap/` with mode `0700`. Generates `vault-master-key` (32 random bytes, base64), `pb-email` (default `wizard@webspinner.foundation`), `pb-password` (24 random bytes, base64url). All files mode `0600`. Idempotent — never overwrites existing keys.

5. **Deploy Grimoire.** Lands PocketBase as a `launchd` LaunchAgent at `~/Library/LaunchAgents/foundation.webspinner.grimoire.plist` on macOS (or a systemd user unit on Linux). Data directory: `~/Library/Application Support/Webspinner Foundation/Grimoire/pb_data/`. Binds `127.0.0.1:8090` only — the Loom on the same host reaches it locally; nothing else does. Loads the agent, waits for health, runs `pocketbase superuser create` from the bootstrap state, then creates the canonical collections (`vault_secrets`, `wp_audit`, `wp_silk_pattern`) idempotently.

6. **Seed Vault.** Reads the operator's BYOK keys from the host's secret store — macOS Keychain (`security find-generic-password -a <name> -w`), GNOME Keyring on Linux, etc. — never from chat or a tool argument. Encrypts each with the vault master key (AES-GCM-256, the canon's wire format). POSTs to PocketBase as a `vault_secrets` row. The Anthropic key seeded for the founding Cell came from `ANTHROPIC_ADMIN_API_KEY` in macOS Keychain; future operators name their own.

7. **Deploy Loom.** Lands the Loom as a launchd LaunchAgent at `~/Library/LaunchAgents/foundation.webspinner.loom.plist`. Working directory is the Cell's repo; entry point is `node loom/build/index.js`; environment includes `WARP_PB_URL`, `WARP_VAULT_MASTER_KEY`, `WARP_PB_EMAIL`, `WARP_PB_PASSWORD` from the bootstrap state. Binds `0.0.0.0:3000` initially (LAN-reachable); a follow-up capability rebinds to the Tailscale interface only once Tailscale is configured.

8. **Verify Cell.** Health checks: Loom answers `200` on `/`, Grimoire health endpoint OK, vault has the operator's BYOK key, the Bootstrap Spinner's manifest loads cleanly through the Loom's spinner loader. Emits one `wp.cell.provisioned` audit event with the Cell's identity key fingerprint, the host's hostname, and a Cell-name (e.g., "Kepler"). After this event lands, the Cell is operational and the Webspinner can sign in.

## What it does *not* do

- **Tailscale auth.** Requires interactive browser sign-in. A separate "Configure Tailscale" capability handles this when the operator chooses; the Genesis Spinner installs the binary, not the identity.
- **Federation.** A new Cell joins federation only by explicit operator action. The Genesis Spinner does not connect a fresh Cell to peers.
- **Domain or DNS.** The bootstrap topology is LAN-only; public-facing DNS is a separate concern when (and if) the operator chooses to expose any capability.

## Status

This Spinner exists today as a manifest plus this documentation — the capability handlers are open work. The recipe encoded here matches what Claude Code ran by hand on 2026-05-10 to provision the first Cell on Kepler (per `DECISIONS.md` 2026-05-10 — *Genesis Spinner: encoding the founding bootstrap*). When the handlers land, the Spinner replays the recipe.
