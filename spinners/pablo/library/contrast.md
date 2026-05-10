# Contrast

## The rule

**WCAG 2.2 SC 1.4.3 — Contrast (Minimum).** Visual presentation of
text and images of text has a contrast ratio of at least 4.5:1 against
the background, with these exceptions:

  - **Large text** (≥ 24px regular, or ≥ 18.66px bold): at least 3:1.
  - **Incidental text** (inactive, pure decoration, invisible to
    everyone, or part of a logo): exempt.
  - **UI components and graphical objects** (focus rings, icons that
    convey state, chart lines that distinguish data): at least 3:1
    (WCAG 2.2 SC 1.4.11).

WCAG 2.2 SC 1.4.6 raises the bar to **7:1** for AAA conformance on
small text; the Foundation aims for AAA on any prose surface (lede,
note, manuscript) and accepts AA on data chrome (dl rows, table
cells, ribbons).

## Why

Text the patron cannot read costs them effort the page hasn't earned.
On the bg-0 background (#0a0a0a), the eye fights anything dimmer than
~#9a9a9a; below that, "the page reads grey" — a complaint that has
nothing to do with WCAG math and everything to do with the
*perceived* failure of the surface to admit its reader.

## The Warp text scale

All ratios are against `--bg-0` (#0a0a0a). Tokens live in
`~/warp/loom/src/routes/+layout.svelte`.

| Token | Value | Ratio | Role |
|---|---|---|---|
| `--text` | `#f0f0f0` | 14.7:1 | High-emphasis body, manuscript prose |
| `--text-secondary` | `#cfcfcf` | 10.6:1 | Secondary body, dl dd, table cells |
| `--text-dim` | `#b4b4b4` | 7.6:1 | Captions, lede prose, .muted |
| `--text-mute` | `#9a9a9a` | 5.6:1 | Meta, footnotes, table headers |
| `--text-faint` | `#7d7d7d` | 3.7:1 | **Only** small-caps labels @ 600 weight (large-text rule) |
| `--gold-dim` | `#a08658` | 5.4:1 | dl dt small-caps keys (large-text rule) |
| `--gold` | `#c9a96a` | 7.8:1 | Brand headings, accent |
| `--cyan` | `#5fcfe0` | 11.0:1 | Active nav, links, focus rings |

`--text-faint` and `--gold-dim` fall below 4.5:1 against bg-0 and
**must** only appear on text styled with ≥ 600 weight in small-caps
or ≥ 24px. Otherwise they fail AA.

## How Pablo checks it

For every `color:` rule encountered:

1. Resolve the value (follow CSS variables to the layout root).
2. Compute the ratio against the effective background (default
   `--bg-0`; for nested elements, the nearest ancestor `background-color`).
3. Flag findings:
    - **High** — ratio < 3:1 on body text; ratio < 4.5:1 on small body.
    - **Medium** — ratio between 4.5:1 and 5.5:1 on prose surfaces
       where AAA is preferred (lede, note, manuscript).
    - **Low** — ratio passes but reads dim subjectively; Pablo's-eye.

When in doubt, Pablo prefers a brighter value over a dimmer one. The
Foundation does not need text to whisper.

## Sources

- W3C — *Web Content Accessibility Guidelines (WCAG) 2.2*, Success
  Criterion 1.4.3 (Minimum), 1.4.6 (Enhanced), 1.4.11 (Non-text
  Contrast). [https://www.w3.org/TR/WCAG22/](https://www.w3.org/TR/WCAG22/)
- WebAIM — *Contrast Checker*. The Foundation uses this to validate
  the scale above.
  [https://webaim.org/resources/contrastchecker/](https://webaim.org/resources/contrastchecker/)
