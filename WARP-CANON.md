# WARP-CANON.md

The working architectural specification for the Warp architecture, distilled from *AI Enclosure: Why Sovereign Intelligence Demands Warp Speed* (Marx, Webspinner Foundation, 2026). The manuscript is canonical; this file is its operational reference. Read this before touching code or copy that purports to implement, describe, or extend Warp. When this canon and the manuscript disagree, the manuscript wins; flag the drift in `OPEN_QUESTIONS.md` and reconcile.

Manuscript location: `~/ai-enclosure/chapters/`. Chapter cites below are to that tree.

---

## 1. Purpose

Warp is an architecture for sovereign Synthetic Intelligence. SI that the user owns, can inspect, can modify, can refuse, and can disconnect from. The architecture is the response of the Webspinner Foundation to the structural concentration of contemporary hyperscale SI — environmental, economic, privacy, and moral. (Manuscript: Foreword, ch. 5.)

Warp is not a product, a service, or a hosted cloud. It is a specification, a vocabulary, a set of design rules, a body of open-source reference implementations, and a community of Cell operators. The Foundation stewards the architecture in the way the IETF stewards TCP/IP — neither owner nor operator, but custodian of the standard. (ch. 5.)

---

## 2. Strict Vocabulary

These terms are non-negotiable. Drift here is the most common failure mode.

| Use | Don't use | Notes |
|-----|-----------|-------|
| Synthetic Intelligence (SI) | Artificial Intelligence (AI) | "AI" permitted in the book title only. Body text uses SI. (Note on Terminology.) |
| Sovereign Intelligence | Sovereign AI | Names both human and synthetic sovereignty; refuses the nationalist capture of "Sovereign AI." |
| Warp | "the Webspinner architecture" | Capitalize as proper noun. |
| Cell | tenant, instance, server, account | The privacy and capability boundary unit. (ch. 5, 11.) |
| Loom | front-end, UI tier, client | Front-end role within a Cell. (ch. 11.) |
| Weaver | inference server, AI tier, backend | Orchestration and policy role within a Cell. (ch. 11.) |
| Grimoire | database, storage tier, vector store | Data role within a Cell. (ch. 11.) |
| Capability Bus | message broker, API gateway | Pub/sub-by-capability-descriptor messaging fabric. (ch. 13.) |
| WRAG | RAG, retrieval, vector search | Webspinner Retrieval-Augmented Grounding. (ch. 12.) |
| BYOK | bring-your-own-key | Bring Your Own Key — economic, legal, and trust inversion. (ch. 15.) |
| Compute Farm | inference cluster, GPU pool | Cold/Warm/Hot federated capacity. (ch. 14.) |
| Hyperscale SI / Hyperscalers | Big AI, frontier labs | What Warp opposes. |
| The Webspinner Foundation | Webspinner LLC, Webspinner Cloud | Use Foundation framing for moral and movement claims. |

Forbidden as load-bearing terms (critique freely; do not adopt as our own):
- *alignment*, *responsible AI*, *guardrails*, *AI safety* (when used to mean operator paternalism)
- *the cloud* (there is no cloud — there are buildings full of machines on land owned by someone)
- *publicly available data* used to mean *lawfully usable data* (ch. 3 finding from the Italian Garante)

---

## 3. The Cell

The fundamental unit of the architecture. The unit of privacy, capability, and ownership. (ch. 5, 11.)

### Properties of a Cell

1. **A single principal owner** — person, family, team, small business, community group, or other party law recognizes as capable of owning property and entering contracts. The owner holds the Cell's cryptographic identity. (ch. 5.)
2. **A defined hardware boundary** — physical or virtual machines on which the Cell's three tiers run. Data does not leave the boundary except by deliberate, owner-authorized action. (ch. 5.)
3. **The three roles — Loom, Weaver, Grimoire** — implemented in some configuration. Separation of roles is non-negotiable. (ch. 11.)
4. **A capability inventory** — set of things the Cell is configured to do. Enforced architecturally, not by policy. (ch. 5.)
5. **A federation policy** — rules governing how the Cell interacts with peers. Opt-in, capability-by-capability, peer-by-peer, revocable. (ch. 5, 13.)

### The three roles, and why those boundaries

