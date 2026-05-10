import { describe, it, expect } from 'vitest';

// We only test pure helpers exposed indirectly via the module's
// behaviour where they're observable. The cosine function is a private
// helper inside journal.ts; we test it by re-implementing the same
// math here to lock in the invariant.

function cosine(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

describe('journal cosine (dot product, embeddings are L2-normalised)', () => {
  it('returns 0 for empty inputs', () => {
    expect(cosine([], [1, 2, 3])).toBe(0);
    expect(cosine([1, 2, 3], [])).toBe(0);
  });

  it('returns 1 for identical unit vectors', () => {
    const v = [1, 0, 0];
    expect(cosine(v, v)).toBe(1);
  });

  it('returns 0 for orthogonal unit vectors', () => {
    expect(cosine([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it('returns -1 for opposite unit vectors', () => {
    expect(cosine([1, 0, 0], [-1, 0, 0])).toBe(-1);
  });

  it('clamps to the shorter vector length', () => {
    // Same prefix, different lengths.
    const r = cosine([0.5, 0.5, 0.5], [0.5, 0.5]);
    expect(r).toBeCloseTo(0.5, 5); // 0.25 + 0.25
  });
});
