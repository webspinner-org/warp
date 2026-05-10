# Warp

Reference implementations and protocol specifications for the Warp architecture — sovereign Synthetic Intelligence built from Cells (Loom, Weaver, Grimoire) federated by the Capability Bus, grounded by Webspinner Retrieval-Augmented Grounding (WRAG), and invoked under Bring-Your-Own-Key (BYOK) contracts the user controls.

The architecture and the moral case for it are set out in *AI Enclosure: Why Sovereign Intelligence Demands Warp Speed* by John D. Marx (Webspinner Foundation, 2026). The manuscript is the canonical text. This repo is its working code and protocols.

## What lives here

- **`WARP-CANON.md`** — the architectural distillation Claude Code (and humans) should read before touching anything. Vocabulary, invariants, pillars, pledge, threat surfaces, chapter index.
- **`CLAUDE.md`** — operating directives for Claude Code sessions in this repo. Mission-locked. Eventually delegated to the live Weaver.
- **`WEAVER-SETUP.md`** — provisioning spec for the primary Weaver Cell on Hetzner.
- **`LICENSE`** — Apache License 2.0.
- **`NOTICE`** — attribution and trademark pointer.
- **`TRADEMARK.md`** — what forks may and may not call themselves.
- **`CONTRIBUTING.md`** — how to contribute. DCO sign-off required.
- **`DECISIONS.md`** — append-only decision log.
- **`OPEN_QUESTIONS.md`** — questions in flight.

The actual Weaver, Grimoire, gateway, and protocol specifications will land in subdirectories as they are built. This repo is being developed in public — the glass-house posture is deliberate.

## Stewardship

Warp is stewarded by the Webspinner Foundation. The code is Apache 2.0 — fork it, modify it, run it. The names *Warp* and *Webspinner* are Foundation trademarks. A fork may not call itself Warp or claim Foundation alignment without meeting the Foundation Pledge (see `WARP-CANON.md` and `TRADEMARK.md`). Stewardship lives in the trademark; sovereignty of the architecture lives in the open license. They reinforce each other.

## Status

Early development, in public. The companion manuscript is complete. The reference Weaver is being stood up first on Hetzner; Kepler and edge Cells federate with it. Expect rapid change. Expect the code to lag the manuscript while the implementation catches up to the specification.

— The Webspinner Foundation
