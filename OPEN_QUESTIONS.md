# OPEN_QUESTIONS.md

Questions in flight. Promote settled questions to dated entries in `DECISIONS.md` and remove them from this file. Add new questions as they arise; do not silently let them drift.

Format:

    ## Short title
    **Question:** What is open.
    **Why it matters:** What hinges on the answer.
    **Status:** Where the thinking currently sits.

---

## Hetzner GPU availability in Hillsboro

**Question:** Does Hetzner currently offer dedicated GPU servers in the Hillsboro region with the specs `WEAVER-SETUP.md` calls for (48 GB+ VRAM, 128 GB+ RAM, NVMe storage, generous network)? Their primary US GPU presence has historically been Ashburn.
**Why it matters:** Determines whether the primary Weaver lives at Hetzner Hillsboro as planned, or whether a peer provider (Latitude.sh, Lambda, a colocated build) needs to be evaluated.
**Status:** Needs verification by the operator before the bootstrap checklist runs.

## Capability Bus protocol — first concrete spec document

**Question:** What is the wire format, message envelope, and signature scheme for the Capability Bus? The manuscript (ch. 13) describes the design; the spec text has not been written.
**Why it matters:** Required before any independent implementation, before federation can be tested between Spindle/Kepler/Hetzner Cells, and before Foundation-aligned recognition can apply to a third-party implementation.
**Status:** Spec pending. Will live under `protocols/capability-bus/` once drafted.

## WRAG protocol — formal pipeline spec

**Question:** What is the formal specification for the seven-stage WRAG pipeline (ch. 12)? Field schemas, intermediate representations, citation formats, audit-trail format.
**Why it matters:** Required for conformance testing across Grimoire implementations and for the grounding-verification stage to be checkable.
**Status:** Spec pending. Will live under `protocols/wrag/` once drafted.

## Audit log — cryptographic chaining scheme

**Question:** What is the exact scheme for the append-only, tamper-evident audit log (ch. 16)? Hash function, chaining structure, signature, periodic anchoring (e.g., to a transparency log)?
**Why it matters:** The Five Rights' "Right to Inspect" depends on an audit trail that cannot be silently rewritten. The scheme has to survive realistic compromise scenarios.
**Status:** Spec pending. Will live under `protocols/audit/` once drafted.

## Sensitivity classification — taxonomy and classifier model

**Question:** The manuscript (ch. 7) names Public/Personal/Confidential/Privileged as illustrative. What is the Foundation's recommended default taxonomy, what model serves as the default sensitivity classifier in the Weaver, and how is misclassification handled?
**Why it matters:** Sensitivity drives routing. A wrong classification can leak Privileged-class material to a BYOK provider. The classifier must be auditable and overridable.
**Status:** Open. Needs both a taxonomy proposal and a classifier-model choice (likely a small fast local model for low latency).

## Federation contract format

**Question:** What does a federation contract look like as a serializable artifact? Capability scopes, peer identity references, expiration, revocation mechanism, audit-log obligations.
**Why it matters:** Federation patterns (Family/Small-business/Community/Cooperative/Public, ch. 11) need a concrete form. Without it, federation is informal and ungovernable.
**Status:** Spec pending. Will live under `protocols/federation/` once drafted.

## Recognition process for aligned implementations

**Question:** The Foundation Pledge (ch. 26) and `TRADEMARK.md` reference a process by which a third-party implementation may apply for recognition as a Foundation-aligned implementation. What is the process? Who reviews? What evidence is required? How is recognition revoked?
**Why it matters:** The trademark policy assumes the recognition pathway exists. Until it does, the policy is one-sided.
**Status:** Open. Will be drafted alongside the Foundation governance documents.

## Post-quantum cryptographic migration

**Question:** Which post-quantum cryptographic primitives does Warp commit to, and on what timeline? The architecture is designed to support cryptographic agility (ch. 17), but the migration is future work.
**Why it matters:** Long-lived Cell identities and audit logs need to remain verifiable across the post-quantum transition.
**Status:** Tracking NIST PQC standardization. No commitment yet.

## How does Hetzner Hillsboro federate cleanly with Spindle and Kepler over a residential NAT?

**Question:** Tailscale or WireGuard solves it operationally, but is one preferred for the Weaver's threat model? Tailscale uses a third-party coordination server; WireGuard does not.
**Why it matters:** Aligns or misaligns with the architecture's "no central operator in the federation" commitment.
**Status:** Tailscale recommended for operational simplicity in `WEAVER-SETUP.md`. To be revisited when the threat-model implications are written up under `ops/`.
