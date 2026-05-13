# How {{displayName}} works

{{displayName}} is the simplest possible Spinner. It exists so you can
read every line of it, understand the architecture's atomic unit, and
extend it with confidence.

## What it does

One capability: **greet**. You hand it a name; it hands you back a
greeting and the moment the greeting was issued. That's the whole
shape.

```
greet({ name: "World" })
  → { greeting: "Hello, World", greetedAt: "2026-05-12T17:00:00.000Z" }

greet({ name: "Webspinner", salutation: "Howdy" })
  → { greeting: "Howdy, Webspinner", greetedAt: "2026-05-12T17:00:00.000Z" }
```

The greeting is composed deterministically — same input, same output,
modulo the timestamp. No model is consulted. No data is fetched. No
secret is read. The capability is a function in the mathematical
sense.

## What it doesn't do

- It doesn't reach the network.
- It doesn't read any Spool.
- It doesn't request any vault entry.
- It doesn't invoke any other Spinner.
- It doesn't accumulate state beyond what the Silk Pattern records.

This minimum is on purpose. Every Spinner declared in the manifest's
`spools`, `vault`, `env`, or `dependsOn` adds surface area the
Weaver must reason about. {{displayName}} has zero such declarations —
which is why a Webspinner can read it end-to-end and feel safe
forking it as the basis for something bigger.

## Where to look

- `src/index.ts` — the capability handler. ~25 lines. Read this first.
- `manifest.json` — the declarative contract. Every field has a
  purpose; nothing is decorative.
- `mission-lock.md` — the operative behavioral contract. Even though
  this Spinner doesn't call a model, the mission-lock matters for
  audit and for future capabilities that will.

## What to do with it

Three paths:

1. **Read it.** Get familiar with the Spinner shape so you can author
   your own.
2. **Invoke it.** From `/admin/spinners/{{slug}}`, click the _greet_
   capability and pass a name. Watch the Silk Pattern entry land.
3. **Fork it.** Copy the bundle to a new slug, rename it, change the
   capability — or add another. The smallest useful change reveals
   how much of the architecture is doing the heavy lifting for you.

When you outgrow {{displayName}}, you'll author a Spinner that reaches
out — a Spool to pull from, a model to consult, a network endpoint
to drive. Each addition gets declared in `manifest.json` so the
Weaver and the audit chain know what to watch.
