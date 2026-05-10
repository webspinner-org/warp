# Cards

## The rule

A card earns its borders when **three** of these are true at once:

  1. The contents are independently meaningful — the patron could
     extract this card to a different surface (a notification, a
     share preview, a bookmark) and the card would still make
     sense.
  2. The card has one focal element (a title, a number, a metric)
     and supporting detail that defers to it.
  3. The card lives among siblings that share its shape — a grid,
     a deck, a row of metrics. A lone card on a page is usually
     a missing surface.
  4. The card invites action — click for detail, copy a value,
     dismiss, expand.

If fewer than three are true, what you want is a **list row**, not
a card. Lists row well at scale (hundreds, thousands); cards do
not.

## Padding floor

  - **Hero cards** (one-of-one surfaces, e.g. a Spinner detail
    page header): `1.5rem 1.85rem` minimum.
  - **Grid cards** (Status page cards, dashboard tiles):
    `1.4rem 1.65rem` minimum.
  - **Compact list rows** (Skein entries, audit entries, Silk
    Pattern entries): `0.6rem 0.6rem` is enough; the breathing
    room comes from the line-height and inter-row separator, not
    from intra-row padding.

Below these floors the card reads "dashboard sysadmin" rather than
"Cell". Above them the surface starts to waste vertical real
estate when entries multiply.

## Hierarchy within a card

One focal element per card. The rest serves it.

  - **Focal**: 1rem+ at gold or text, font-prose if it's a name or
    a quote, font-data if it's a metric. Bold or 600+ weight.
  - **Supporting meta** (path, version, timestamp, capability
    count): 0.72-0.78rem at text-mute, font-data, dot-separated.
  - **Description** (one line, single ellipsed line on list rows;
    up to three lines on grid cards): text-secondary, 0.85-0.95rem,
    font-data or font-prose depending on whether the description
    is data or voice.
  - **Status pill** (verified / pending / threadable / threaded):
    0.62-0.7rem uppercase small-caps, severity-coloured border and
    fill, flex-shrink: 0 so it never wraps.
  - **Chevron** for clickable rows: text-faint, 1.4rem, slides on
    hover. Decorative; not a focal element.

## List row vs card

A list row is a card laid down on its side and stripped of borders.

Use a **list row** when:

  - The entries are numerous (≥ ~20).
  - The patron will scan, not browse.
  - One line of detail is enough per entry.
  - Filtering and search are the primary affordances.

Use a **card** when:

  - The entries are few (≤ ~12 visible at once).
  - Each entry rewards lingering — a thumbnail, a multi-line
    description, multiple actions.
  - The grid is the spatial metaphor (gallery, deck, board).

The Skein at thousands of Spinners is a list. The Status page's
"Cell roles / Reach / Federation" trio is a card grid. The Spinner
detail hero is one card; the capabilities are a list row inside
the page.

## How Pablo checks it

1. **Card-or-row identification.** Any `<article>`, `<li>`, or
   `<div>` with `border`, `border-radius`, and `padding` ≥ 0.5rem
   is a candidate card.
2. **Padding check.** If grid cards have less than the floor above,
   flag *composition: cramped card*.
3. **Focal check.** If two elements inside the card compete for
   focus (both at 1rem+, both bold, both gold), flag *composition:
   competing focal points within card*.
4. **Scale check.** If a grid of cards has > 20 entries, recommend
   migration to list rows (severity **low**, NN/g).

## Sources

- Material Design 3 — *Cards* (focal element, supporting content
  hierarchy).
  [https://m3.material.io/components/cards](https://m3.material.io/components/cards)
- Apple Human Interface Guidelines — *List rows and tables* (the
  inverse pattern, when density wins).
  [https://developer.apple.com/design/human-interface-guidelines/](https://developer.apple.com/design/human-interface-guidelines/)
- Nielsen Norman Group — *Card UI: Where Bad UX Comes From*
  (Bigelow, 2019). The case for resisting the card reflex when a
  list works.