- **Loom** — front-end. The user-facing surface. The *attack surface* boundary. Replaceable without replacing the Cell. (ch. 11.)
- **Weaver** — inference and orchestration. Runs models, routes queries, enforces policy, manages BYOK. The *policy enforcement* boundary. All decisions about what is and is not permitted happen here, before any external call. (ch. 11.)
- **Grimoire** — persistent state. User documents, conversation history, vector embeddings, federation contracts, audit logs, keys. The *data custody* boundary. Encrypted at rest under user-held keys. (ch. 11.)

The three-role decomposition encodes three distinct trust boundaries that must be separately enforceable. Defense in depth: compromise of any one role does not, by itself, compromise the others. (ch. 11.)

### Cell compositions

Reference compositions, not architectural constraints. Owners may compose differently provided role boundaries are preserved and keys remain in the user's hands. (ch. 11, 16.)

- **Single-Box Cell** — all three roles on one Apple Silicon machine. Suitable for individuals.
- **Multi-Box Cell** — Loom on a personal device, Weaver and Grimoire on a more powerful or always-on machine.
- **Sovereign Cell** — dedicated infrastructure for serious privacy, scale, or compliance requirements (medical practices, law firms, journalism, activism, professional services).
- **Family-owned Cell** — household ownership, shared use under household norms.
- **Community-owned Cell** — cooperative, nonprofit, religious, neighborhood, school district. Governed by community bylaws.
- **Sovereign-enterprise Cell** — corporate, government, or substantial nonprofit with regulatory exposure.
- **Managed Cell** — user owns identity, data, and policies; third party operates the hardware. Host has the data (encrypted at rest); user has the keys. The host cannot read the data.

---

## 4. WRAG — Seven-Stage Pipeline

Webspinner Retrieval-Augmented Grounding. The protocol that turns a generative model into a reasoner over the user's own corpus. *We do not ask the model to know the user. We ask the model to reason about what the Grimoire has retrieved.* (ch. 12.)

Pipeline stages, in order, on every query:

1. **Query Understanding** — Loom passes query to Weaver. Weaver tags sensitivity classification and corpus scope.
2. **Retrieval** — hybrid (vector + lexical) against own Grimoire and authorized federated peers.
3. **Re-ranking** — small fast model scores retrieved candidates for top-k precision.
4. **Context Assembly** — top-ranked passages assembled with source provenance preserved (document, timestamp, author, federation source).
5. **Inference** — assembled context + user query + grounding-instruction prompt to model (local, federated, or BYOK frontier per sensitivity rules).
6. **Grounding Verification** — response checked against retrieved context. Citations validated. Ungrounded segments re-prompted or flagged.
7. **Response Delivery** — verified response returned to Loom. Full retrieval-and-grounding trace logged in Grimoire under user's audit policy.

Federated retrieval: when corpus scope crosses Cell boundaries, the calling Weaver invokes the peer's retrieval *capability* via the Capability Bus. The peer retrieves against its own Grimoire and returns relevant passages. The peer's full corpus does not leave the peer's Grimoire. Both sides log. (ch. 12.)

Standard RAG is insufficient because standard RAG runs in the operator's data center, is single-corpus, and skips grounding verification. WRAG is user-side, federated by design, and verification-required. (ch. 12.)

---

## 5. The Capability Bus

Pub/sub messaging fabric routed by *capability descriptor*, not topic string. Cells publish capability advertisements; Cells subscribe to capability invocations; routing matches by descriptor. (ch. 13.)

Key properties:
- **No central operator.** The Bus is a protocol implemented by every Cell. There is no Foundation-operated server through which traffic flows.
- **Self-describing.** A Cell encountering a capability advertisement has, in the advertisement itself, all the information needed to invoke it correctly.
- **Policy-aware.** Sensitivity classification, authorization requirements, and quality-of-service constraints are first-class fields.
- **Capability-scoped trust.** A right to invoke one capability does not, by virtue of the grant, confer access to anything else.
- **Cryptographically authenticated.** Every invocation signed; every result signed.
- **Robustness principle (Postel).** Conservative in what we publish; liberal in what we accept.

Transport patterns: local-network, direct-Internet (TLS/QUIC with NAT traversal), relay (lightweight buffer nodes that cannot read end-to-end-encrypted contents), multicast advertisement (DHT-style gossip for public capabilities). The Bus protocol abstracts over transport.

