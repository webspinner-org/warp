# How Pablo works

Pablo is the design-quality reviewer the Webspinner Foundation runs
against every patron-facing surface the Loom renders. He has one
capability: **review**.

## What he reads

Pablo takes a single piece of HTML — a page the Loom just rendered —
and walks it as a critic. He does not browse, fetch, or scrape; the
caller hands him the HTML. The Wizard or another Spinner gives him
context: a label (what the surface is for) and an optional topic
(the patron's task or the Wizard's intent).

For long pages, the Loom truncates the body before handing it to
Pablo so the head and the first eight thousand characters of body are
visible. The full page roundtrips later when the integrity-aware
runtime lands.

## The cited library

Pablo's mind is grounded in a library he carries inline:

- **Accessibility** — WCAG 2.2 contrast, focus visibility, labels/
  instructions, descriptive headings.
- **Typography** — web.dev rules on body measure (≤ 75 ch) and
  line-height (≥ 1.4 body, ≥ 1.2 headings).
- **Composition** — NN/g F-pattern, one focal point per screen-height,
  no walls of evenly-bright text.
- **Information design** — Stephen Few on data ink and dashboard
  hierarchy, especially key/value pairs in `dl` rows.
- **Brand consistency** — the Webspinner vocabulary (SI not AI; Cell
  not tenant; Spinner not agent; …), em-dash preservation, no
  internal hostnames in patron copy.

The full library is in his Mission Lock. When the foundation library
lands as a Spool, Pablo's citations will deepen — for now they live
inline.

## What he returns

Strict JSON. A verdict (`passes`, `concerns`, or `fails`), a one-line
plain-voice summary, a quotable opening line in his
French-painter register, and a list of findings. Each finding carries
a severity, a category, the offending evidence quoted from the HTML,
an imperative fix, and a source — either a library rule or
`pablos-eye` when the judgement is visual but the library does not
yet codify it.

The Loom unpacks the JSON and renders findings as severity-tagged
cards on the surface that asked for the review.

## What he does not do

Pablo critiques. He does not edit. The fixer is the Remediator —
documented separately and not yet ported. Pablo names the problem;
the Wizard or the Remediator changes the file.

## Costs

Pablo runs on the Quiet Loom (Qwen 2.5 14B Instruct, MLX, on the
Cell). He does not call out to a third-party model. There is no
per-invocation dollar cost; the cost is GPU seconds on the Cell. A
typical review of a small admin page returns in 6–12 seconds.

## Provenance

Pablo's persona, JSON contract, and cited library trace back to the
Foundation pipeline reference implementation. The strict-JSON shape
and the inline library both come from there verbatim. His port to
Warp — manifest, Mission Lock, and dispatch in the Loom — is his
v0.1 as a first-class Spinner.
