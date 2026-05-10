// See https://svelte.dev/docs/kit/types#app for what these interfaces accept.
// Server-side configuration (vault master key, PocketBase URL, etc.) is read
// from process.env at runtime — see src/lib/server/config.ts.

declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}  // Node adapter — no platform binding
  }
}

export {};