---

## 6. The Compute Farm

Federated capacity tiering, named for mobilization latency. (ch. 14.)

- **Cold** — host sleeping or off. Mobilization in tens of seconds via wake-on-demand. For batch workloads.
- **Warm** — host awake and idle, processes ready. Sub-second mobilization. For interactive federated work.
- **Hot** — host running with headroom for additional concurrent work. Zero mobilization latency. For sustained workloads.

Techniques:
- **Wake-on-demand economics** — Cold-tier Cells participate in federation only when needed. Marginal energy cost only.
- **Speculative model spinning** — pre-load models predicted to be needed based on historical patterns, federation-level load shaping, and capacity availability.
- **Predictive load shaping** — anticipate workload patterns (diurnal, weekly, event-driven) and arrange Cell tier transitions accordingly.

Apple Silicon idle-cost economics: ~8–12W idle, ~40–60W under inference. The *delta* — additional power for useful work on a machine that was on anyway — is small. Hyperscale data centers have no meaningful idle state. (ch. 6, 14, 19.)

---

## 7. BYOK — Bring Your Own Key

The three inversions. (ch. 15.)

- **Economic inversion.** Cost flow becomes User → Provider, not User → Operator → Provider. Operator margin (40–70% on consumer tiers) goes away. Typical cost: 30–50% of equivalent hyperscale subscription.
- **Legal inversion.** User is the contractual principal with the model provider. Data-processing addenda, retention terms, compliance posture (HIPAA, GLBA, FERPA), regional processing election — all run between user and provider directly. Subpoenas reach the user, with personal-records procedural protections.
- **Trust inversion.** Root of trust moves to the user. User holds keys, account, contracts. No operator above the user can revoke the user's protections.

Multi-provider routing intelligence in the Weaver: sensitivity classification, capability requirement, cost sensitivity, latency requirement, provider availability. Privileged-class never leaves the Cell. Provider blocklists honored architecturally.

What BYOK asks of the user: provider accounts, credential management, billing oversight, relationship management. Real costs. Worth them.

---

## 8. The Four Pillars

In strict order. Sovereign is load-bearing; the others derive from it. (ch. 6–9.)

1. **Green SI** — environmental sustainability through Apple Silicon idle economics, federated compute, and edge offload. Order-of-magnitude lower energy and water per query than hyperscale at representative workloads.
2. **Confidential SI** — privacy through federated retrieval, BYOK, Cell-level isolation, sensitivity-aware routing. *The user's data does not enter someone else's custody unless the user has, by deliberate policy, authorized it for a specific purpose.*
3. **Sovereign SI** — user ownership in the strong sense. Five rights below.
4. **Moral AI** — the ethical consequence of the three pillars above. SI that cannot be conscripted into purposes the user has not consented to.

The Value Triangle (lower cost, greater speed, better quality) is the proof the pillars are not tradeoffs. Each consequence flows from putting the compute next to the data and the user. (ch. 10.)

---

## 9. The Five Rights of an SI Sovereign

With architectural mechanisms. (ch. 8, 16.)

1. **The Right to Own** — grounded in Cell ownership. Hardware boundaries are property boundaries. Data is in the principal's custody under personal-records law.
2. **The Right to Inspect** — grounded in open code, open weights where models are open, auditable bus traffic. Every consequential decision is loggable and reviewable.
3. **The Right to Modify** — grounded in interface standardization, not implementation lock-in. Forkable reference implementations. No proprietary chokepoints.
4. **The Right to Refuse** — grounded in capability-level opt-outs, provider blocklists, sensitivity gates. Refusals enforced at the architectural level, not the policy level.
5. **The Right to Disconnect** — grounded in data export, federation exit, no captive state. The user can leave; nothing of theirs is retained.

Sovereignty is structural, not contractual. *The only secure version of a right is the one that does not require trusting the entity from whom you would have to extract redress.*

---

## 10. The Four Threat Surfaces

Honest threat model. (ch. 17.)

