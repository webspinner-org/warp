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

## 17. Operating Principles

Operating-level principles that complement the Pledge (§11) and the Covenant (§12). The Pledge binds the Foundation. The Covenant binds Cell operators in the federation. These principles bind the day-to-day operation of the Webspinner Foundation Cell and of any Cell whose operator adopts them. They were promoted to the canon by direct operator instruction (`DECISIONS.md` 2026-05-10 — *Operating Principles promoted to canon*).

1. **Admin-First.** Every state-changing platform-engineering action — DNS change, secret rotation, deploy, scale, monitor, audit — must be performable through the Admin Utility (the Loom). Once the Loom-side capability for an operation exists, performing that operation by any other means is a violation. The bootstrap exception applies until the Loom can govern itself.

   *Why:* every operations mistake at human scale is operations that happened in a shell with no audit trail. Provenance, rollback, and access control require a single chokepoint. The Loom is that chokepoint, and it is the Cell's attack-surface boundary by §3 — concentrating operations there concentrates auditability where the architecture already concentrates control.

2. **No Secrets via Claude Code.** The Wizard never pastes credentials into a Claude Code session. Secrets live in the vault, entered through the Loom under E2E encryption, retrieved by services at runtime via authenticated calls to the Weaver. Claude Code may *read* secrets when granted vault access for a task. Claude Code never *writes* them.

   *Why:* secrets that pass through a Claude Code session are recorded in the conversation's API logs, may be carried into compressed-context summaries, and may surface in transcript exports. The vault is the only place a credential lives where its lifecycle, scope, and rotation are first-class. When this rule is broken in either direction, flag the breach, complete the task, and rotate the affected secret immediately afterward.

3. **Production-Candidate Quality Only.** No throwaway scripts. No half-baked work. Every line of code earns its place as a Warp component, a Spinner definition, or operational hygiene. *Webspinner builds Webspinner.*

   *Why:* prior practice in adjacent repositories accumulated technical debt at the same rate it shipped value, because Claude Code was used as a one-off action engine rather than as an architecture-extending tool. The discipline is structural: every artifact is something the canon would defend.

4. **Observable, Resilient Spinner State.** Every Spinner invocation reports state the Loom can read. Long-running work reports progress; the Loom *polls* (pulls) — never receives push-only updates. State is persisted in the Grimoire, indexed for fast queries, and survives Spinner death. A Spinner that crashes mid-invocation leaves recoverable state behind, and the Loom shows the partial work plus a clear indication that the Spinner died. The Webspinner is never left wondering what is going on.

   *Why:* push-only progress is fragile — a dead Spinner cannot push, and the Loom is left silent. Polling is robust: the Loom asks "what is the state of invocation N?" against the Grimoire on every UI tick, and the Grimoire's answer is authoritative. The Wizard's directive (`DECISIONS.md` 2026-05-10 — *Observable, resilient Spinner state*) is operative: state management is well-constructed, persisted, and fast.

5. **Wow as Baseline.** Every UX surface the Webspinner sees — the Loom, transactional emails, public marketing, registry listings — is animated, illustrated, beautifully typeset, polished. Wow is not a feature on the roadmap; it is the floor. Lazy interfaces and technical debt are not tolerated. The Webspinner should be impressed and awed at the power Warp enables, not asked to forgive its rough edges.

   *Why:* the Webspinner is not a CLI user. The vernacular is the Wizard's, not the technologist's. A Webspinner who is awed by the Loom learns the architecture by using it; one who is asked to forgive a clunky surface learns to mistrust it. The discipline is structural — there is no "we will make it pretty later" — because *later* is where technical debt and broken promises live.

6. **Test Discipline.** Every Spinner capability, every Loom surface, every shared module ships with a regression net. Two harnesses — Vitest for pure logic and server modules, Playwright for end-to-end browser flows — live in the workspace and are run before each release tag. New behaviour without a corresponding test is a structural violation, equivalent to a missing How-It-Works document. The Wizard does not catch regressions by remembering to click the surface; the harness catches them.

   *Why:* a Cell of one Wizard can absorb the occasional regression by hand-testing the next time he opens the surface. A Cell that has admitted a peer Wizard cannot — every regression at peer-handoff becomes a debt the peer pays for. The discipline is structural so that the Foundation's federation arrives without that debt. (`DECISIONS.md` 2026-05-10 — *Test harness — Vitest unit + Playwright e2e*.)

