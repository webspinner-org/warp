# WEAVER-SETUP.md

Provisioning specification for the primary Weaver Cell on Hetzner. This document is the bootstrap reference for standing up the always-on Weaver that will govern Claude Code sessions across all Webspinner repos.

## Hardware target

A dedicated GPU server. Recommended specs in priority order:

- **GPU.** At least 48 GB of VRAM. Acceptable: NVIDIA RTX 6000 Ada (48 GB), NVIDIA L40S (48 GB), NVIDIA A100 80 GB, NVIDIA H100 80 GB. With 48 GB you run a 70B-class model in 4-bit quantization plus embeddings, reranker, and headroom. With 80 GB you have room for 70B at higher precision or a second model warm.
- **CPU.** 32+ modern cores (AMD EPYC or Intel Xeon Gold). The Weaver is not CPU-bound but indexing, the BYOK gateway, the audit pipeline, and Postgres all run alongside inference.
- **RAM.** 128 GB minimum, 256 GB preferred. vLLM, the embedding model, the reranker, Qdrant, and Postgres all want resident memory.
- **Storage.** 1 TB+ NVMe primary for OS, models, and the Grimoire. 4 TB+ secondary for audit logs, Grimoire backups, and growth. Models alone can occupy 200–500 GB depending on what you keep loaded.
- **Network.** 1 Gbps unmetered or generous quota. Egress to BYOK providers is the dominant traffic; inbound from Spindle/Kepler is small but latency-sensitive.

If Hetzner's GPU offerings in Hillsboro do not match (Hetzner's primary US GPU presence has historically been Ashburn; verify current availability), evaluate equivalents at Latitude.sh, Lambda, or a colocated build before settling.

## Operating system

**Ubuntu 24.04 LTS Server**, minimal install. Reasons: NVIDIA driver and CUDA support are best, vLLM and the rest of the Python stack assume glibc-modern Linux, the LTS support window is long enough for the Weaver's expected lifetime.

After install:
- Set hostname (suggestion: `weaver-hill-01.warp.<your-domain>`).
- Create a non-root operator account; disable root SSH; enforce key-only SSH.
- `apt update && apt upgrade && apt install build-essential git tmux htop nvtop iotop ufw fail2ban`.
- Enable unattended security upgrades.
- `ufw default deny incoming; ufw allow OpenSSH; ufw allow 443/tcp` — the Weaver's public surface is HTTPS only. Other ports get opened only for explicit federation transports as they come online.

## GPU drivers and CUDA

