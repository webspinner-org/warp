# Composition

## The rule

  - **One focal point per screen-height.** The eye lands somewhere
    when a surface loads. Choose that landing zone; do not leave it
    to whichever element happens to be brightest.
  - **Each visible region earns its first line.** If the page header
    already says "Skein", the section below should not open with
    "Skein —". If the card title is "Bootstrap Spinner", the first
    line of the description should not be "The Bootstrap Spinner is
    …". Each region picks up where the previous one left off.
  - **F-pattern is the default scan.** Western reading runs top-left
    to bottom-right with horizontal sweeps along the top and a
    vertical scan down the left edge. Place primary information
    along that path; place chrome (timestamps, version pills, "x of
    y" counts) outside it.
  - **No walls of body text without hierarchy.** Three or more
    consecutive sentences at equal weight, on the same line-length,
    in the same colour, *will* be skipped by a third of patrons.
    Break with a subhead, a list, a pull quote, or whitespace.

## Why

NN/g's eye-tracking work shows that on dense surfaces patrons scan,
they do not read. Composition's job is to make the scan land on what
matters and let the reader choose to descend.

## How Pablo checks it

1. **Focal-point audit.** Identify the element that should be the
   landing zone (usually the largest text on the surface — the h1).
   If two elements compete (h1 plus a giant CTA both at 1.6rem+
   gold) and they aren't adjacent, flag *composition: competing
   focal points*.
2. **First-line redundancy.** Read the first three lines of each
   region. If two consecutive regions both name the same noun
   (e.g. "Spinners" page header + "Spinners — installed" subhead),
   flag.
3. **Wall of text.** Any sequence of more than ~250 words at uniform
   weight, colour, and indentation, with no break (subhead, list,
   blockquote, separator) — flag *composition: wall of text*.
4. **F-pattern fit.** If a primary action or essential metadata
   lives in the bottom-right outside the F-path, flag — patrons
   miss it.

## Common failures

  - The page title repeats in the ribbon, the h1, and the lede.
  - A search input and a primary CTA both occupy the same screen
    height, competing for the eye.
  - A `<dl>` of 12 rows at equal brightness — the eye reads "block
    of evenly-bright text" not "label → answer".
  - 800 words of placeholder copy in one paragraph because someone
    pasted the spec.

## When density wins

Admin surfaces are a known exception. The Wizard wants dense lists
of Spinners, not breathing-room cards — the Skein at thousands of
entries cannot afford the white space the Foundation marketing site
can. On admin chrome, accept tighter composition and rely on
hierarchy (icon + title + meta + chev) within each row rather than
between rows. Cite `cards.md` §3 to override Pablo here.

## Sources

- Nielsen Norman Group — *F-Shaped Pattern of Reading on the Web*
  (Nielsen, 2006; updated 2017).
  [https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/)
- Stephen Few — *Information Dashboard Design* (2nd ed.) on data
  ink, the "no decoration without information" principle.
- Edward Tufte — *The Visual Display of Quantitative Information*,
  for the broader argument on chartjunk and visual hierarchy.