7. **Session Continuity through the Journal.** Operational state between Claude Code sessions in `~/warp/` flows through the Wizard's Journal Spinner. The Journal's `bootstrap` capability composes a markdown context block — current focus, recent actions, last decisions, open questions — that the Wizard writes to `BOOTSTRAP.md` at the repo root. `CLAUDE.md` loads `BOOTSTRAP.md` if present, ahead of the deep canon dive. The Journal is not the canon; it carries operational continuity the canon does not. (`DECISIONS.md` 2026-05-10 — *Close meta-bootstrap loop*.)

   *Why:* the canon is the architecture, fixed in time per its revisions. The Journal is the moment-to-moment of building, and the moment-to-moment is what the next session needs to pick up where the last one left off. Without the Journal, every new session reconstructs the operational state from `DECISIONS.md` + `OPEN_QUESTIONS.md` + git log, which is lossy. With it, the Wizard's ADD is no longer the operative bottleneck on session-to-session memory.

---

## 18. Mission Lock for Claude Code Sessions

The contract under which Claude Code operates in `~/warp/` and any Webspinner repository that adopts the canon. The full text lives in `~/warp/MISSION-LOCK.md` and is loaded automatically alongside `CLAUDE.md` on every session.

The Mission Lock binds Claude Code to:

1. The Pledge (§11), the Covenant (§12), and the Operating Principles (§17) as operative law for the session.
2. The strict vocabulary (§2) and the voice discipline (§14) for every artifact produced.
3. The agent-factory role: Claude Code writes agent definitions; agents run from the Warp UX and do the work. Direct implementation by Claude Code is a bootstrap exception that shrinks every session.
4. The refused-work categories (§13).
5. End-of-turn self-check before each response.

