# F-pattern scanning

## The rule

The first and dominant scan pattern on text-heavy surfaces in
Western languages is the **F-pattern**: a horizontal sweep across
the top of the page, a shorter sweep partway down, and a vertical
scan down the left edge picking up first words of subsequent lines.
Patrons do not read; they scan, and the F-pattern is the shape of
the scan.

Composition follows the scan:

  - **The first line of every region earns its place.** The eye
    lands there. Waste the first line and the patron moves on.
  - **Primary information lives along the F-path.** Top-left,
    top-band, left-edge are the seen-first slots.
  - **Sub-headings and bolded leads anchor the vertical scan.**
    Patrons read the first three to five words of each one,
    deciding which paragraphs to read in full.
  - **Patrons rarely reach the right edge or the bottom.** Crucial
    actions and metadata that live in the bottom-right outside the
    F-path will be missed.

## Why

NN/g's eye-tracking work (Nielsen 2006, updated 2017) measured this
on hundreds of pages across dozens of sites. The F-pattern is not a
guideline; it is the empirical scan behaviour. Designs that fight it
lose patrons silently — there is no error, no complaint, just
absence.

## How Pablo checks it

1. **Find the focal-point row.** Identify the first visible heading
   on the surface. If that heading is positioned away from the
   top-left landing zone (right-aligned hero, centered with sparse
   left content, etc.), flag *composition: focal point off the
   F-path*.

2. **Inspect first-line content of each region.** For each
   visible region (sections, articles, list groups), read the
   first sentence of the first line. If that sentence is
   redundant with the surrounding context (the page's h1, the
   parent section's heading), flag *composition: wasted first
   line*.

3. **Left-edge scan check.** For surfaces with multiple sections
   stacked vertically, verify that the leftmost word of each
   section's first line is meaningful in isolation. "The", "A",
   "And" as first words means the patron's left-edge scan
   collects no information.

4. **Right-edge actions.** Find primary CTAs, "Save", "Submit",
   "Delete" buttons positioned in the bottom-right. Outside the
   F-path. Flag *composition: primary action off the scan path*.

## When density wins

Admin surfaces (the Wizard's chrome) tolerate F-pattern departures
because the Wizard is a focused operator, not a scanner. Lists with
hundreds of entries depend on vertical scanning down the left edge;
the F-pattern is the default scan, not the *only* scan. Acceptable
exceptions go in the surface-specific override:

> *"Skein at thousands of Spinners → vertical-scan-only is
> intentional; the F-pattern's horizontal top sweep is irrelevant
> because the Wizard already knows what's on the page."*

## Common failures

  - Hero h1 centered horizontally, with the lede 600 px wide and
    centered below. The focal point is off the top-left landing.
  - Card grids where every card's first line is "Title:" or
    "Name:". The left-edge scan picks up nothing.
  - "Delete" or "Save" buttons aligned to the right edge of a
    bottom action bar with no other content there.
  - Subheadings buried inside paragraphs as italic phrases
    instead of standalone elements; the vertical scan misses
    them.

## Sources

- Nielsen Norman Group — *F-Shaped Pattern of Reading on the
  Web* (Nielsen, 2006; updated 2017 with new eye-tracking).
  [https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/)
- Nielsen Norman Group — *Text Scanning Patterns: Eyetracking
  Evidence* (Pernice, 2017).
- BBC GEL — *Reading Patterns for Long-form Content* — the BBC
  GEL applies the F-pattern to their news-page templates.
