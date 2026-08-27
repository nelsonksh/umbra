export const UmbraPrivateStateId = "umbraPrivateState" as const;

export type UmbraPrivateState = {
  readonly secretKey: Uint8Array;
  readonly workHash: Uint8Array | null;
  readonly salt: Uint8Array | null;
};

type WebCrypto = { getRandomValues<T extends Uint8Array>(array: T): T };

// biome-ignore lint/suspicious/noExplicitAny: cross-env Web Crypto API — not in ESNext lib
const _crypto: WebCrypto = (globalThis as unknown as { crypto: WebCrypto })
  .crypto;

export const randomSecretKey = (): Uint8Array =>
  _crypto.getRandomValues(new Uint8Array(32));

export const initialUmbraPrivateState = (
  secretKey: Uint8Array = randomSecretKey(),
): UmbraPrivateState => ({
  secretKey,
  workHash: null,
  salt: null,
});

type WitnessCtx = { readonly privateState: UmbraPrivateState };

export const umbraWitnesses = {
  // The submitter's (or grader's) own secret key. Only a hash of this ever
  // reaches the ledger — see derive_pk() in umbra.compact.
  local_secret_key: (ctx: WitnessCtx): [UmbraPrivateState, Uint8Array] => [
    ctx.privateState,
    ctx.privateState.secretKey,
  ],
  // Hash of the actual submitted work (computed off-chain, before calling
  // submit()). Must be re-supplied identically at reveal() time.
  get_work_hash: (ctx: WitnessCtx): [UmbraPrivateState, Uint8Array] => {
    const { workHash } = ctx.privateState;
    if (workHash === null) {
      throw new Error("Work hash not set: call setWork() before submit()/reveal()");
    }
    return [ctx.privateState, workHash];
  },
  get_salt: (ctx: WitnessCtx): [UmbraPrivateState, Uint8Array] => {
    const { salt } = ctx.privateState;
    if (salt === null) {
      throw new Error("Salt not set: call setWork() before submit()/reveal()");
    }
    return [ctx.privateState, salt];
  },
};
