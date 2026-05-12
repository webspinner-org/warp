# RUNNERS.md — immutable, ephemeral Spinner execution environments

A **runner** is an immutable, ephemeral execution environment in
which a Spinner is exercised — tested, smoke-invoked, or run for
real — in isolation from the Loom host. The runner is the
operative answer to the question *"how do we execute a Spinner
without polluting the Cell or trusting the Spinner's process
hygiene?"*

Read this with `ARTIFACTS-AND-STORAGE.md` (where Spinners live)
and `STANDARDS.md` (how Spinners are built). When this file
conflicts with `WARP-CANON.md`, the canon wins.

---

## 1. Three properties

The runner discipline rests on three load-bearing properties.

### 1.1 Immutable

The runner **image** is built once, signed, and used many times.
The image carries the runtime (Node, Python, MLX where supported)
+ the Weaver test harness + the schema/sign/digest libraries from
`STANDARDS.md`. **No state persists in the image between runs.**

Each Cell uses a known runner image, identified by its digest.
The image is verified before any instance is launched. Image
updates are explicit operations (`wp.runner.image-rolled`) with
an audit event each.

### 1.2 Ephemeral

Every Spinner execution gets a **fresh runner instance**. The
instance is created at the start of the execution, runs the
Spinner, and is destroyed when execution completes — whether the
execution succeeded, failed, or was cancelled. Logs and audit
events flow back to the Loom over an audited channel. **No other
state survives.**

There is no "warm pool" of partly-used runners. Each run begins
cold. Cold-start is part of the contract.

### 1.3 Encapsulated

The runner has a **typed input** (Spinner bundle + test plan +
secret-references + execution budget) and a **typed output**
(result + audit events + emitted artifacts). The execution surface
itself — what files exist, what processes run, what kernel
features are used — is invisible to the Loom. Only the contract.

This mirrors the Spinner contract: a Spinner's caller sees the
capability schemas, not the implementation. The runner's caller
(the Loom) sees the runner schemas, not the execution backend.

---

## 2. Why runners

A short rationale, with the costs each runner-property pays for.

  - **Untrusted code isolation.** A newly authored Spinner has
    never run. Its first execution should not be in the Loom
    process — a crash, an infinite loop, a memory leak, or a
    hostile artifact would compromise the Loom. The runner
    contains all of that.
  - **Integration-test purity.** Tests against a Cell's real
    Grimoire would pollute its state. A runner instance has no
    Grimoire — it has the bundle + the test plan + simulated
    Spool/vault responses. Tests run clean; the Cell's real
    state is untouched.
  - **Reproducibility.** A runner image at a known digest, a
    Spinner bundle at a known digest, a test plan at a known
    hash — the execution is reproducible. The audit chain
    captures all three. A future operator can re-run the same
    execution and get the same result.
  - **Cost containment.** A runaway Spinner cannot exhaust the
    Loom's resources because the runner instance owns its
    resource cap (CPU, memory, time, disk). When the cap is
    exceeded, the runner kills the instance; the Loom hears
    *"budget exceeded"* and moves on.
  - **Trust boundary clarity.** When a Cell-authored Spinner
    eventually gets shared with a peer Wizard, the runner is the
    isolation seam that makes that sharing safe. The peer's Cell
    runs the foreign Spinner in a runner; if it misbehaves, the
    peer's Loom is unharmed.

---

## 3. Execution backends — pluggable, contract-uniform

The runner contract admits multiple execution backends. Each
backend trades off isolation strength, start-up latency, and
overhead. The Loom picks the backend per the Spinner's declared
isolation class.

