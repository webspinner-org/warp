# DECISIONS.md

Append-only log of architectural and process decisions for the Warp repo. Each entry is dated. Once written, do not rewrite — supersede with a new entry that references the prior one.

Format:

    ## YYYY-MM-DD — Short title
    **Decision:** What was decided.
    **Why:** The reason, in a sentence or two.
    **Supersedes:** (optional) prior decision title and date this replaces.

---

## 2026-05-10 — License: Apache 2.0 with trademark held by the Foundation

**Decision:** The Warp repository is licensed under the Apache License 2.0. The names *Warp* and *Webspinner* are trademarks of the Webspinner Foundation, held separately from the code license per Apache 2.0 §6. See `TRADEMARK.md`.
**Why:** The book (manuscript ch. 16, ch. 25) prescribes Apache 2.0 for Foundation reference work. The trademark separation is the lever the Foundation Pledge depends on (ch. 26 §6).

## 2026-05-10 — Contribution model: DCO sign-off

**Decision:** Contributions require Developer Certificate of Origin sign-off (`Signed-off-by:` line on every commit). No CLA at this stage.
**Why:** Lower friction; consistent with the small-organization posture in manuscript ch. 25. A CLA may be added later if Foundation operations require it.

## 2026-05-10 — Glass-house development

**Decision:** All Warp development happens in the public repo from the start. Initial development concerns about third-party visibility are explicitly waived.
**Why:** Direct user instruction. Aligns with the Foundation's transparency posture; sovereignty for the architecture's eventual users is the constraint, not for the Foundation's own development process.

## 2026-05-10 — Hardware roles

**Decision:**
- **Hetzner Hillsboro** (GPU server, to be provisioned per `WEAVER-SETUP.md`): primary Weaver Cell. Always-on. Authoritative.
- **Kepler Studio**: local-network performance tier. Smaller warm MLX model, Grimoire mirror. Federates to Hetzner; not authoritative.
- **Spindle (M5 Max MacBook Pro)**: the Loom. Authoring surface. Federates to Kepler at home, Hetzner elsewhere.
**Why:** Hetzner uptime and GPU capability beat what the home network and Apple Silicon can give for an always-on policy governor. Glass-house posture removes the data-residency objection. Kepler stays useful as a low-latency tier when on the home network. Spindle remains the working surface.

## 2026-05-10 — Default stack

**Decision:**
- Python 3.12 + FastAPI for the Weaver service
- LiteLLM as the BYOK gateway shim (replaceable later)
- vLLM for local-model serving on Hetzner GPU
- Qdrant for vector storage (single binary, on-box)
- Postgres 16 for session state and audit log
- BGE-M3 for embeddings; BGE-reranker-v2-Gemma (or comparable open-weight) for reranking
- MCP SDK in Python for Claude Code integration
**Why:** Each component is mature, open, and integrates cleanly with the others. The shims (LiteLLM especially) are explicitly replaceable in a later phase with Webspinner-built equivalents that adhere to the WRAG and Capability Bus specifications.

## 2026-05-10 — Tapestry retired as cross-repo source of truth

**Decision:** The previous `~/webspinner/tapestry` document is no longer the cross-repo authoritative spec for Warp. The *AI Enclosure* manuscript (`~/ai-enclosure/`) is the canonical text, distilled in this repo's `WARP-CANON.md`, and indexed in the Grimoire when the Weaver is live.
**Why:** Direct user instruction. The manuscript is now complete and is a more comprehensive, more disciplined, and more publicly defensible source of truth than the working tapestry it grew from.

## 2026-05-10 — The Weaver as Claude Code's exteriorized working memory

**Decision:** The Weaver's role extends beyond policy enforcement and BYOK routing. It also serves as the persistent session-state store and task-specific context provider for Claude Code sessions across all Webspinner repos. A `session_resume(cwd, task_hint)` MCP tool returns a tight context bundle so sessions do not bootstrap from accumulated CLAUDE.md files every time.
**Why:** Two months of working with bloated, auto-loaded CLAUDE.md files have shown them to slow Claude and produce mixed boot behavior. The Memex pattern from manuscript ch. 12, applied to the development process itself, is the right structural answer.

## 2026-05-10 — Mission-locked Weaver system prompt

**Decision:** The Weaver injects a mission-locked system prompt in front of every LLM call it routes. The prompt declares the Foundation Pledge as operative law, asserts the strict vocabulary and voice constraints, and directs the model to advance the Warp architecture rather than serve as a general assistant.
**Why:** The Weaver is not a general-purpose tool. The Pledge cannot be optional. Encoding the mission at the system-prompt layer makes alignment structural rather than aspirational.
