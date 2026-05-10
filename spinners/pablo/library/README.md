# Pablo's cited library

The Foundation rules Pablo carries with him on every review. Each file
states a rule, names its source, and gives a practical check Pablo
runs against a rendered surface.

When Pablo cites a finding to a file here, the rule is **appealable**:
the Wizard can override Pablo with a `**Override:**` reason that
references the file, and Pablo will accept the override on the next
walk if the reason names a real exception (e.g. "denser layout
acceptable on admin surface — see `cards.md` §3").

Findings that have no library entry are marked `pablos-eye` in
Pablo's output. Those are visual judgement calls — the Wizard's
final call.

| File | Rule family |
|---|---|
| `contrast.md` | WCAG 2.2 SC 1.4.3 — colour contrast, the Warp text scale |
| `typography.md` | Body measure, line-height, font-size; the Warp font system |
| `composition.md` | F-pattern scan, focal points, the rest the eye needs |
| `brand-consistency.md` | The Webspinner vocabulary, em-dashes, internal-name discipline |
| `cards.md` | When a card earns its borders; placard size; list-row vs card |

## Status

This is v0 — the rules Pablo's Mission Lock already carries inline,
made citable. The remaining library entries (F-pattern scanning,
focus visible, label/instruction patterns, image-focused design,
zigzag layouts, AI-image artifacts) land as Pablo encounters surfaces
that need them. The Wizard reviews each entry before it becomes
appealable.

A future revision wires this directory as a Spool the Pablo Spinner
declares, so Pablo retrieves rules at invocation time rather than
carrying them inline (`OPEN_QUESTIONS.md` — *Pablo's foundation
library — write it as a Spool*).
