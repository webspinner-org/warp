// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    interface Locals {
      user: {
        readonly email: string;
        readonly isWizard: boolean;
      } | null;
    }
  }
}

export {};
