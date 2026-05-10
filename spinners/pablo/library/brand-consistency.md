# Brand consistency

## The rule

The Foundation has a vocabulary. It is operative law on every
patron-facing surface and on every admin surface a Wizard will
quote to a peer or to a future contributor. (Internal scratch
files — never patron-visible, never quoted — may use whatever
shorthand the Wizard wants.)

## The Webspinner vocabulary

These terms come from `WARP-CANON.md` §2 and §19. They are not
options; the canon settles them.

| Use | Never |
|---|---|
| **Synthetic Intelligence** / **SI** | "AI" in load-bearing patron copy (quotation of third-party material is allowed verbatim) |
| **Cell** | "tenant", "instance", "server", "account", "workspace" |
| **Spinner** | "agent", "bot", "assistant", "skill", "plugin" |
| **Spool** | "data source", "knowledge base", "context" (when meaning a registered source) |
| **Skein** | "catalog", "library" (when meaning the Spinner catalogue) |
| **Silk Pattern** | "memory", "history" (when meaning a Spinner's invocation record) |
| **Warp Thread** | "workflow", "pipeline", "chain" (when meaning a composition of capabilities) |
| **Weaver** | "router", "orchestrator", "gateway" (when meaning the canonical service) |
| **Loom** | "admin panel", "dashboard", "UI" (when meaning the operator surface) |
| **Grimoire** | "database", "vector store" (when meaning the Cell's persistent state) |
| **Wizard** | "user", "admin", "operator" (when meaning the human who runs a Cell) |
| **Patron** | "end user", "customer", "client" (when meaning the person the Wizard serves) |

The substitutions are not stylistic preferences. Each term carries
specific meaning the generic word loses — "Cell" names a privacy
and capability boundary the canon defines; "tenant" names a billing
relationship the canon explicitly rejects.

## Em-dashes

Em-dashes — like these — are **moral markers**, per the *AI
Enclosure* manuscript's Author's Note. They mark the pauses the
Foundation's writing relies on. They survive every edit. Never
substitute hyphens (-), en-dashes (–), or omit them in favor of
commas when an em-dash was written.

## Internal hostnames

Patron-facing copy **never** names internal infrastructure. "Kepler",
"Spindle", "Hetzner", "the Mac Studio", IP addresses, port numbers,
launchd labels — none of these appear on a surface a patron will
read. Substitute with the architectural noun: "the Cell", "the
Loom", "the Weaver", "the Grimoire".

Admin surfaces (the Wizard's chrome) may use the internal names
because the Wizard owns them. The boundary is patron-visibility.

## Voice

  - **Manuscript voice** — present tense, em-dashes, second person
    direct ("the Wizard does X"). The canon and the *AI Enclosure*
    manuscript. Pablo's voice line.
  - **Spec voice** — declarative, precise, present tense. Mission
    Locks, capability descriptions, finding `finding` and `fix`
    fields. No theatre.
  - **Patron voice** — short sentences, plain words. No jargon, no
    architecture-internal vocabulary, no model names. "The Cell is
    answering" not "Qwen 2.5 14B is generating".

## How Pablo checks it

1. **Vocabulary scan.** For every visible string in the rendered
   HTML, run substring matches for each "never" term. Each hit is
   a brand finding at severity **high** (violation breaks trust)
   on patron-facing surfaces, **medium** on admin surfaces.
2. **Em-dash preservation.** Compare em-dashes (`—`, U+2014) in
   the manuscript-rendered prose against the source. If an em-dash
   has been substituted with `-` or `–` or removed in favor of `,`,
   flag at severity **high**.
3. **Hostname scan.** Run substring match for `Kepler`, `Spindle`,
   `Hetzner`, `johns-mac-studio`, `127.0.0.1`, `:11445`, `:11446`,
   `:8090` on any surface that is *not* `/admin/*`. Each hit is
   severity **high**.
4. **Model-name scan.** Substring match for `Qwen`, `Anthropic`,
   `Claude`, `GPT`, `Mistral`, `Llama`, `mlx-community` on patron
   surfaces — severity **high**. Admin surfaces (where the Wizard
   selects models) are exempt.

## Common failures

  - "AI" in the lede of a patron page.
  - "Forged on Kepler" in a patron footer — replace with "Forged
    on the Cell".
  - "Powered by Qwen 2.5 14B" anywhere a patron reads.
  - An em-dash replaced by a hyphen because someone's editor
    auto-corrected — *especially* in manuscript prose.
  - "Your AI assistant" — both wrong words in a single phrase.

## Sources

- `~/warp/WARP-CANON.md` §2 (vocabulary), §14 (voice), §19
  (Spinners / Spools / Silk Patterns / Skein / Warp Threads).
- `~/ai-enclosure/chapters/00-authors-note.md` — the case for
  em-dashes.
