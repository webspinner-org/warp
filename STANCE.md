# STANCE.md — how we work, and what we're building right now

The operative posture for the current epoch. Read this with
`MISSION-LOCK.md` and `IMPLEMENTATION-PLAN.md`. This file is not the
canon and not the methodology — it is the _stance_: what we are
willing to do, what we are deliberately not doing yet, and the
practice that connects the two.

When this file conflicts with `WARP-CANON.md`, the canon wins. Update
this file when the epoch changes.

---

## Brand and proof are not opposed

The public face of Webspinner — webspinner.ai, the canon, the
Pledge, the recognition story — is a category-defining position.
The implementation in this repo is the proof. The two are not in
tension; they are halves of the same act.

When the site claims a Spinner property the code does not yet
have, that is not dishonesty. That is **commitment**. Software is
the rare medium where the ground rule of commercial sales —
_tell the customer it does the thing, and run back to make it
true_ — applies cleanly. The customer is told the thing is real
because the team has decided the thing will be real, today or this
week. The work is not promising; the work is honoring.

This pattern is the Wizard's standing practice from his custom-
software career. It is operative here.

- We do not lower public claims to match today's code.
- We change the code to match the claim.
- `/roadmap` carries the honesty — anything aspirational is
  named there so the visitor who reads only the hero is not
  misled past the next click.
- Each shipment moves an item from `/roadmap` to the hero. The
  site evolves with the code, not behind it.

Brand carries the _target_; proof carries the _position_. The
gap between them is the work. The work is the joy.

---

## Iteration is daily

Nobody is watching this work yet. The Foundation has no peer
Wizards, no public Skein installs, no inbound community demands on
its release cadence. This window is precious. While it lasts:

- Daily iteration is the unit of progress. The next commit is
  not gated on review by anyone but the Wizard.
- The site can change daily. The canon can change daily. The
  plan can change daily.
- Decisions that turn out wrong are not durable mistakes —
  they are this morning's experiment that next-afternoon's
  commit revises.
- Speed is not in tension with discipline. The discipline is
  _what makes the speed safe_ — every commit ships with tests,
  every Spinner ships with How-It-Works, every architectural
  move gets a `DECISIONS.md` entry the same day.

This stance will tighten when the first peer Wizard adopts a Cell.
At that point, public commits start being observed; release
cadence develops a public contract; the daily iteration slows.
For now, the freedom of pre-adoption is the asset. Spend it.

---

## We are developing software now. We will scale later.

The current epoch is **software**: writing the primitives, the
Spinners, the Loom surfaces, the canon, the manifests, the
documentation. The Cell runs on one Mac. The Skein has four
Spinners. There is one Wizard. The audit chain has tens of
events, not millions.

The features that will matter at scale — and that we will build
_at scale, not before_ — are:

- Platform engineering (multi-host orchestration; rolling
  deploys; blue-green; observability stacks; load balancing)
- Colocation (running the Cell across more than one machine)
- Fault resilience (replication; redundancy; majority
  consensus; graceful degradation)
- Self-healing (liveness probes; reconciliation loops; auto-
  restart on declared-state divergence)
- Fast orchestration at scale (concurrent Warp Threads;
  queues; back-pressure; circuit breakers)
- Portability across host environments at scale
- Security at adversarial scale (rate limits at the edge,
  distributed-denial defenses, intrusion-detection)

These are real concerns, and the Foundation will solve them when
they are concerns. **They are not concerns today.** Building them
now is over-engineering; building toward them now is the work.

The line is sharp:

- **Build the primitive that will scale** — yes.
- **Build the scaling apparatus around the primitive** — no, not yet.

A signing primitive is essential now; a key-rotation control plane
is not. A Spool registry is essential now; cross-Cell Spool
federation is not. A Warp Thread executor is essential now; a
million-thread queueing layer is not. The architecture admits
each scale-out at the right moment.

---

## "Doesn't preclude" — the design constraint

Every primitive we lay must admit the eventual scale-out without
rework. This is the operative discipline. We accept the cost of a
slightly more careful design today in exchange for a slightly less
painful migration tomorrow.

Concrete design rules:

- **Services are addressed by URL.** `WARP_PB_URL`,
  `WARP_QUIET_LOOM_URL`, `WARP_EMBEDDINGS_URL` — all
  environment variables, all swappable. We never hardcode
  `127.0.0.1`. The Cell can grow from one host to many by
  changing URLs.