- Install the latest NVIDIA driver matching the GPU's recommended branch.
- Install CUDA Toolkit (version per the vLLM release you target — vLLM's compatibility matrix is the source of truth).
- Install cuDNN matching the CUDA version.
- Verify with `nvidia-smi` and a small CUDA sample.

Pin driver and CUDA versions in a `provisioning/versions.txt` file once the Weaver code lands, so reinstalls are deterministic.

## Network and DNS

- Assign the server a stable public IP.
- Create DNS records for `weaver.warp.<your-domain>` (A and AAAA) pointing at the server.
- Issue a TLS certificate via Caddy or Let's Encrypt + a reverse proxy. Caddy is recommended — it terminates TLS, proxies to the Weaver, auto-renews. One-line `Caddyfile`.
- For Spindle/Kepler federation, install Tailscale or WireGuard. Tailscale's mesh and ACLs simplify the home-network ↔ Hetzner connection without exposing more public ports.
- Public surface from the Internet: 443 only. Federation traffic with Spindle/Kepler rides over the mesh VPN.

## Software stack

Install in this order. Document exact versions in `provisioning/versions.txt` as you go.

1. **Python 3.12** via the deadsnakes PPA or `uv` for Python management.
2. **`uv`** as the Python package manager (`pip install uv` then use `uv` from there). Faster than pip, deterministic locks.
3. **Postgres 16** for session state, audit log, and decision log. Single-instance, on-box. Tune `shared_buffers`, `work_mem`, `wal_level`, `max_wal_size` for the box size.
4. **Qdrant** as a single-binary service for vector storage. Runs locally, listens on a Unix socket or localhost only.
5. **vLLM** for local model serving. Run as a systemd unit. Bind to localhost only — the Weaver service is the only client.
6. **The Weaver service itself** (Python + FastAPI). Source from this repo when the code lands. Run as a systemd unit. Bind to localhost; reverse-proxied by Caddy on 443.
7. **LiteLLM** as the BYOK gateway shim — invoked by the Weaver, configured with the user's BYOK keys via environment variables loaded from a sealed secrets store (see Secrets).
8. **Embedding and reranker models.** Download and cache: BGE-M3 for embeddings, BGE-reranker-v2-Gemma (or comparable) for reranking. Stored under `/srv/warp/models/`.
9. **The Grimoire content.** Initial corpus is the *AI Enclosure* manuscript (`~/ai-enclosure/`) chunked, embedded, and indexed in Qdrant. Subsequent corpora — other Webspinner repos, decisions, bibliography — added as they are ready.

## Service layout

Each major component runs as its own systemd unit, managed under a `warp-` prefix:

- `warp-postgres.service` (Postgres)
- `warp-qdrant.service` (Qdrant)
- `warp-vllm.service` (local model serving)
- `warp-weaver.service` (the Weaver Python service — depends on the three above)
- `warp-caddy.service` (TLS termination and reverse proxy)
- `warp-tailscale.service` (mesh VPN)

Logs to journald with a daily rotation. Audit log is separate — append-only, written to disk in addition to Postgres, with cryptographic chaining (spec pending).

## Storage layout

```
/srv/warp/
├── models/              # downloaded model weights (cached)
├── grimoire/            # chunked corpus source files (read-only, version-controlled)
├── qdrant/              # vector DB on-disk state
├── postgres/            # PG data directory
├── audit/               # append-only audit log files
├── backups/             # local backups before off-site sync
└── secrets/             # sealed; mode 0700 to a single service user
```

Off-site backup target: encrypted snapshots of `audit/`, Postgres dumps, and Qdrant snapshots, replicated to a Hetzner Storage Box or B2/S3. Encryption keys held by the operator only — host has the data, you have the keys.

## Secrets

BYOK API keys (Anthropic, OpenAI, Google, others), Postgres credentials, certificate keys, audit-log signing keys.

- Store under `/srv/warp/secrets/` with mode 0700 and ownership restricted to the Weaver service user.
- Loaded into the Weaver via `systemd` `EnvironmentFile=` directives.
- Rotated on a schedule appropriate to each provider (typically quarterly; immediately on suspected compromise).
- Never committed to the repository. `.gitignore` covers the obvious patterns.
- Long-term: migrate to a hardware-backed key store (the Hetzner box does not have a TPM by default; a YubiHSM or comparable is the upgrade path).

## Bootstrap checklist

A condensed checklist for first deployment.

- [ ] Hetzner GPU server provisioned, networked, accessible by SSH.
- [ ] Ubuntu 24.04 minimal installed; non-root operator account; firewall enabled.
- [ ] DNS record for `weaver.warp.<your-domain>` resolves to the server.
- [ ] NVIDIA driver, CUDA, cuDNN installed and verified with `nvidia-smi`.
- [ ] Python 3.12 + `uv` installed.
- [ ] Postgres 16, Qdrant, Caddy, Tailscale installed and running as systemd units.
- [ ] vLLM installed; one local model (recommendation: a 70B-class open-weight in 4-bit) downloaded and serving on localhost.
- [ ] Embedding and reranker models cached under `/srv/warp/models/`.
- [ ] BYOK keys placed in `/srv/warp/secrets/` and loaded into the Weaver service environment.
- [ ] *AI Enclosure* manuscript chunked, embedded, indexed in Qdrant.
- [ ] Weaver service running, MCP endpoint reachable from Spindle.
- [ ] Caddy fronting the Weaver on 443, TLS working.
- [ ] Off-site backup of audit log, Postgres dumps, and Qdrant snapshots verified by restore test.
- [ ] Spindle's Claude Code configured with the Weaver as an MCP tool; first end-to-end query lands and is grounded.

## What this document is not

- Not the Weaver's source code. That lives under `weaver/` once written.
- Not the Grimoire indexer's source. That lives under `grimoire/` once written.
- Not the wire-protocol spec for the Capability Bus. That lives under `protocols/` once specified.
- Not a production runbook. Operational procedures (incident response, rollback, scaling) get their own document under `ops/` once the Weaver is past first deploy.

This file is the bootstrap. It tells a competent operator what to set up and in what order so the rest of the work has somewhere to land.

## Reference

- `WARP-CANON.md` — the architectural canon.
- `~/ai-enclosure/chapters/14-the-compute-farm.md` — Cold/Warm/Hot tiering rationale.
- `~/ai-enclosure/chapters/17-privacy-by-design.md` — threat model and defenses.
- `~/ai-enclosure/chapters/16-the-architecture-of-sovereignty.md` — key handling and audit obligations.