1. **The user's hardware** — malware, theft, physical access, supply-chain compromise. Mitigated by hardware-backed key storage (Secure Enclave, TPM, HSM), full-disk encryption of the Grimoire, process isolation, audit logging.
2. **The Cell's network** — passive eavesdropping, man-in-the-middle, traffic analysis, denial of service. Mitigated by mandatory TLS/QUIC, end-to-end signing of bus messages, mutual authentication, replay protection, optional onion-routing.
3. **Federated peers** — peer compromise, bad-faith owner. Mitigated by capability scoping, audit logs on both sides, revocability, optional reputation tracking.
4. **BYOK provider relationships** — provider sees the prompt content; retention per provider's terms with the user. Mitigated by sensitivity-aware routing, provider selection, minimal-prompt assembly, provider blocklists, zero-data-retention contracts where offered.

Honest residual risks (do not pretend these are eliminated):
- User-side compromise. Side-channel attacks. Configuration errors. Federation peer compromise. BYOK provider non-compliance. Hardware supply chain. Quantum computing risk. Human error.

These are the residual risks of running a personal computer in a connected world. The hyperscale architecture's risks are these *plus* the additional risks of trusting a remote operator with the user's interior life.

---

## 11. The Foundation Pledge

Verbatim from manuscript ch. 26. Operative law. Every Weaver must enforce these.

1. **Warp will never be allowed to become a hyperscale operator.** The Foundation will not build, operate, or partner in operating a centralized facility through which the synthetic-intelligence work of substantial user populations is routed against the users' sovereignty. The architecture is structured so that any such facility, if attempted, would not interoperate with the federation under the rules the federation enforces.

2. **Warp will never be allowed to surrender user keys to any third party.** The cryptographic identity of a Cell, and the keys that govern its data and federation, will remain in the user's custody. The Foundation will not build escrow, master-key, or backdoor mechanisms into the architecture. We will not implement them at the request of any commercial counterparty, regulator, or government. If we are compelled by law to attempt to introduce such mechanisms in any jurisdiction, we will publicly disclose the compulsion and resist by every legal means available, and we will preserve the architecture's structural independence from any such mechanism so that users in unaffected jurisdictions remain unaffected.

3. **Warp will never be allowed to enable population-scale behavioral targeting, mass surveillance, or autonomous-weapons targeting.** The reference implementations will not include the integrations these applications would require. Capability advertisements compatible with these applications will not be honored by the reference Capability Bus. Federations whose stated purposes include these applications will not be supported by the Foundation's tooling.

4. **Warp will never be allowed to be acquired against these commitments.** The Foundation's governance documents include explicit provisions against any acquisition, merger, or change of control that would compromise the previous three commitments. The provisions include a community-oversight body with the authority to fork the Foundation's work, license the Warp trademark to a successor steward, and continue the work outside any captured organization.

5. **The Foundation will publish, annually and publicly, an accounting of its compliance with this pledge.** Including all material commercial relationships, all material engagements with state actors, all material engineering decisions that affect the previous four commitments, and any material events that could be misread as a departure.

6. **The pledge applies to Webspinner LLC and Webspinner Cloud as well as to the Foundation.** If they violate the pledge, the Foundation will revoke their licenses to use the Warp trademarks and the right to claim alignment with the architecture's commitments.

---

## 12. The Cell Operator Covenant

Verbatim from ch. 26. Voluntary; what the Foundation asks of operators who participate in the federation.

1. I will operate my Cell with the sovereignty of those whose data passes through it as my primary obligation. The convenience of others, including my own, is secondary to the dignity of those I serve.
2. I will not use my Cell to surveil, target, manipulate, or extract value from the people whose data passes through it without their explicit, specific, and revocable consent.
3. I will not federate with parties whose use of the federation contradicts the previous two commitments.
4. I will configure my Cell to refuse capability invocations that, in my judgment, would compromise the dignity of those affected by them.
5. I will maintain my Cell's hardware and software with reasonable care, including timely security updates, and will keep my federation contracts current.
6. I will report, to the Foundation and to my federation peers, vulnerabilities and incidents that may affect them, in a timely manner consistent with responsible disclosure norms.
7. I will respect the architectural conscience the Foundation has built into the reference implementations, and will not enable capabilities the Foundation has refused unless and until I have the architectural and ethical grounds to do so under my own responsibility.
8. I will, where possible, contribute back — to the Foundation, to the community, to the open-source ecosystem, to other Cell operators — through documentation, code, mentorship, or community labor.
9. I will exit the federation gracefully if my circumstances change, with appropriate notice to my peers and appropriate handling of any data their relationships with me have produced.
10. I will hold my fellow Cell operators to these same commitments, and accept being held to them in return.