Today the mechanism is text-as-context (Mission Lock loaded via `CLAUDE.md` auto-load; enforcement is moral and contextual). The settled future state (`DECISIONS.md` 2026-05-10 — *Mission-locked Weaver system prompt* and *The Weaver as Claude Code's exteriorized working memory*) is that the Weaver mediates every outbound Claude Code LLM call through LiteLLM, injecting this Mission Lock as the system prompt and routing by sensitivity, with full audit-log capture in the Grimoire. Mission-lock-as-text becomes mission-lock-as-mediated-policy.

The migration path is open work — see `OPEN_QUESTIONS.md` *Mission Lock enforcement mechanism — text vs. mediated*.

---

## 19. Spinners, Spinner Weaving, Spools, Silk Patterns, Skein, and Warp Threads

The runnable computational units of Warp are **Spinners**. The act of authoring them is **Spinner Weaving**. The data sources Spinners draw from are **Spools**. A Spinner's persistent memory is its **Silk Pattern**. The discoverable catalogue of Spinners is the **Skein**. Compositions of Spinner capabilities into workflows are **Warp Threads**. These terms are operative; do not call them "agents," "workflows," "registries," "data sources," or other generic substitutes. The vocabulary is the architecture — substitute terms drag in connotations the canon does not carry. (`DECISIONS.md` 2026-05-10 — *Spinners replace agents in canonical vocabulary*; *Skein, Spools, Silk Patterns named in canon*.)

### 19.1 What a Spinner is

A Spinner is a sealed, signed, integrity-stamped unit of work registered with a Cell's Weaver. It declares:

- a stable name (`@<scope>/<kebab-case>`) and a human-readable display name;
- the **capabilities** it provides — typed input/output schemas, audit emissions;
- the **vault references** it needs at runtime — by `vault://` URI, never embedded;
- the **environment** it expects;
- the **other Spinners** it depends on;
- its **documentation** — including a required *How It Works* document the Loom renders for the Webspinner;
- whether it is **threadable** — composable into a Warp Thread;
- the **CloudEvents source** under which it emits audit.

The schema is `SpinnerManifest` in `@webspinner-foundation/sdk/manifest.ts`.

A Spinner is invoked **only** through the Weaver. Any other invocation path is unauthorized; the Weaver's audit chain captures the breach. This is structural, not a policy: the Spinner's entrypoint is loaded by the Weaver and exposed only via the Weaver's capability surface, not on a network or as a script.

### 19.2 Integrity and stamping

Every Spinner has a content-addressable **digest** of its canonical bundle (manifest + documentation + entrypoint module bytes), computed in the form `<algorithm>:<hex>` (`sha256` today; algorithmically-agile for the post-quantum migration). The digest is the operative integrity primitive.

Spinners are **signed** by their publishers. Foundation-published Spinners carry signatures from the Foundation's release key. Cell-published Spinners carry signatures from the publishing Cell's identity key. Signatures are over the digest with `ed25519` (today). The full scheme — key custody, rotation policy, recognition revocation — is open work (`OPEN_QUESTIONS.md` — *Spinner integrity and signing scheme*).

On every load — install, invocation, and registration into a Warp Thread — the Weaver re-computes the digest from the bytes on disk and re-verifies signatures. Failure modes are explicit (`SpinnerIntegrityStatus` in the SDK):

- `digest-mismatch` — bundle has been tampered with. Load is **gated** — the Webspinner sees a warning before anything runs. Audit emits `wp.spinner.integrity.fail` with `action: 'gated'`.
- `signature-invalid`, `unknown-signer` — gated, same audit.
- `unsigned` — surfaced as a warning, not a gate. The Wizard's policy decides whether to invoke.
- `pending-install` — observed digest only; no install record yet to compare against.

The discipline is borrowed from container-image practice: digests are content addresses, signatures are publisher attestations, the runtime re-verifies on every load.

### 19.3 Spools — what Spinners read from

A **Spool** is a registered data source a Spinner draws from at invocation time. The canon is a Spool. The manuscript is a Spool. The audit log is a Spool. A Cell's own document collection is a Spool. The vault is *not* a Spool — secrets are referenced by `vault://` URI under a different lifecycle and a different threat model.

A Spool's source is opaque to the Spinner: the Weaver gives a Spinner `context.read(spoolName, query)` and returns passages. The Spinner does not know whether the Spool is a flat file, a vector index, a federated peer's retrieval capability, or a live API. This is canon §4 (WRAG) applied uniformly — *we do not ask the model to know the source. We ask the model to reason about what the Spool returned.*

Spools are sensitivity-classified per §7. The Weaver enforces routing: a Spool classified Privileged never feeds a BYOK call routed off-Cell. A Spinner whose declared Spools include a Privileged Spool cannot itself be invoked via a model the Cell has not authorized for Privileged-class content.

A Spinner declares its Spool references in the manifest (`SpinnerManifest.spools` in the SDK). The Weaver enforces the reference: a Spinner cannot read from a Spool it has not declared, even if the Spool is registered with the Cell.

### 19.4 Silk Pattern — Spinner memory

A Spinner's **Silk Pattern** is its persistent memory: the history of invocations plus aggregate metrics, surfaced in the Loom as a placard on the Spinner's detail page. Every invocation appends one entry. The placard shows the most recent entries, the metrics window (default 30 days: total invocations, successes, errors, denials, average duration, last-invoked timestamp), and the per-entry summary of what was invoked, what came back, and how long it took.

The Silk Pattern is a denormalised view sized for the Webspinner's eye, distinct from the Grimoire's full audit chain. Both exist; the audit chain is the source of truth, the Silk Pattern is the Loom-rendered surface. A Spinner with no Silk Pattern visible in the Loom is not production-candidate.

### 19.5 Skein — the catalogue of Spinners

The **Skein** is the discoverable catalogue of Spinners — Foundation-published and Cell-published — that a Cell can install. Items in the Skein show their digest, signatures, and source provenance *before* any install. The Foundation recognition process governs what signatures the Skein accepts; recognition revocation governs how a previously-trusted publisher exits.

The Skein is reachable from the Loom at `/admin/skein`. The currently-installed subset is at `/admin/spinners`. A Spinner's detail page renders the same shape whether it is loaded from the Skein (preview, before install) or from the installed set (live, after install).

### 19.6 Spinner Weaving — composition modularity

Webspinner is modular by design. A Spinner does one thing well; complex behaviour is composed.

Composition lives in **Warp Threads**: typed sequences of Spinner capability invocations with declared inputs, declared outputs, and bindings between them. The schema is `WarpThreadManifest` in the SDK. A Warp Thread is itself an artifact: named, displayName-bearing, documented, integrity-stamped — the same shape as a Spinner.

Bindings between thread steps reference earlier outputs by step id and a dot-path. Thread inputs and outputs are themselves typed (JSON Schema). A Spinner whose `threadable` field is `false` cannot appear as a step.

A capability from day one. The thread runtime — step ordering, partial-failure semantics, retry policy, audit-event correlation — is open work (`OPEN_QUESTIONS.md` — *Warp Thread runtime*).

### 19.7 The UX is the architecture

The Webspinner UX is everything. As Spinners do work, the SI explains itself transparently in the Loom. Every Spinner ships a *How It Works* document; the Loom renders it. Every capability has a `displayName` and a plain-language description. Every invocation is narrated, audited, and reviewable.

A Spinner that does not document itself is not production-candidate. A capability without a `displayName` is not registerable. A workflow whose steps cannot be explained in the Loom is not a Warp Thread.

This is operative — not a polish concern. Per Operating Principle §17 — *Production-Candidate Quality Only* — a Spinner whose documentation is missing or whose capability descriptions are placeholder text fails the bar.

### 19.8 Refused behaviours for Spinners

Spinners inherit the refused-use categories of §13. In addition:

- A Spinner must not run outside the Weaver. The reference implementations refuse to expose entrypoints through any other path. A Spinner that does is a structural violation, regardless of its declared capabilities.
- A Spinner must not silently use the Webspinner's data for purposes the manifest does not declare and the Webspinner has not authorized.
- A Spinner must not embed credentials in its bundle. Secrets are vault-referenced. Embedding violates Operating Principle §17.2 and is detectable by the canonical-bundle scanner (open work).

### 19.9 Spinners registered with this Cell

The Webspinner Foundation Cell ships four Spinners as of v0.5. Each is a sealed bundle under `~/warp/spinners/<slug>/` with `manifest.json`, `mission-lock.md`, `how-it-works.md`, `README.md`, `thumbnail.svg`, `src/index.ts`. Each is registered with the Weaver and discoverable via the Loom's Skein view (`/admin/spinners`).

- **`@webspinner-foundation/bootstrap`** — the founding Spinner. Capabilities: `consult` (answer a question grounded in the canon and the manuscript), `audit` (find drift between an artifact and the canon), `record` (draft a `DECISIONS.md` entry in canonical format), `surface` (list unfinished threads to counter ADD drift). Model: Quiet Loom (Qwen2.5-14B-Instruct on Kepler).

- **`@webspinner-foundation/pablo`** — the design-quality reviewer. Capability: `review` (walk a rendered HTML surface against the cited library and return severity-tagged findings). Theatrical in voice; exact in citations. References live as a Spool at `spinners/pablo/library/` — `contrast.md`, `typography.md`, `composition.md`, `brand-consistency.md`, `cards.md`, with `f-pattern-scanning.md` and `progress-revealing.md` added in v0.6. A computed-styles snapshot from the in-browser Pablo button improves CSS-value grounding. Model: Quiet Loom.

- **`@webspinner-foundation/wizards-journal`** — the operational diary. Capabilities: `record` (append a kind-tagged entry, embedded for recall), `recall` (semantic search via cosine against MiniLM-L6-v2 embeddings), `bootstrap` (compose a markdown context block for the next Claude Code session; optionally writes to `BOOTSTRAP.md`). Storage: PocketBase `wp_journal_entries`. The Journal is the operative substrate for §17.7 (Session Continuity).

- **`@webspinner-foundation/genesis`** — the re-runnable Cell provisioning Spinner. Capabilities (8/8 implemented as of v0.5): `provisionToolchain` (probe Homebrew / Node / pnpm / Tailscale / git), `syncRepo` (rsync or `git clone`), `buildWorkspace` (pnpm install + build), `verifyCell` (HTTP probes for Loom / Grimoire / vault), `generateBootstrapState` (vault master key + dev bypass token + PB superuser creds as mode 0600 files under `~/.warp/bootstrap/`), `seedVault` (encrypt operator BYOK keys into the vault collection), `deployGrimoire` (PocketBase launchd plist), `deployLoom` (Node Loom launchd plist). Uses the **shell-capability contract** — a `shellAllowlist` in the manifest declares the binaries the Weaver may invoke on the Spinner's behalf; out-of-list commands throw `ShellPermissionError`. Idempotency primitive: write-if-different-with-force-flag; refuse otherwise.

When new Spinners ship, add them here and reference the dated DECISIONS entry.

---

*This canon is a working document. When the manuscript or the architecture changes, this file changes with them. When in doubt, the chapter wins.*
