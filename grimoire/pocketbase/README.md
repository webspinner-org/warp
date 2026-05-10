# Grimoire — PocketBase (bootstrap)

Bootstrap Grimoire for the Webspinner Foundation Cell. SQLite-backed, single-node, with built-in TOTP MFA. PocketBase is the bootstrap data layer per `DECISIONS.md` 2026-05-10 — *PocketBase as the bootstrap Grimoire*; it migrates to canonical Postgres + Qdrant when the WRAG seven-stage pipeline lands.

## Deploy (Kepler-local)

PocketBase runs on Kepler co-located with the Loom. No public hostname; reached on `127.0.0.1:8090` from the Loom server-side, no tunnel.

```sh
cd ~/warp/grimoire/pocketbase
docker compose up -d --build
```

Verify:

```sh
curl -fsS http://127.0.0.1:8090/api/health && echo OK
```

## Update PocketBase

Bump `PB_VERSION` in `Dockerfile` and `docker-compose.yml` (keep them in lockstep), commit, then on Kepler:

```sh
cd ~/warp/grimoire/pocketbase && git pull && docker compose up -d --build
```

## Data and backups

`pb_data` is a named Docker volume. Backups land with the audit-log scheme (`OPEN_QUESTIONS.md` — *Audit log — cryptographic chaining scheme*). Until that lands, manual snapshots:

```sh
docker run --rm -v pocketbase_pb_data:/data -v "$(pwd)":/out alpine \
  tar czf /out/pb-data-$(date +%Y%m%d).tar.gz /data
```

## Bootstrap superuser

The PocketBase superuser is created on first run via the PocketBase admin UI on `127.0.0.1:8090/_/`. Email and password are persisted in `~/.warp/bootstrap/pb-email` and `~/.warp/bootstrap/pb-password` (mode 600) — these are bootstrap files until the vault holds them under canon Operating Principle §17.2.