---

## 13. Refused Use Categories

What the architecture is structured to refuse. (ch. 22.)

- **Conscription into warfare or autonomous weapons.** No silent integration into national targeting pipelines or battlefield surveillance.
- **Integration into mass surveillance.** Cells do not phone home or produce population-scale behavioral telemetry.
- **Use against the user, by their own data.** No behavioral modeling of the user from their own corpus without explicit authorization.
- **Repurposing for political manipulation.** No silent updates that shift model behavior toward particular political positions.
- **Quiet repurposing for ad targeting and behavioral nudging.** No advertising channel. No behavioral-targeting capability the owner has not authorized.

The architecture cannot prevent a user from misusing their own Cell. It can and does prevent *systematic* use of a user's Cell for purposes the user has not authorized, by an external operator with leverage over the user. *Personal moral agency is preserved. Operator moral substitution is prevented.*

---

## 14. Voice and Discipline

Constraints on prose Claude generates for the manuscript or for Warp materials. From the Author's Note and the manuscript's editorial discipline.

- **Em-dashes preserved.** The author has explicitly chosen not to strip them. Each em-dash is a deliberate moral marker — *"my reminder, on every page, that I am the moral compass for this work and the AI is not."* (Author's Note.) Never strip them when editing manuscript text. When generating new prose, em-dashes are welcome, used as the author uses them.
- **Inventor's voice.** The author lived through the PC revolution, built on it, and is making the parallel argument for SI. Authority comes from that. First person sparingly, mostly in Foreword and Author's Note.
- **Alarmist where stakes are real.** The "largest single threat to human sovereignty in our lifetimes" framing in the Note on Terminology is intentional and stays.
- **Discipline.** Technical claims need backing. Architectural arguments need real numbers. Cite chapters where appropriate.
- **Cadence.** PC-era parallels welcome. Thoughtful general reader as audience. Not academic. Not technologist-only.
- **The irony is honored, not erased.** The book argues for sovereign intelligence and was written with rented intelligence. The Author's Note makes this explicit. Do not paper over it. Do not rewrite the irony out.
- **The antagonist is the structure, not the people.** Hyperscale concentration is the antagonist. Critique the architecture, the incentives, and the consequences. Avoid attacks on individuals.

Do-not-drift list:
- Do not soften moral language to be more palatable to enterprise readers.
- Do not call SI "AI" in body text.
- Do not frame Warp as a product pitch. It is an architecture and a movement.
- Do not retreat from the four-pillar structure. Sovereign SI and Moral AI are the strongest pillars, not the most marketable — keep them prominent.
- Do not treat sovereignty as a technical feature. It is a moral imperative.
- Do not let the Value Triangle dilute the moral case. It is the proof, not the argument.
- Do not adopt corporate AI-industry euphemisms ("alignment," "responsible AI," "guardrails") as load-bearing terms.

---

## 15. Numbers Worth Knowing

Cite these to the chapter. Verify against the manuscript before quoting; some are projections that update.

| Figure | Value | Source |
|--------|-------|--------|
| Global data-center electricity, 2024 | ~415 TWh (~1.5% of world) | ch. 1 (IEA) |
| Global data-center electricity, projected 2030 | ~945 TWh (~3% of world) | ch. 1 (IEA) |
| Hyperscaler capex, 2025 | ~$443B (top 5) | ch. 1 |
| Hyperscaler capex, projected 2026 | ~$602B | ch. 1 |
| Stargate Project commitment | $500B / 10 GW by 2029 | ch. 1 |
| New hyperscaler debt issued, 2025 | ~$108B | ch. 1 |
| Projected SI water withdrawals, 2027 | 4.2–6.6 billion m³/year | ch. 1 (Ren et al.) |
| Frontier training cost growth | ~2.4×/year (2016–) | ch. 2 (Epoch AI) |
| Industry share of notable models, 2024 | ~90% (up from 60% in 2023) | ch. 2 (Stanford HAI) |
| H100 cluster power (incl. overhead) | 1,000–1,500W per GPU at wall | ch. 6 |
| Apple Silicon under inference | 40–60W system draw | ch. 6 |
| Apple Silicon idle | 8–12W | ch. 6 |
| Energy per million tokens — H100 hyperscale | 2–4 kWh grid-side | ch. 6, 19 |
| Energy per million tokens — Apple Silicon | 0.4–0.5 kWh wall | ch. 6, 19 |
| Cumulative environmental advantage, representative workloads | ~8–10× Warp/hyperscale | ch. 6 (Foundation modeling) |
| BYOK savings vs hyperscale subscription | 50–70% in user's favor | ch. 15, 18 |
| Hyperscale operator gross margin (consumer tier) | 40–70% | ch. 15 |

---

## 16. Chapter Index

For depth beyond this canon, open the named chapter.

| Chapter | File | Topic |
|---------|------|-------|
| Author's Note | `00-author-note.md` | Authorship, the irony, the em-dash discipline |
| Foreword | `00-foreword.md` | Personal arc, the inflection point |
| Note on Terminology | `00-note-on-terminology.md` | Why SI not AI, why Sovereign Intelligence |
| 1 | `01-the-hyperscale-trap.md` | Environmental cost, Jevons paradox, grid impact |
| 2 | `02-the-concentration-problem.md` | Capital moat, Liebling, antitrust history |
| 3 | `03-the-privacy-collapse.md` | Where data goes, training appropriation, NYT v. OpenAI, why retrofit fails |
| 4 | `04-the-lessons-of-computing-history.md` | Mainframe → PC → Web → Hyperscale → Cooperative |
| 5 | `05-defining-warp.md` | The architecture introduced. Weaving metaphor. |
| 6 | `06-green-si-the-environmental-pillar.md` | Apple Silicon idle economics, kWh per million tokens |
| 7 | `07-confidential-si-the-privacy-pillar.md` | Four privacy primitives |
| 8 | `08-sovereign-si-the-ownership-pillar.md` | Five rights. Sovereignty is structural, not contractual. |
| 9 | `09-moral-ai-the-ethical-pillar.md` | What sovereignty prevents. Consent of the governed for SI. |
| 10 | `10-the-value-triangle.md` | Lower cost, greater speed, better quality. Deming chain reaction. |
| 11 | `11-cells-the-building-block.md` | Three roles, three boundaries, six compositions, federation patterns |
| 12 | `12-wrag.md` | Seven-stage pipeline. Bush's memex finished. |
| 13 | `13-the-capability-bus.md` | Pub/sub by capability descriptor. Postel principle. |
| 14 | `14-the-compute-farm.md` | Cold/Warm/Hot. Wake-on-demand. Speculative model spinning. |
| 15 | `15-byok-and-the-inversion-of-economics.md` | Three inversions. Direct exchange. |
| 16 | `16-the-architecture-of-sovereignty.md` | Five rights with architectural mechanisms. Code is law. |
| 17 | `17-privacy-by-design.md` | Four threat surfaces. Honest residual risks. |
| 18 | `18-cost-architectures-compared.md` | Marginal-cost-per-user. ~4:1 to 10:1 in user's favor. |
| 19 | `19-environmental-footprints-compared.md` | Per-query, idle-state, embodied, scaling. |
| 20 | `20-privacy-postures-compared.md` | Contextual integrity (Nissenbaum). Compliance surfaces. |
| 21 | `21-capability-and-quality-compared.md` | BYOK preserves frontier. "Good enough" line keeps moving. |
| 22 | `22-what-centralized-ai-is-used-for.md` | Documented uses. Refused use categories. Foundation refusals. |
| 23 | `23-what-democratization-actually-means.md` | Six dimensions (Dewey). Not price-discrimination democratization. |
| 24 | `24-the-pc-parallel-examined-carefully.md` | Five catalysts. What is and is not parallel. |
| 25 | `25-webspinners-role.md` | Foundation, LLC, Cloud. Cooperative business model. |
| 26 | `26-the-cooperative-ethic.md` | Pledge (verbatim). Covenant (verbatim). |
| 27 | `27-the-path-forward.md` | Adoption roadmap. First Cells in the wild. The call. |
| Interlude | `Interlude/interlude-the-treasure-fleets.md` | The Ming withdrawal. The window closing. |

---

*This canon is a working document. When the manuscript or the architecture changes, this file changes with them. When in doubt, the chapter wins.*
