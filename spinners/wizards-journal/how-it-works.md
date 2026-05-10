# How the Wizard's Journal works

The Wizard's Journal is the Cell's operational diary. Three
capabilities; one PocketBase collection; semantic recall via the
Cell's embedding sidecar.

## record

The Wizard writes an entry — an **action** taken, a **decision**
made, a **problem** encountered, a **learning**, or a plain
**note**. The Journal stores the entry in `wp_journal_entries`
with the Wizard's session identity, the current timestamp, and a
384-dimension embedding of `title + body` computed by the Cell's
MiniLM-L6-v2 sidecar.

Optional fields: `tags` (free-form), `relatedSpinners` (links to
the Spinners the entry touches), `public` (defaults to `false`;
flags the entry as eligible for community-facing docs export when
that capability ships).

Entries are not editable through the Journal — to correct a
recorded entry, write a new one of `kind: learning` that names
the prior entry. The journal is a log, not a wiki.

## recall

Semantic search across the journal. The Wizard's query is
embedded the same way an entry is, and cosine similarity ranks
the matches. Optional filters: `since` (ISO timestamp), `kind`
(action / decision / problem / learning / note), `tag`. Default
limit is 10; max 50.

Returns the matching entries with their similarity scores. The
Wizard decides what's relevant from the candidates — recall does
not editorialise.

## bootstrap

Produces the markdown a fresh Claude (or fresh Wizard) session
needs to pick up where the last one left off. The default
horizon is 14 days; entries newer than the horizon are
"recent". The capability composes a short context block:

  1. An opening paragraph naming the **current focus** — the
     most recent entry of `kind: action` or `kind: note` flagged
     as "focus" via a tag.
  2. A **recent actions** list — the last ~5 entries of
     `kind: action`, chronological.
  3. The **last three decisions** — pulled from journal entries
     of `kind: decision` *and* the tail of the Cell's
     `DECISIONS.md`.
  4. **Open questions** count — read from `OPEN_QUESTIONS.md` —
     and the top three by recency.

Total context is capped at ~4 000 tokens. The output is markdown
and can be pasted directly into a `CLAUDE.md` preamble, included
in a `session_resume` response from the Weaver, or read by the
Wizard before opening a new chat.

## Storage and provenance

Storage is PocketBase, collection `wp_journal_entries`. The
collection is ensured on the Journal's first invocation. The
Weaver acts as superuser to write rows; the Wizard's identity is
recorded on each row as `actor_id` and `actor_email`.

Provenance — what model produced the embedding, what model
synthesised the bootstrap context — is recorded in the audit
event (`wp.spinner.invoke`) and is available via the Silk
Pattern on the Spinner detail page.

## What this Spinner does not do

  - **It does not edit entries.** Append-only.
  - **It does not interpret recall results.** It returns
    candidates; the Wizard ranks.
  - **It does not publish entries publicly.** The `public: true`
    flag marks eligibility; the actual publish capability ships
    later (`OPEN_QUESTIONS.md`).
  - **It does not write to DECISIONS.md or OPEN_QUESTIONS.md.**
    Those are canonical sources; the journal references them.