### 3.1 Container backend

  - **Tooling:** OrbStack on macOS development; Podman on Linux
    production hosts. Docker as a fallback.
  - **Start-up:** ~200 ms cold.
  - **Overhead:** ~50 MB per container.
  - **Isolation:** namespaces + cgroups + seccomp. Sufficient for
    trusted Spinners (Foundation-recognized; Cell-signed by the
    operator's identity key) during the bootstrap epoch.
  - **When:** development; routine smoke tests of trusted
    Spinners.

### 3.2 Firecracker microVM backend — the production default

  - **Tooling:** AWS-developed Firecracker (Apache 2.0). The
    industry standard for ephemeral compute (AWS Lambda,
    Fly.io's machines, others).
  - **Start-up:** ~125 ms cold.
  - **Overhead:** ~5 MB per microVM.
  - **Isolation:** full hardware-virtualized boundary; KVM-backed.
  - **When:** production runs of any Cell-authored or third-party
    Spinner; the default when isolation requirements are
    unknown.

### 3.3 Full Linux VM backend

  - **Tooling:** Lima on macOS; KVM directly on Hetzner.
  - **Start-up:** ~3–10 s cold.
  - **Overhead:** ~512 MB per VM.
  - **Isolation:** strongest; full OS boundary.
  - **When:** privileged Spinners (kernel-touching work, network-
    namespace manipulation); reproducible legacy-stack
    executions; security-sensitive operations.

### 3.4 Backend selection

A Spinner's manifest declares an isolation class:

```json
{
  "isolation": "container" | "microvm" | "vm" | "any"
}
```

  - `container` — minimum acceptable backend is container;
    microvm or vm are also acceptable.
  - `microvm` — minimum is microvm; vm acceptable.
  - `vm` — full VM required.
  - `any` — runner host picks per host policy.

The runner host's policy can upgrade the class (e.g., a host that
only runs microvms ignores the `container` minimum and runs
microvm anyway). It cannot downgrade.

---

## 4. Host placement

The runner pool **does not run on the Loom host.** Kepler hosts
the Loom + Weaver + Grimoire and has no spare capacity for a
runner pool.

  - **Spindle (M5 Max)** — the bootstrap-epoch runner pool.
    Reaches the Loom over LAN at home, over Tailscale when away.
    MLX-capable, so Quiet Loom evaluations against expected
    outputs are first-class on Spindle. Container + Lima-VM
    backends supported; Firecracker is Linux-only and not
    available on macOS directly.
  - **Hetzner Linux host(s)** — the production runner pool when
    peer Wizards arrive. Dedicated Firecracker-capable Linux
    boxes. KVM enabled. The canonical production runner host
    after the federation epoch begins.

The choice between Spindle and Hetzner per execution is the
runner client's responsibility — Spindle for development, MLX-
dependent runs, and Loom-local-test cycles; Hetzner for
federation-bound runs and trusted-third-party Spinner executions.

**Network model.**

  - The Loom dispatches over **HTTPS + mTLS** to the runner host's
    runner service.
  - The runner instance has **no inbound network access** during
    execution.
  - The runner instance has **outbound network access only to
    declared endpoints**: the Loom for audit emission, the BYOK
    gateway for model calls, and Spinner-declared Spool endpoints
    (resolved by the runner host, not the Spinner).
  - All other network access — DNS leaks, telemetry, unrelated
    HTTP — is refused at the runner-host firewall.

---

## 5. The runner image

A canonical Foundation runner image:

  - **Base:** Debian slim (production) or Alpine (size-sensitive).
  - **Runtime:** Node 22 LTS + pnpm; Python 3.12 + uv; MLX runtime
    (Spindle/macOS only).
  - **Webspinner libs:** the Weaver test harness, `ajv`,
    `@noble/curves`, `@noble/hashes`, `jsonpointer`,
    `json-logic-js`. The same versions the Loom uses, so
    in-runner behavior matches in-Loom behavior.
  - **Disk:** tmpfs-only for working files; no persistent
    volumes; root filesystem read-only.
  - **User:** non-root, no setuid binaries.
  - **Signed:** Foundation release key signs the canonical image;
    Cell identity key counter-signs the image the Cell uses.
  - **Documented:** every runner image ships with a
    `runner-image.md` describing what's installed, what versions,
    and the digest of the build manifest.

Image evolution is by **explicit roll** — a meta-runtime operation
`roll-runner-image` that pulls a newer image at a verified
digest, validates the Foundation signature, counter-signs with the
Cell identity key, and pins the local Cell to the new image. The
old image stays available for `--re-run-at-image=<digest>` audit
replay.

---

## 6. The runner contract — a typed meta-runtime operation

Runner invocation is itself a **typed meta-runtime operation**
(per `ARTIFACTS-AND-STORAGE.md` §3.2). The contract:

```ts
type RunnerOperationInput = {
  spinnerBundle: SpinnerBundleRef;        // path or digest
  imageDigest: string;                    // runner image to use
  capability?: string;                    // specific capability to invoke
  capabilityInput?: unknown;              // bound to the capability's inputSchema
  testPlan?: TestPlanRef;                 // when running tests instead of invoking
  secretRefs: VaultRef[];                 // by reference; values resolved at run time
  spoolRefs: SpoolRef[];                  // same
  modelRefs?: ModelRef[];                 // BYOK gateway routes
  executionBudget: {
    cpuMs: number;                        // hard cap
    wallMs: number;                       // wall-clock cap
    memMB: number;                        // memory cap
    networkBytes: number;                 // outbound byte cap
  };
  isolation: "container" | "microvm" | "vm" | "any";
  emitAuditTo: AuditChannelRef;
};

type RunnerOperationOutput = {
  status: "completed" | "failed" | "cancelled" | "budget-exceeded";
  durationMs: number;
  cpuMsUsed: number;
  memMBPeak: number;
  capabilityOutput?: unknown;             // bound to the capability's outputSchema
  testResults?: TestResultSummary;
  error?: { kind: string; message: string; stack?: string };
  auditEvents: AuditEvent[];              // emitted during execution
  emittedArtifacts: ArtifactRef[];        // files the Spinner produced
};
```

Resumability: a runner operation is **not resumable mid-execution**
(the runner instance is destroyed on host failure), but it is
**retryable** — the calling meta-runtime operation can re-issue
the same input and get a fresh execution. Resumability lives one
layer up, in the calling operation's state machine.

Cancellability: the Loom can issue `cancel(operationId)`; the
runner service signals the instance (`SIGTERM` → grace period →
`SIGKILL`); the instance is destroyed; the output reports
`cancelled`.

---

## 7. When the Loom uses a runner

The default disposition:

  - **First execution of a newly-authored Spinner — always.**
    Before the Cell signs the Spinner, the Spinner runs in a
    runner. Pablo + Bootstrap reviews of the Spinner's output
    happen against runner results.
  - **Any execution of a Spinner whose digest isn't locally
    countersigned — always.** Foundation-recognized Spinners
    installed for the first time go through a runner pass before
    they enter the routine-invocation path.
  - **Routine invocations of trusted, Cell-signed Spinners —
    optional.** The Loom may in-process dispatch for speed. The
    Spinner's `isolation` manifest declaration governs:
    - `required` — always run in a runner.
    - `recommended` — runner by default; in-process allowed when
      the Loom is under load.
    - `optional` — in-process by default; runner on demand.
  - **Test-plan execution — always.** Tests run in runners by
    construction (clean state per test).

---

## 8. The runner-host service

The runner pool host runs a small service — the **runner service**
— that the Loom dispatches to. The service:

  - Listens over HTTPS + mTLS on a Loom-declared port.
  - Authenticates the caller via mTLS certificate (the Loom's
    Cell identity key signs the cert chain).
  - Accepts a `RunnerOperationInput`; instantiates the requested
    backend with the requested image; mounts the Spinner bundle
    read-only; resolves secret/spool refs through declared
    channels; launches; collects output; reports back.
  - Maintains its own audit chain of runs hosted (the runner
    host's perspective on the audit story); the Loom's chain has
    the Cell's perspective; the two are stitched by operation ID.
  - Has no persistent state beyond logs and the audit chain. A
    runner host can be rebuilt from its base image + the runner
    image registry without losing operational capacity.

The runner service itself is a Spinner (eventually — built as a
Genesis Spinner in `~/warp/spinners/runner/` when the Loom is
ready to dispatch). Until then, it is a TypeScript service in
`~/warp/runner-host/` deployed via launchd (or systemd on Linux
hosts) to Spindle and Hetzner.

---

## 9. Deliberate choices, named

| Choice | Rationale | Revisit when |
|---|---|---|
| Immutable images, ephemeral instances | The industry-standard pattern for ephemeral compute (AWS Lambda, Fly.io, Cloudflare Workers); makes reproducibility, isolation, and audit clean | Never — this is foundational |
| Firecracker as the production microVM backend | Apache 2.0; AWS-built; the precedent the entire ephemeral-compute industry adopted; battle-tested at scale | A measurably better open-source microVM platform emerges, or post-quantum-isolation requirements arrive |
| Runner pool not on Kepler | Kepler is the Loom host; runner pool would starve the Loom and break the "Cell-restart recovers" property | Kepler upgrades or the Loom moves to a higher-spec host |
| Spindle is bootstrap-epoch runner pool | M5 Max has the headroom and the MLX runtime for Quiet Loom evals; LAN/Tailscale-reachable | Federation epoch begins or Spindle is repurposed |
| Hetzner is production runner pool | Linux-native Firecracker; predictable cost; runner pool needs no GPU during bootstrap | GPU-class runners needed for vision/audio Spinners; post-WWDC reassessment |
| No inbound network on runner instances | Reduces attack surface to outbound-only; the runner is the *callee*, not a *server* | Never — this is structural |
| Outbound network confined to declared endpoints | Prevents Spinner exfiltration; honors Spool/vault sensitivity classifications | A trusted Spinner needs broader outbound access — declared in manifest, gated by the Cell's policy |
| Runner image signed by Foundation release key + counter-signed by Cell identity | Two-party trust: Foundation publishes the image; Cell endorses for its use | Multi-party signing becomes load-bearing (e.g., third-party recognition) |
| Backend choice per `isolation` manifest declaration | Spinner authors know their isolation needs; host policy can upgrade but not downgrade | An empirical study shows manifests routinely under-declare; promote to host-policy-driven |

---

## 10. The Wizard never sees this

A Wizard's interaction with a runner is **nothing**. The runner
is the Loom's apparatus, not the Wizard's. The Wizard speaks a
sentence; a polished artifact appears. The fact that thirteen
microVMs spun up, executed, and disappeared in the process is
invisible — by design.

When a run fails, the Loom shows the Wizard a plain-language
explanation ("the Spinner could not complete this step — here's
what we saw"), not a stack trace or a microVM exit code. The
audit chain and the runner host logs retain the technical detail
for operator investigation.

---

*Updated 2026-05-12. The runner architecture here is the deliberate
choice of the Foundation as of this date. The bootstrap-epoch
runner pool runs on Spindle; the production pool moves to Hetzner
when federation begins. Implementation is tracked in
`IMPLEMENTATION-PLAN.md`.*
