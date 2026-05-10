# Typography

## The rule

Three numbers and one system.

  - **Body measure ≤ 75 characters.** A line longer than that loses
    the eye on the return sweep — the reader hunts for the next
    line's start and misreads. (web.dev / Robert Bringhurst, *The
    Elements of Typographic Style*.)
  - **Line-height ≥ 1.4 for body, ≥ 1.2 for headings.** Tighter than
    this on body text and adjacent rows of descenders/ascenders touch;
    the eye reads "wall of text" rather than "stack of lines".
  - **Body font-size ≥ 16px or its em equivalent on prose surfaces.**
    Below 14px, body text fatigues fast. Admin chrome (table headers,
    captions, meta) may go down to 12px — but only as labels, not as
    sustained prose.

## The Webspinner font system

Tokens defined in `~/warp/loom/src/routes/+layout.svelte`. All
families are OS-bundled so the bootstrap Cell ships no font
dependencies; a Foundation typeface lands later.

| Token | Stack | Use |
|---|---|---|
| `--font-prose` | Iowan Old Style → Hoefler Text → Charter → Georgia → serif | Headings, lede, note, manuscript prose, Pablo's voice line. The "voice" surfaces. |
| `--font-data` | Apple system → SF Pro Text → Inter → system-ui → sans-serif | Data tables, dl rows, ribbons, nav, form controls. The "chrome" surfaces. |
| `--font-mono` | SF Mono → Menlo → ui-monospace | Code, identifiers, paths, hashes, anything where alignment matters. |

The pairing matters: a Cell is a manuscript with a control panel, not
a dashboard. Voice surfaces wear the serif so they sound like
themselves; chrome wears the sans so it stays out of the way.

## How Pablo checks it

1. **Measure.** For every block-level element rendering text, compute
   the effective `max-width` in characters at the current font-size.
   If the element has no max-width set and lives in a parent wider
   than ~75ch, flag.
2. **Line-height.** Inspect computed style; if the element has body
   prose and `line-height < 1.4`, flag.
3. **Font-size.** On prose surfaces (`.lede`, `.note`, `.answer`,
   `.placeholder`, manuscript-rendered markdown), require ≥ 0.95rem
   (~15.2px). On chrome (`.meta`, `.label`, table headers), 0.7rem
   floor is acceptable for small-caps at ≥ 600 weight.
4. **Family pairing.** If a `.lede` or `.note` or `.answer` uses the
   data sans, flag — voice surfaces wear the serif. If a dl `dd`
   uses the serif italic, flag — chrome stays in sans.

## Common failures

  - System sans on a manuscript surface — the page reads dashboard,
    not Cell.
  - 13.6px (`0.85rem`) body text crammed at line-height 1.2 — the
    eye fatigues by the third paragraph.
  - 80-character lines unbroken — the F-pattern collapses; the
    reader's eye returns to the wrong line.

## Sources

- web.dev — *Web typography reference* (line length, line-height,
  font-size).
  [https://web.dev/articles/typography](https://web.dev/articles/typography)
- Robert Bringhurst — *The Elements of Typographic Style* (4th ed.).
  The 66-character rule, the ideal of measure.
- Nielsen Norman Group — *Legibility, Readability, and Comprehension:
  Making Users Read Your Words*.
- Butterick — *Practical Typography*, especially the chapter on
  point size and line spacing.
  [https://practicaltypography.com/](https://practicaltypography.com/)