- **State lives in the Grimoire, never in process memory.**
  The Loom can die mid-invocation; the Grimoire holds the
  invocation. Self-healing is a future feature; resilience to
  Loom restart is today's design.
- **Spinner bundles are language-agnostic at the spec level.**
  The v1 reference is TypeScript/Node, but the manifest schema,
  the bundle digest algorithm, the signing scheme do not
  presuppose JavaScript. A Python or Go or Rust Spinner is a
  future possibility that today's contract admits.
- **The Bootstrap Weaver runs in the Loom — a known shim.**
  The dispatch contract is designed for cross-process IPC even
  though today's call is a function invocation. The canonical
  Python+FastAPI Weaver supersedes when ready;
  today's code does not assume in-process forever.
- **Audit events carry their own UUID, not an autoincrement
  ID.** Every event is deterministically identifiable across
  Cells. The chain reconciles even after migration to a
  different Grimoire.
- **Cell identity is a key, not a hostname.** When the Cell
  moves machines, the key moves with it; the hostname is
  cosmetic. Today this means the Cell's identity-key in the
  vault is the durable name; the launchd plist is the
  ephemeral packaging.
- **Manifests are schema-versioned.** `manifestVersion: "1.0"`
  is in place. Schema evolution bumps major version on
  breaking change; minor on additive. The Weaver gates on
  declared version compatibility.
- **Spinner capabilities have typed JSON Schema contracts.**
  The Weaver enforces input/output schema at the boundary;
  capability evolution does not silently break callers.
- **The audit chain canonicalizes events** (sorted JSON, no
  BOM, single trailing LF) before hashing. Cross-platform
  reproducibility is part of the contract.
- **The vault encrypts with a master key derived from the
  operator's identity.** When a Cell migrates hosts, the same
  operator-controlled key decrypts on the new host. We do not
  bind the master key to a specific machine.

Each rule above is _cheap to honor today_. Skipping any one of
them is what would paint us into a corner. The discipline is to
recognize that today's tiny extra effort is tomorrow's avoided
rewrite.

---

## What we will not build now, even if asked

Stating the negatives explicitly so the discipline holds under
pressure:

- We will not build a high-availability multi-node Loom
  cluster. One Loom per Cell; restart-recovery via the
  Grimoire.
- We will not build a queueing layer in front of Spinner
  invocations. Direct invocation; durability via the Silk
  Pattern.
- We will not build a cross-Cell Capability Bus until two
  Cells actually exist and need to talk. The protocol is
  spec'd in the canon; the wire format is deferred.
- We will not build a Foundation-operated Skein registry
  service until at least three Foundation-recognized Spinners
  exist to populate it.
- We will not build observability beyond the audit chain and
  the Silk Pattern. Prometheus + Grafana + tracing land at
  multi-host scale.
- We will not build Webspinner auth as a separate identity provider
  until the first Webspinner Spinner exists.
- We will not build a key-rotation control plane. A documented
  manual rotation path is sufficient until rotation actually
  happens.

Each "will not" is a promise to the next epoch's work. When the
condition reverses — peer Wizard arrives, Webspinner Spinner ships,
audit corpus crosses a threshold — the corresponding "not" lifts.

---

## When this stance changes

The stance is for this epoch. The triggers that end the epoch:

- **A peer Wizard adopts a Cell.** Daily iteration tightens.
  The site's `/roadmap` becomes a public roadmap. Release
  cadence develops a public contract.
- **A Webspinner Spinner ships.** The Webspinner Loom surface ends
  the "operator-only" framing. Webspinner auth becomes load-
  bearing.
- **The first cross-Cell Capability Bus call lands.**
  Federation becomes real. The Spool sensitivity-classification
  contract becomes load-bearing.
- **An adversarial actor probes the Cell.** Security at
  scale becomes today's work, not tomorrow's.

Until any of those triggers fire, this stance holds. When one
fires, this file gets updated _first_, then the implementation
shifts.

---

## The practice, summarized

1. The site is the commitment. The code is the proof. The
   work bridges them.
2. Iteration is daily; the freedom of pre-adoption is the
   asset.
3. Build primitives that scale. Don't build scaling
   apparatus before there is scale.
4. Each primitive admits the eventual scale-out without
   rework. Cheap honoring today; cheap migration tomorrow.
5. State the negatives explicitly. The discipline holds
   under pressure.

---

_Updated 2026-05-12. The Wizard is the sole operator. The Cell is
on one Mac. The Skein has four Spinners. No peer Wizard yet. The
stance holds._
