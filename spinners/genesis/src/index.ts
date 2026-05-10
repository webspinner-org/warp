// Genesis Spinner — entrypoint contract.
//
// The handlers that execute the eight provisioning capabilities are open
// work. The recipe they encode is in `../how-it-works.md` and was run by
// hand at the Cell's founding (`DECISIONS.md` 2026-05-10 — *Genesis
// Spinner: encoding the founding bootstrap*). The contract this module
// exports does not change when the handlers land.

export type Capability =
  | 'provisionToolchain'
  | 'syncRepo'
  | 'buildWorkspace'
  | 'generateBootstrapState'
  | 'deployGrimoire'
  | 'seedVault'
  | 'deployLoom'
  | 'verifyCell';

export async function invoke(capability: Capability): Promise<unknown> {
  throw new Error(
    `Genesis Spinner capability "${capability}" pending implementation. ` +
      `The recipe is documented in spinners/genesis/how-it-works.md; ` +
      `handlers will land as a focused next-turn build.`,
  );
}
