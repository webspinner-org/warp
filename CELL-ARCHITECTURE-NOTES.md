# CELL-ARCHITECTURE-NOTES.md — three interlocking decisions for the portable Cell

The Wizard raised three concerns on 2026-05-17 that bear on whether the WARP architecture works at all when it has to leave Kepler:

1. **Data layer.** Is SQL/RDBMS (today: PocketBase + SQLite) the right shape, or do we want something less rigid?
2. **LLM.** Which model serves the Spinner — and how do we maximise RAG so the SI's output is grounded, generous, and on-domain?
3. **Cell packaging.** How does a Cell move? A Webspinner Foundation Cell on Kepler is one thing; a patron's own Cell on their MacBook, their Hetzner box, their NUC — that's the actual democratisation target.

These three are not independent. The data-layer choice constrains packaging (embedded engine vs. separate server). The LLM choice constrains host hardware (M2 today, but everyone's hardware tomorrow). The RAG strategy constrains where the corpus lives (in the Cell vs. on a Foundation server). Decide them as a system.

When this doc conflicts with `WARP-CANON.md` or `STANDARDS.md`, the canon wins. This doc is operative _direction_ for upcoming decisions; the canon is _law_. The Wizard signals which directions go into law next.

---

## 1) The data layer — is rigid SQL the right shape?

### What the canon already says

`STANDARDS.md` declares: _"PocketBase (bootstrap); Postgres + Qdrant (scale)."_ Per the same doc: _"Structured + unstructured persistence. The Grimoire holds both. The choice between them is per-Spinner, declared in the manifest."_ — so the canon already admits non-relational storage as first-class for some Spinner needs (vector embeddings, semantic search, document collections).

### Where the rigidity bites today

The Database Application Spinner creates one PB collection per schema entity. PB schemas are typed (text / number / date / bool / relation). Once `build` runs, the schema is committed to a SQLite table via PocketBase's API.

Real friction points the Wizard's concern is pointing at:

- **Post-build schema evolution.** If the patron uses the app for a week and realises they want a "Notes" field on Transactions, that's a column add. PB supports this via API (no manual SQL migration), but the renderer + the wp_database_applications metadata row also have to learn the new column, and we have no UX for it yet.
- **Domains with genuinely variable shape.** Recipe collections (ingredient lists vary). Personal journals (entries with photo attachments and arbitrary tags). Knowledge bases (notes with backlinks). The "every entry has the same five fields" model fits bookkeeping; it strains recipes.
- **Graph-shaped domains.** Family trees, social networks, knowledge graphs. SQL can model graphs (adjacency lists, recursive CTEs) but the impedance mismatch is real.
- **Time-series / sensor data.** Doesn't fit transactional row models gracefully.

### The alternatives and what they cost

| Engine                                    | Schema posture                                                       | Embedded?                   | Strengths                                                              | Costs                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **PocketBase / SQLite** (current)         | Schema-first, typed                                                  | Yes (single file)           | Mature, fast, simple to back up, single-binary packaging               | Rigid; graph and document use-cases awkward                                             |
| **SurrealDB**                             | Multi-model: schemafull or schemaless, doc + graph + KV + relational | Yes (embeddable)            | Genuinely flexible; relationships first-class; native graph traversal  | Less mature operationally; smaller community; production maturity claims still settling |
| **DuckDB**                                | SQL with rich types (lists, structs)                                 | Yes (single file)           | Analytical queries (reports!) blazing-fast; columnar; first-class JSON | Read-heavy bias; not designed as primary OLTP store                                     |
| **LanceDB**                               | Vector-first + tabular                                               | Yes (file-based)            | Pure vector workflows; multimodal                                      | Not a general-purpose primary store                                                     |
| **CouchDB / PouchDB**                     | Document, schema-flexible                                            | PouchDB yes; CouchDB server | Sync semantics, conflict resolution, offline-first                     | Cluster operations heavy; SQL queries awkward                                           |
| **Postgres + Qdrant** (canon's scale-out) | SQL + vectors, separate engines                                      | No — separate servers       | Maturity, scale                                                        | Defeats single-binary portability                                                       |
| **EdgeDB**                                | Schema-first, typed, graph-ish                                       | Embedded mode available     | Strong types, migrations as code, graph-style queries                  | Niche; ecosystem thin                                                                   |

### What I recommend

**Stay with PocketBase / SQLite for the bootstrap and probably beyond.** Three reasons:

1. **Embedded is non-negotiable for portability** (see §3 below). Anything requiring a separate server cripples the "patron installs a Cell on their MacBook" story. PB is one binary + one data directory. So is SQLite. So is DuckDB. So is SurrealDB embedded. Anything else — Postgres, MongoDB, CouchDB — adds an operational layer the Webspinner cannot reasonably manage.

2. **The rigidity is mostly a feature.** Once the schema is settled through `propose → refine`, the patron _designed_ it. Rigidity at this point is what makes the app trustworthy ("my Donor's email field exists and is an email"). The rigidity that needs to flex is _pre-build_ (which the SI handles) and _post-build evolution_ (which becomes a Schema Refiner Spinner — see below).

3. **Where PocketBase falls short, JSON columns + DuckDB satellites can absorb it.**
   - **For variable-shape records** (recipes, notes, anything LLM-driven): add a designated `details` JSON column per entity. The renderer can render it as a key/value editor or surface as a free-form expandable section. Schema-flexible without changing the engine.
   - **For analytical reports** (P&L, year-end summaries, custom aggregations): add DuckDB as a satellite. It attaches read-only to the PB SQLite file via `ATTACH DATABASE`. Reports run as DuckDB queries against the patron's collections without disturbing the OLTP path. Same data directory; one extra binary or library.
   - **For genuinely graph-shaped Spinners** (a future "family-tree Spinner" or "knowledge-graph Spinner"): that Spinner declares a graph backend at install — SurrealDB embedded, or an in-PB-table adjacency-list layer. Per-Spinner choice, per canon.

4. **A "Schema Refiner" Spinner closes the post-build evolution gap.** When the patron wants to add a Notes field a week later, they invoke the Schema Refiner: it walks the existing schema + their request, generates the migration (PB API call: add field; renderer learns the new field automatically), and writes the change. The SI handles the migration; the patron never sees SQL. Lands as part of the `wp_database_applications` flow.

### What stays open

- **When does the canon's promised migration to Postgres + Qdrant actually trigger?** The canon says "scale." Concretely: when the demo Cell hosts more than ~50 simultaneous patrons, when the Foundation corpus crosses a size that needs proper vector indexing, when WRAG's reranker needs production-grade vector retrieval. Decide a measurable trigger; commit the migration plan to `DECISIONS.md`.
- **Do we add DuckDB as a satellite for reports in v1, or wait?** Reports are deferred (R8.6+). When they land, DuckDB-attached-read-only is probably the right path — but worth re-evaluating against PocketBase's growing JSON query support and SQLite's window functions.

---

## 2) The LLM — choice, scaling across hosts, and RAG maximisation

### Where we are today

- **Generation**: Qwen2.5-14B-Instruct, 4-bit quantised, MLX runtime on Apple Silicon. Kepler's hardware. ~10-30 tokens/sec depending on prompt size. ~5-15 GB resident.
- **Embeddings**: sentence-transformers MiniLM-L6-v2, 384-dim, on Kepler.
- **Reranker**: BGE-reranker-v2 in `STANDARDS.md` as the scale-out plan; not deployed.
- **WRAG pipeline**: stages 1 (query understanding) + 2 (retrieval, dense top-k) shipped. Stages 3 (rerank), 4 (context assembly), 6 (grounding verification) deferred.

### The LLM question — which model

The honest answer: **the model isn't the bottleneck right now; the architecture around it is**, per `SI-QUALITY-DESIGN.md`. That said, the model does matter for the Spinner-on-arbitrary-Cell story.

**For Apple Silicon hosts (the bootstrap path):**

| Host RAM | Recommended generation model                             | Why                                            |
| -------- | -------------------------------------------------------- | ---------------------------------------------- |
| 16 GB    | Qwen2.5-7B-Instruct-4bit                                 | Sub-5 GB resident; ~15-40 tok/s on M3+         |
| 24 GB    | Qwen2.5-14B-Instruct-4bit (current)                      | Sweet spot — reasoning quality + tractable RAM |
| 36+ GB   | Qwen2.5-32B-Instruct-4bit or Llama-3.3-70B-Instruct-4bit | Best reasoning; the Wizard's M5 Max is here    |

The Cell should **detect host RAM at startup and pick the appropriate model**. Same Spinner code, same canon, different model size. Per `STANDARDS.md`: _"vLLM for local model serving when GPU hardware lands (post-WWDC reassessment)"_ — MLX is the Apple-Silicon equivalent today; vLLM + CUDA when patron Cells live on Linux + NVIDIA hosts.

**For Linux / NVIDIA hosts:**

- llama.cpp with GPU acceleration; or vLLM if the host is more capable
- Same model families (Qwen, Llama, Gemma)
- The Cell ships the runtime; the model weights download on first run from a Foundation mirror or HuggingFace

**For Windows hosts:**

- WSL2 + the Linux path is the practical answer for v1
- Native Windows LLM inference (DirectML, ONNX Runtime + DirectX) is workable but more Foundation-side engineering

**Closed/API models (BYOK)** stay off the patron path per `DECISIONS.md` 2026-05-16 (Demo Cell pattern) + `POLICY-PATRON-PATH-LLM.md` R1. They remain available for _authoring_ (Claude Code writing Spinner definitions) until the meta-Spinner that authors Spinners lands; from that point even authoring is sovereign.

**Model evolution.** Open-weight model quality has improved roughly 4× per generation over 18 months (Qwen 1.5 → 2.5; Llama 2 → 3.3 → 4). The Foundation should not over-commit to a specific model — the runtime + manifest should make swapping the underlying weights a config change. Per-Spinner manifest declares `model: "kepler/qwen-2.5-14b-instruct"`; resolving that to a specific runtime + weights happens at Cell-init.

### RAG maximisation — where the leverage actually is

The Spinner reads _one_ Wikipedia article today and truncates at 8 KB. That's a tiny fraction of available domain knowledge, used unintelligently.

The seven moves, ranked by leverage per unit work:

1. **Build the Foundation library of canonical schemas per domain.** The single highest-leverage RAG move. The Foundation curates: _"here is the canonical small-business bookkeeping schema, with annotations on which fields the IRS expects, which features QuickBooks ships, which reports Xero defaults to."_ Same for gardening, donor management, customer service, gradebooks, inventory. Each is a markdown file in a Spool. When the Spinner sees _"bookkeeping,"_ it retrieves the canonical schemas plus the Wikipedia article + any newer industry references. The SI now has _real_ domain knowledge to draw on, not a single encyclopedia summary. Cost: ongoing curation work. Leverage: every Spinner gets smarter immediately.

2. **Embedding-driven chunk selection.** Instead of `slice(0, 8000)` on the Wikipedia article, chunk it (every paragraph or every 500 tokens), embed each chunk + the patron's sentence, pick top-K most relevant. Same total context budget; much better signal-to-noise. Cost: ~1-2 s extra latency. Leverage: dramatically more relevant context per token.

3. **BGE-reranker after embedding retrieval.** Cross-encoder rerank of the top-K from cosine similarity. The canon's stage 3 of WRAG. Lifts the _most_ relevant chunks to the top; bottom-of-window chunks fall off. Cost: load the model + ~500 ms per rerank. Leverage: another 1.5-2× quality improvement on retrieval.

4. **Hybrid retrieval (BM25 + dense).** Lexical keyword retrieval catches what dense embedding misses (specific terms, names, exact phrases). Combined with dense vectors via reciprocal-rank-fusion. Cost: SQLite FTS5 is already available; add an index. Leverage: catches the "donor's tax ID number" type of specific query.

5. **Grounding verification before delivery.** The canon's WRAG stage 6. After the SI generates the schema, a critic pass verifies each claim is supported by the retrieved context. Ungrounded claims re-prompted or flagged. Cost: one extra LLM call. Leverage: the SI stops hallucinating fields that aren't in any reference — and the patron sees citations.

6. **Multi-source retrieval.** Beyond Wikipedia: industry-standard schemas (Xero's chart of accounts; OpenStreetMap's POI tags; Schema.org's Person / Organization vocabularies). Each becomes a Spool entry. The outboundAllowlist grows — explicitly, per Foundation curation. Cost: curation + allowlist maintenance. Leverage: domains where Wikipedia is thin (specialised fields) get rich.

7. **Per-patron memory.** A Cell-local Silk Pattern of the patron's prior Spinner sessions, embedded. _"Last time you built a customer log, you chose to track service-date as date-only. Should I use the same here?"_ Cost: per-Cell embedding storage (modest). Leverage: the SI feels like it knows the patron.

### What I recommend

Order of work, highest leverage first:

1. Foundation library of canonical schemas (start with bookkeeping + gardening + donor + customer-service; one markdown per domain).
2. Embedding-driven chunk selection (cheap; immediate quality lift).
3. BGE-reranker (canon's planned move; deploy now that there's an output-quality gap to close).
4. Grounding verification step.
5. Hybrid retrieval (BM25 + dense).
6. Multi-source retrieval beyond Wikipedia.
7. Per-patron memory in the Silk Pattern.

### What stays open

- **Model auto-selection.** Concrete rules for "what model does this Cell run." Probably a JSON config the Cell-init writes based on detected RAM + GPU. Per-Spinner manifests stay portable across model swaps.
- **Embedding model upgrade.** MiniLM-L6-v2 at 384 dims is small but capable. BGE-M3 at 1024 dims (canon's scale-out plan) is meaningfully better. When does the upgrade trigger?
- **Foundation library distribution.** Lives in the Foundation's repo? Ships with each Cell? Pulled on Cell-init?

---

## 3) Cell packaging — what makes a Cell portable

### The promise the architecture has to keep

A non-technical Webspinner — a baker, a teacher, a small-business owner, a church administrator — must be able to install a Cell on their own hardware in roughly the time it takes to install Zoom. Not minutes of Terminal work. Not a Docker tutorial. **One installer; one click; their Cell.**

The Cell carries:

- Loom (SvelteKit + Node)
- Weaver (Python+FastAPI canonical; in-Loom shim today)
- Grimoire (PocketBase; data directory)
- LLM runtime + selected weights
- Embeddings sidecar + model weights
- Spinner bundles (Genesis ships with the Cell; Cell-authored land via update channel)
- The patron's data
- The patron's identity key

The Cell must move:

- From one host to another (laptop dies; new laptop)
- Across platforms (Mac to Linux to Windows-via-WSL)
- Back to a fresh install + restore from backup
- Eventually: as part of an estate (a patron's data outlives them; spouse or trustee should be able to take possession)

### The packaging options, honestly

| Option                                                       | Strengths                                                                                                                                                                                                                          | Costs                                                                                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Docker / container**                                       | Single image, portable across Linux + Mac (Docker Desktop). Mature ecosystem.                                                                                                                                                      | Docker Desktop is heavy for a non-technical user. GPU passthrough is fragile on Mac, manageable on Linux. Apple Silicon MLX inside a container is slow / not supported well. |
| **Native binaries per platform + filesystem layout**         | Lightest. Native LLM inference via Metal / CUDA / DirectML.                                                                                                                                                                        | Three platform builds to maintain. Updates per-platform.                                                                                                                     |
| **`Cell.app` (Tauri-style native shell + bundled services)** | One-click install per platform. Native LLM. Sparkle / Squirrel-style update channel. Patron experience matches consumer-grade software.                                                                                            | Most engineering work. Sign + notarise per platform. The Foundation has to keep three platform builds in sync.                                                               |
| **Per-tenant cloud hosting (Managed Cell)**                  | Zero install for the patron. Per canon §3 — _"Managed Cell — user owns identity, data, and policies; third party operates the hardware. Host has the data (encrypted at rest); user has the keys. The host cannot read the data."_ | Defeats the "sovereign on my own hardware" story for self-hosted patrons. Useful as one option; can't be the only option.                                                    |
| **WASM components + native shell**                           | Spinners run in WASM; perfectly portable.                                                                                                                                                                                          | LLM inference isn't WASM-friendly. The shell still has to be native. Saves work on Spinner portability, not on Cell portability.                                             |

### The data-shape consequence

This is where Question 1 binds to Question 3. If the data layer needs a separate database server (Postgres, MongoDB, CouchDB cluster, anything that isn't an embedded engine), the Cell.app pattern becomes very hard. The patron's installer has to bring up + manage a server-class component. **Embedded engines win.** PocketBase + SQLite, DuckDB, SurrealDB embedded, LanceDB — all fit. Postgres, MongoDB, CouchDB — all don't.

The Foundation's commitment to embedded engines is what makes the Cell portable. **Decide this first; the data-layer question (Q1) has only one answer once portability is operative law.**

### The LLM-shape consequence

The LLM runtime is per-platform: MLX on Apple Silicon, llama.cpp on everything, CUDA / Metal / DirectML for acceleration. Model _weights_ are platform-independent (GGUF / SafeTensors files). The runtime is what the installer ships; the weights download on first run (or ship as part of the installer for offline-capable installs).

**The Cell.app design needs:**

- Per-platform installer (.dmg, .deb, .rpm, .msi)
- Auto-detect host capability (RAM, GPU, OS) at first run
- Pick the right model from a Foundation-published menu, download to `~/Library/Application Support/.../models/`
- Per-platform launchd / systemd / Task Scheduler service registration

### Cell DATA portability

Single directory. Everything in `~/Library/Application Support/Webspinner Foundation/<CellName>/`:

- `pb_data/` (PocketBase / SQLite)
- `vault/` (encrypted secrets, master key file)
- `cell-identity/` (the keypair)
- `spinners/` (installed bundles)
- `models/` (LLM weights — optional; can be re-downloaded)

Backup is `tar.zst` over the directory (excluding `models/` to keep it small).
Restore is _unpack + start the Cell_. The Cell identity key gives the new host the same Cell name.
Cross-platform move is the same data directory + the _target platform's_ Cell.app.

### Identity portability

The Cell's ed25519 identity key (`4d243e2e40d9986b` for the operator; `d9abadc887096bd7` for the demo) is what makes the Cell _the same Cell_ across moves. Per the canon (§17.2 — _No Secrets via Claude Code_): the key lives in the vault, encrypted under the operator's master key. Migration requires the operator's master key to decrypt the vault on the new host. The Foundation never has the master key.

For estate continuity: the operator can export a wrapped copy of the master key (e.g., as a sealed envelope, written down, in a safe deposit box). On their death the executor gets the key, restores the Cell on new hardware, becomes the new operator.

### What I recommend

**Commit to embedded engines for everything in the Cell.** This is the architectural lock-in that makes portability possible. Concretely: PocketBase + SQLite for OLTP; DuckDB satellite for analytics when reports land; SurrealDB embedded if a future Spinner needs graph; LanceDB or sqlite-vec for vectors. No Postgres / MongoDB / Couchstrip in the Cell. The canon's scale-out plan to Postgres + Qdrant applies only to _managed-host_ deployments where the Foundation operates the hardware — not to self-hosted patron Cells.

**Commit to Cell.app per platform as the v1 packaging target.** Tauri (Rust shell) + the existing Node + Python services + native LLM runtime. macOS first; Linux AppImage second; Windows via WSL2 first cut, native Win32 second cut. Tauri's update mechanism handles the rest.

**Commit to host-adaptive model selection.** The Cell-init script detects RAM + GPU, picks the appropriate generation model from a Foundation-curated menu, downloads on first run, registers the model identifier with the Loom's manifest resolver. Per-Spinner manifests are model-family-portable.

**Commit to the Foundation library as the highest-leverage SI quality move.** Build it as a Cloudflare-Pages-hosted static corpus, signed + versioned. Cells pull it on first run + on update. Each Spinner reads from its declared Spool subset. This is where domain knowledge lives.

### What stays open

- **Tauri vs. Electron vs. native per-platform builds.** Tauri is lighter + Rust-based; Electron is mature but heavy; native per-platform is best UX but biggest engineering load.
- **Update channel mechanics.** Sparkle (Mac), Squirrel (Windows), AppImageUpdate (Linux), Tauri's built-in updater. Probably Tauri unless we go fully native.
- **Cold-start vs. warm-start cost.** First-run model download is gigabytes — patron experience needs to handle this gracefully (background download with chat-side narration; "your Cell is moving in, here's what's happening").
- **Operator key recovery.** Secure handoff to executor / spouse / trustee. Out-of-band — paper + safe deposit box is honest.

---

## How these decisions bind together

The simplest summary:

- **Portability requires embedded data engines** ⇒ stay with PB/SQLite + DuckDB satellite + optional embedded SurrealDB; **not** Postgres / Mongo / Couchstrip in the Cell.
- **Portability requires native LLM runtime per platform** ⇒ ship MLX (Mac) + llama.cpp (everything) + appropriate GPU backends; runtime per platform; weights download per host.
- **Quality requires Foundation-library RAG** ⇒ a static, signed, versioned corpus the Cell pulls; not pay-per-call API; not unbounded outboundAllowlist.
- **Sovereignty requires sovereign LLMs on the patron path** ⇒ Anthropic / OpenAI never reach a patron prompt; canonically locked in `POLICY-PATRON-PATH-LLM.md` R1 and `DECISIONS.md` 2026-05-16.

The Cell.app on the patron's hardware, with their data in their directory, their identity key in their vault, their installed Spinners reading from a Foundation corpus they trust, running a model sized to their host, calling sovereign inference on their own silicon — that is what makes WARP work. None of the alternatives I considered above (Docker, managed-only, cloud-dependent, separate-server data layer) get there.

---

## What to do next (when the Wizard signals to proceed)

These are architectural decisions for `DECISIONS.md`, in order of urgency:

1. **Data-layer commitment.** "Embedded engines only in the Cell. PocketBase + SQLite for OLTP; DuckDB satellite for analytics; SurrealDB embedded as the per-Spinner option when graph semantics are needed; LanceDB or sqlite-vec for vectors. Postgres + Qdrant applies only to Foundation-managed deployments."
2. **Cell packaging commitment.** "Cell.app per platform (Mac / Linux / Windows-via-WSL initially), Tauri-based; native LLM runtime; host-adaptive model selection; data + identity portable as a single directory."
3. **Foundation library commitment.** "Static, signed, versioned corpus published from the Foundation's repo. Cells pull on first run + on update. Each Spinner reads its declared Spool subset. Domain coverage: bookkeeping / gardening / donor-management / customer-service / gradebook / inventory in the first wave."
4. **Model-selection commitment.** "Per-Spinner manifest declares model family (`kepler/qwen-2.5-14b-instruct`); the Cell-init resolver picks the actual weights based on host capability. Closed/API models prohibited on patron path per existing policy."

Each gets a `DECISIONS.md` entry the day the Wizard signals "go."

---

## A note on what the Wizard already settled

Per `DECISIONS.md` 2026-05-16 (the Demo Cell pattern) + `POLICY-PATRON-PATH-LLM.md` R1, these things are already operative:

- Patron-path generation + embeddings are sovereign (local LLMs only).
- Spinners do not use BYOK at runtime.
- Anthropic / OpenAI are bootstrap-only for authoring; once the meta-Spinner ships, authoring goes sovereign too.

So the LLM question (Q2) is already half-answered: _the patron path is local LLMs forever_. The only LLM-choice questions remaining are _which local LLM at which host size_ and _how to maximise RAG quality without leaning on closed models_.

---

_Authored 2026-05-17. Persisted at the Wizard's request before any code touches these decisions. The Wizard signals which sections become operative law._
