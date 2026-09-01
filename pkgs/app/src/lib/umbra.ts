import * as CompactJs from "@midnight-ntwrk/compact-js";
import type { ContractAddress } from "@midnight-ntwrk/compact-runtime";
import { deployContract, findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { assertIsContractAddress, toHex } from "@midnight-ntwrk/midnight-js-utils";
import {
  Contract,
  type Ledger,
  ledger,
  type UmbraPrivateState,
  UmbraPrivateStateId,
  umbraWitnesses,
  initialUmbraPrivateState,
  pureCircuits,
} from "@umbra/contract";
import * as Rx from "rxjs";
import type { UmbraProviders } from "./providers";

export { pureCircuits };

// TypeScript 6 resolves CompiledContract.withWitnesses' conditional param
// type to `never` when the base contract type can't be statically inferred
// (same issue documented in the RPS sample's lib/rps.ts) -- `as any` bypasses
// the check while runtime behavior is unaffected. No withCompiledFileAssets()
// here (unlike the Node CLI): in the browser, FetchZkConfigProvider (see
// providers.ts) fetches the compiled circuit assets over HTTP instead.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
const _umbraBase = CompactJs.CompiledContract.make("umbra", Contract as any) as any;
export const umbraContractInstance = (CompactJs.CompiledContract.withWitnesses as any)(
  _umbraBase,
  umbraWitnesses,
);

export const deployUmbraContract = async (
  providers: UmbraProviders,
  initialPrivateState: UmbraPrivateState,
  assignmentId: Uint8Array,
  graderKey: Uint8Array,
) => {
  return deployContract(providers, {
    // biome-ignore lint/suspicious/noExplicitAny: umbraContractInstance inferred as any from chain above
    compiledContract: umbraContractInstance as any,
    privateStateId: UmbraPrivateStateId,
    initialPrivateState,
    // biome-ignore lint/suspicious/noExplicitAny: constructor args not statically typed here
    args: [assignmentId, graderKey] as any,
  });
};

export const joinUmbraContract = async (providers: UmbraProviders, contractAddress: string) => {
  return findDeployedContract(providers, {
    // biome-ignore lint/suspicious/noExplicitAny: umbraContractInstance inferred as any from chain above
    compiledContract: umbraContractInstance as any,
    contractAddress: contractAddress as ContractAddress,
    privateStateId: UmbraPrivateStateId,
    initialPrivateState: initialUmbraPrivateState(),
  });
};

// deployContract() and findDeployedContract() return slightly different
// concrete types (deploy's includes deployTxData; find's doesn't) even
// though both produce an object with a working `.callTx` at runtime -- this
// union covers whichever one a component is holding after either deploy or
// join, for the calls (submit/grade/reveal) that don't care which origin it
// came from.
export type DeployedUmbraContract =
  | Awaited<ReturnType<typeof deployUmbraContract>>
  | Awaited<ReturnType<typeof joinUmbraContract>>;

/** Set which logical identity (secret key, and optionally work + salt) is
 * "active" for the next circuit call -- see the matching helper in
 * pkgs/cli/src/api.ts for why one connected wallet can safely play
 * multiple Umbra roles this way. */
export const setActiveIdentity = async (
  providers: UmbraProviders,
  secretKey: Uint8Array,
  work?: { workHash: Uint8Array; salt: Uint8Array },
): Promise<void> => {
  const current = (await providers.privateStateProvider.get(UmbraPrivateStateId)) ?? initialUmbraPrivateState(secretKey);
  await providers.privateStateProvider.set(UmbraPrivateStateId, {
    secretKey,
    workHash: work?.workHash ?? current.workHash,
    salt: work?.salt ?? current.salt,
  });
};

// biome-ignore lint/suspicious/noExplicitAny: DeployedUmbraContract's callTx circuit methods aren't statically typed
export const submitUmbra = async (contract: DeployedUmbraContract) => (contract as any).callTx.submit();

export const gradeUmbra = async (contract: DeployedUmbraContract, id: bigint, score: bigint) =>
  // biome-ignore lint/suspicious/noExplicitAny: see submitUmbra
  (contract as any).callTx.grade(id, score);

export const revealUmbra = async (contract: DeployedUmbraContract, id: bigint) =>
  // biome-ignore lint/suspicious/noExplicitAny: see submitUmbra
  (contract as any).callTx.reveal(id);

export const getUmbraLedgerState = async (
  providers: UmbraProviders,
  contractAddress: string,
): Promise<Ledger | null> => {
  assertIsContractAddress(contractAddress);
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress as ContractAddress);
  // biome-ignore lint/suspicious/noExplicitAny: StateValue/ChargedState union not re-exported
  return contractState != null ? (ledger(contractState.data as any) as Ledger) : null;
};

export const subscribeToUmbraState = (providers: UmbraProviders, contractAddress: string): Rx.Observable<Ledger> => {
  assertIsContractAddress(contractAddress);
  return providers.publicDataProvider
    .contractStateObservable(contractAddress as ContractAddress, { type: "latest" })
    // biome-ignore lint/suspicious/noExplicitAny: see getUmbraLedgerState
    .pipe(Rx.map((contractState) => ledger(contractState.data as any) as Ledger));
};

// ─── Identity management (browser-local, per-device) ──────────────────────
// A named list of secret keys the current browser can act as. Not tied to
// the connected wallet's own identity -- the wallet only pays fees and
// signs transactions; Umbra's notion of "who" only exists via these keys,
// exactly as designed (see umbra.compact's derive_pk()).

export type Identity = { name: string; secretKeyHex: string };

const IDENTITIES_KEY = "umbra:identities";
const ACTIVE_IDENTITY_KEY = "umbra:active-identity";

const hexToBytes = (hex: string): Uint8Array => new Uint8Array(hex.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16)));

export const identitySecretKey = (identity: Identity): Uint8Array => hexToBytes(identity.secretKeyHex);

export const listIdentities = (): Identity[] => {
  try {
    const raw = localStorage.getItem(IDENTITIES_KEY);
    return raw ? (JSON.parse(raw) as Identity[]) : [];
  } catch {
    return [];
  }
};

export const createIdentity = (name: string): Identity => {
  const secretKey = crypto.getRandomValues(new Uint8Array(32));
  const identity: Identity = { name, secretKeyHex: toHex(secretKey) };
  const all = [...listIdentities(), identity];
  localStorage.setItem(IDENTITIES_KEY, JSON.stringify(all));
  return identity;
};

export const getActiveIdentityName = (): string | null => localStorage.getItem(ACTIVE_IDENTITY_KEY);

export const setActiveIdentityName = (name: string): void => localStorage.setItem(ACTIVE_IDENTITY_KEY, name);

/** SHA-256 of UTF-8 text -- used as the (opaque, 32-byte) work hash fed
 * into make_commitment(). The specific hash algorithm here doesn't need to
 * match anything Compact-internal: it's a witness-supplied value the
 * circuit just treats as 32 opaque bytes. */
export const hashWork = async (text: string): Promise<Uint8Array> => {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
};

export const randomSalt = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));
