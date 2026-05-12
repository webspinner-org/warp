/**
 * RFC 8785 — JSON Canonicalization Scheme (JCS).
 *
 * Produces a deterministic UTF-8 string representation of a JSON value:
 * sorted object keys (UTF-16 code-unit order, which equals UTF-8 code-point
 * order for the basic plane), no insignificant whitespace, numbers
 * formatted per ECMA-262 §6.1.6.1 (which is what `JSON.stringify` already
 * does — RFC 8785 specifically picks JS's number-to-string behavior). Two
 * JSON values that are semantically equal canonicalize to byte-identical
 * strings — the property the Spinner digest needs.
 *
 * Hand-rolled, no external dependency, ~40 lines. Per `STANDARDS.md` —
 * canonicalization of bundle digest serialization is the canonical
 * Warp-specific primitive we hand-roll.
 *
 * Constraints:
 *  - NaN and Infinity are rejected (JSON spec; matches the canonicalize
 *    npm package's behavior).
 *  - `undefined`, functions, and symbols at the root throw — same rules
 *    as `JSON.stringify` rejecting them as a value.
 *  - Inside an object, properties whose value is `undefined`/function/
 *    symbol are skipped (matches `JSON.stringify`).
 *  - Inside an array, slots with `undefined`/function/symbol are
 *    rendered as `null` (matches `JSON.stringify`).
 */

export function canonicalizeJSON(value: unknown): string {
  const out = serialize(value);
  if (out === undefined) {
    throw new Error(
      'canonicalizeJSON: input is not representable as JSON ' +
        '(undefined, function, or symbol at the root)',
    );
  }
  return out;
}

function serialize(value: unknown): string | undefined {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (typeof value === 'number') {
    if (Number.isNaN(value)) throw new Error('canonicalizeJSON: NaN is not allowed');
    if (!Number.isFinite(value)) throw new Error('canonicalizeJSON: Infinity is not allowed');
    // JSON.stringify uses ECMA-262 Number.toString — RFC 8785 §3.2.2.3
    // explicitly specifies this algorithm for number serialization.
    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    // JSON.stringify already escapes per RFC 8259 §7. RFC 8785 §3.2.2.2
    // accepts that behavior (with the note that all strings must be
    // valid UTF-8; we assume the input is already a valid JS string).
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item: unknown) => serialize(item) ?? 'null');
    return '[' + items.join(',') + ']';
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const child = serialize(obj[key]);
      if (child === undefined) continue; // skip undefined/function/symbol per JSON.stringify
      parts.push(JSON.stringify(key) + ':' + child);
    }
    return '{' + parts.join(',') + '}';
  }

  // undefined, function, symbol — caller treats `undefined` return as "skip"
  return undefined;
}
