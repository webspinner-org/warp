import type { Brand } from './types.js';

/**
 * VaultURI — a stable reference to a secret stored in the vault. Never
 * embeds the secret value itself; resolved at runtime by the vault client.
 *
 * Grammar (RFC 3986-conformant; query params are position-agnostic):
 *
 *   vault-uri   = "vault://" cell "/" secret-path
 *                 [ "?" query ] [ "#" field-path ]
 *   cell        = 1*( ALPHA / DIGIT / "-" / "_" )
 *   secret-path = segment *( "/" segment )
 *   field-path  = segment *( "." segment )
 *   segment     = 1*( ALPHA / DIGIT / "-" / "_" / "." / "~" )
 *   query       = qparam *( "&" qparam )
 *   qparam      = qkey "=" qval
 *
 * The query key `v` is reserved: when present it must be a positive integer
 * naming a specific stored version of the secret (used for rotation rollback).
 *
 * The fragment is a dot-path into a JSON-shaped secret — e.g.
 * `vault://_self/litellm/keys#openai.primary` selects the `openai.primary`
 * field of a JSON secret.
 *
 * The `cell` segment names the Cell that owns the secret (canon §3). For
 * locally-owned secrets, `_self` is reserved. Cell names with a leading
 * underscore are reserved for Foundation use; registration is enforced in
 * the vault layer, not by this parser.
 */
export type VaultURI = Brand<string, 'VaultURI'>;

export interface ParsedVaultURI {
  readonly cell: string;
  readonly path: string;
  readonly version?: number;
  readonly field?: string;
  /** All query params as parsed, including `v` if present. */
  readonly query: ReadonlyMap<string, string>;
}

export type VaultURIParseError =
  | { readonly kind: 'bad-scheme' }
  | { readonly kind: 'missing-cell' }
  | { readonly kind: 'invalid-cell'; readonly cell: string }
  | { readonly kind: 'missing-path' }
  | { readonly kind: 'invalid-path-segment'; readonly segment: string }
  | { readonly kind: 'bad-version'; readonly value: string }
  | { readonly kind: 'invalid-field-segment'; readonly segment: string };

export type VaultURIParseResult =
  | { readonly ok: true; readonly uri: VaultURI; readonly parsed: ParsedVaultURI }
  | { readonly ok: false; readonly error: VaultURIParseError };

const SCHEME = 'vault://';
const SEGMENT_RE = /^[A-Za-z0-9._~-]+$/;
const CELL_RE = /^[A-Za-z0-9_-]+$/;
const VERSION_RE = /^[0-9]+$/;

export function parseVaultURI(input: string): VaultURIParseResult {
  if (!input.startsWith(SCHEME)) {
    return { ok: false, error: { kind: 'bad-scheme' } };
  }
  let rest = input.slice(SCHEME.length);

  // Fragment (field path) is the rightmost component — split first.
  let field: string | undefined;
  const fragIdx = rest.indexOf('#');
  if (fragIdx >= 0) {
    field = rest.slice(fragIdx + 1);
    rest = rest.slice(0, fragIdx);
    for (const seg of field.split('.')) {
      if (!SEGMENT_RE.test(seg)) {
        return { ok: false, error: { kind: 'invalid-field-segment', segment: seg } };
      }
    }
  }

  // Query — collect all params; extract `v` into version if valid.
  const query = new Map<string, string>();
  let version: number | undefined;
  const qIdx = rest.indexOf('?');
  if (qIdx >= 0) {
    const qStr = rest.slice(qIdx + 1);
    rest = rest.slice(0, qIdx);
    for (const param of qStr.split('&')) {
      const eq = param.indexOf('=');
      const key = eq >= 0 ? param.slice(0, eq) : param;
      const val = eq >= 0 ? param.slice(eq + 1) : '';
      query.set(key, val);
      if (key === 'v') {
        if (!VERSION_RE.test(val)) {
          return { ok: false, error: { kind: 'bad-version', value: val } };
        }
        version = Number.parseInt(val, 10);
      }
    }
  }

  // Cell + path.
  const slashIdx = rest.indexOf('/');
  if (slashIdx < 0) {
    return { ok: false, error: { kind: 'missing-path' } };
  }
  const cell = rest.slice(0, slashIdx);
  const pathStr = rest.slice(slashIdx + 1);

  if (cell.length === 0) {
    return { ok: false, error: { kind: 'missing-cell' } };
  }
  if (!CELL_RE.test(cell)) {
    return { ok: false, error: { kind: 'invalid-cell', cell } };
  }
  if (pathStr.length === 0) {
    return { ok: false, error: { kind: 'missing-path' } };
  }
  for (const seg of pathStr.split('/')) {
    if (!SEGMENT_RE.test(seg)) {
      return { ok: false, error: { kind: 'invalid-path-segment', segment: seg } };
    }
  }

  return {
    ok: true,
    uri: input as VaultURI,
    parsed: {
      cell,
      path: pathStr,
      ...(version !== undefined ? { version } : {}),
      ...(field !== undefined ? { field } : {}),
      query,
    },
  };
}

/**
 * Builds a VaultURI from parts. Throws on any invalid component — callers
 * are expected to construct from validated inputs (e.g. UI forms that have
 * already enforced segment grammar). For untrusted input, parse instead.
 */
export function buildVaultURI(parts: ParsedVaultURI): VaultURI {
  if (!CELL_RE.test(parts.cell)) {
    throw new Error(`Invalid VaultURI cell: ${JSON.stringify(parts.cell)}`);
  }
  for (const seg of parts.path.split('/')) {
    if (!SEGMENT_RE.test(seg)) {
      throw new Error(`Invalid VaultURI path segment: ${JSON.stringify(seg)}`);
    }
  }
  if (parts.field !== undefined) {
    for (const seg of parts.field.split('.')) {
      if (!SEGMENT_RE.test(seg)) {
        throw new Error(`Invalid VaultURI field segment: ${JSON.stringify(seg)}`);
      }
    }
  }

  let result = `${SCHEME}${parts.cell}/${parts.path}`;

  // version overrides any conflicting `v` already present in `query`.
  const merged = new Map(parts.query);
  if (parts.version !== undefined) {
    merged.set('v', String(parts.version));
  }
  if (merged.size > 0) {
    const qstr = [...merged.entries()].map(([k, v]) => `${k}=${v}`).join('&');
    result += `?${qstr}`;
  }

  if (parts.field !== undefined) {
    result += `#${parts.field}`;
  }

  return result as VaultURI;
}
