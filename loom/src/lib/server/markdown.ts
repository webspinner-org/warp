import { marked } from 'marked';

// Markdown rendering for in-Loom documentation surfaces.
//
// The Webspinner UX is everything (Operating Principle §17 spirit, and the
// Wizard's directive: documentation viewable in the UX, transparent and
// explanatory). Today the source markdown comes from this repo — files we
// authored — so XSS surface is bounded. When user-published Spinners enter
// the Cell, sanitisation lands as a focused work item; today, the Loom
// only renders Foundation- and Wizard-authored content.

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function renderMarkdown(source: string): string {
  // marked exposes a synchronous mode when no async extensions are
  // registered. We don't register any, so the parse() call is sync.
  return marked.parse(source) as string;
}
