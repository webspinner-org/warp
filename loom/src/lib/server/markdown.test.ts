import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown.js';

describe('renderMarkdown', () => {
  it('renders a heading', () => {
    const html = renderMarkdown('# Hello');
    expect(html).toContain('<h1');
    expect(html).toContain('Hello');
  });

  it('preserves em-dashes verbatim (canon §14)', () => {
    const html = renderMarkdown('This — that — the other.');
    expect(html).toContain('—');
    // Should NOT be replaced with hyphens.
    expect(html).not.toMatch(/This - that/);
  });

  it('renders inline code', () => {
    const html = renderMarkdown('Use `WARP_PB_EMAIL`.');
    expect(html).toContain('<code>WARP_PB_EMAIL</code>');
  });

  it('renders a fenced code block', () => {
    const html = renderMarkdown('```ts\nconst x = 1;\n```');
    expect(html).toContain('<code');
    expect(html).toContain('const x = 1;');
  });
});
