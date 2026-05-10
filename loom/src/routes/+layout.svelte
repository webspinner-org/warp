<script lang="ts">
  let { children } = $props();
</script>

{@render children()}

<style>
  /* Brand palette — warm gold for primary type and headings, cool cyan for
     accents (active nav, links, focus rings). Text scale tuned to WCAG AA
     (≥ 4.5:1) on the bg-0 background; mute targets AAA (≥ 7:1) for any
     run of body copy, with --text-faint reserved for tertiary marginalia
     (timestamps, "5 of 12" counts) where the dim is intentional and brief. */
  :global(:root) {
    --gold: #c9a96a;
    --gold-dim: #8a7341;
    --gold-bright: #e6c98a;
    --cyan: #5fcfe0;
    --cyan-dim: #4ba9b8;
    --bg-0: #0a0a0a;
    --bg-1: #111;
    --bg-2: #161616;
    --line: #1f1f1f;
    --text: #f0f0f0;        /* 14.7:1 — high-emphasis body */
    --text-secondary: #cfcfcf; /* 10.6:1 — secondary body  */
    --text-dim: #b4b4b4;    /* 7.6:1 — labels, captions, dl dt */
    --text-mute: #9a9a9a;   /* 5.6:1 — meta, footnotes, less-loud nav */
    --text-faint: #7d7d7d;  /* 3.7:1 — tertiary only; large/heavy text only */
  }
</style>
