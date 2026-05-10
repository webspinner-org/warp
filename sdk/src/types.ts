declare const __brand: unique symbol;

/**
 * Branded string type — gives nominal typing to otherwise stringly-typed
 * values (VaultURI, SpinnerName, SpinnerDigest, etc.) at zero runtime cost.
 * Two branded types with different `B` strings are nominally distinct: a
 * `VaultURI` is not assignable to a `SpinnerName` and vice versa, even
 * though both are structurally `string`.
 */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

/**
 * A JSON Schema (Draft 2020-12) document. Typed loosely because TypeScript
 * cannot fully express JSON Schema's recursive shape; the source of truth
 * is runtime validation via Ajv (or equivalent), wired downstream.
 */
export type JSONSchema = Record<string, unknown>;
