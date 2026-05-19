// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    interface Locals {
      user: {
        readonly sub: string;
        readonly email: string;
        readonly name: string;
        readonly picture?: string;
        readonly isWizard: boolean;
      } | null;
    }
  }
}

export {};
