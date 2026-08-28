// The wallet/provider bootstrap machinery below (WalletContext, signing,
// key derivation, sync/funding helpers) is adapted from
// midnightntwrk/example-counter (via midnight-rps-sample-app),
// Copyright (C) 2025 Midnight Foundation, licensed Apache License 2.0.
// The Umbra-specific section (from "UMBRA" below) is new for this project.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import fs from "node:fs";
import path from "node:path";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import * as ledgerNs from "@midnight-ntwrk/ledger-v8";
import { unshieldedToken } from "@midnight-ntwrk/ledger-v8";
import {
  deployContract,
  findDeployedContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import type {
  FinalizedTxData,
  MidnightProvider,
  WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { toHex } from "@midnight-ntwrk/midnight-js-utils";
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from "@midnight-ntwrk/wallet-sdk-address-format";
import { DustWallet } from "@midnight-ntwrk/wallet-sdk-dust-wallet";
import { WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import {
  generateRandomSeed,
  HDWallet,
  Roles,
} from "@midnight-ntwrk/wallet-sdk-hd";
import { ShieldedWallet } from "@midnight-ntwrk/wallet-sdk-shielded";
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  type UnshieldedKeystore,
  UnshieldedWallet,
} from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import { Buffer } from "node:buffer";
import * as Rx from "rxjs";
import { WebSocket } from "ws";
import { type Config, currentDir } from "./config.js";

// Required for GraphQL subscriptions (wallet sync) to work in Node.js
// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledgerNs.ZswapSecretKeys;
  dustSecretKey: ledgerNs.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

/**
 * Sign all unshielded offers in a transaction's intents, using the correct
 * proof marker for Intent.deserialize. This works around a bug in the wallet
 * SDK where signRecipe hardcodes 'pre-proof', which fails for proven
 * (UnboundTransaction) intents that contain 'proof' data.
 */
const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledgerNs.Signature,
  proofMarker: "proof" | "pre-proof",
): void => {
  if (!tx.intents || tx.intents.size === 0) return;

  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;

    const cloned = ledgerNs.Intent.deserialize<
      ledgerNs.SignatureEnabled,
      ledgerNs.Proofish,
      ledgerNs.PreBinding
    >("signature", proofMarker, "pre-binding", intent.serialize());

    const sigData = cloned.signatureData(segment);
    const signature = signFn(sigData);

    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: ledgerNs.UtxoSpend, i: number) =>
          cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer =
        cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }

    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: ledgerNs.UtxoSpend, i: number) =>
          cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer =
        cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }

    tx.intents.set(segment, cloned);
  }
};

/**
 * Create the unified WalletProvider & MidnightProvider for midnight-js.
 * This bridges the wallet-sdk-facade to the midnight-js contract API by
 * implementing balance, sign, finalize, and submit operations.
 */
export const createWalletAndMidnightProvider = async (
  ctx: WalletContext,
): Promise<WalletProvider & MidnightProvider> => {
  const state = await Rx.firstValueFrom(
    ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)),
  );
  return {
    getCoinPublicKey() {
      return state.shielded.coinPublicKey.toHexString();
    },
    getEncryptionPublicKey() {
      return state.shielded.encryptionPublicKey.toHexString();
    },
    async balanceTx(tx, ttl?) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        {
          shieldedSecretKeys: ctx.shieldedSecretKeys,
          dustSecretKey: ctx.dustSecretKey,
        },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );

      const signFn = (payload: Uint8Array) =>
        ctx.unshieldedKeystore.signData(payload);
      signTransactionIntents(recipe.baseTransaction, signFn, "proof");
      if (recipe.balancingTransaction) {
        signTransactionIntents(
          recipe.balancingTransaction,
          signFn,
          "pre-proof",
        );
      }

      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx(tx) {
      return ctx.wallet.submitTransaction(tx) as any;
    },
  };
};

export const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((state) => state.isSynced),
    ),
  );

export const waitForFunds = (wallet: WalletFacade): Promise<bigint> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.filter((state) => state.isSynced),
      Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n),
      Rx.filter((balance) => balance > 0n),
    ),
  );

const buildShieldedConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: getNetworkId(),
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS, keepAlive: 0 },
  batchSize: 1000,
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, "ws")),
});

const buildUnshieldedConfig = ({ indexer, indexerWS }: Config) => ({
  networkId: getNetworkId(),
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS, keepAlive: 0 },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(),
});

const buildDustConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: getNetworkId(),
  costParameters: {
    additionalFeeOverhead: 300_000_000_000_000n,
    feeBlocksMargin: 5,
  },
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS, keepAlive: 0 },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, "ws")),
});

// ─── Wallet State Cache ────────────────────────────────────────────────────

const walletCacheDir = (networkId: string, seed: string) =>
  path.resolve(currentDir, "..", "wallet-cache", networkId, seed.slice(0, 16));

const loadCachedState = (dir: string, name: string): string | null => {
  const p = path.join(dir, `${name}.json`);
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  } catch {
    return null;
  }
};

const saveCachedState = (dir: string, name: string, data: string): void => {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.json`), data, "utf8");
  } catch {
    // Cache save failures are not fatal.
  }
};

const persistWalletState = async (wallet: WalletFacade, cacheDir: string): Promise<void> => {
  try {
    const [shielded, unshielded, dust] = await Promise.all([
      wallet.shielded.serializeState(),
      wallet.unshielded.serializeState(),
      wallet.dust.serializeState(),
    ]);
    saveCachedState(cacheDir, "shielded", shielded);
    saveCachedState(cacheDir, "unshielded", unshielded);
    saveCachedState(cacheDir, "dust", dust);
  } catch {
    // Cache save failures are not fatal.
  }
};

// ─── Key Derivation ────────────────────────────────────────────────────────

const deriveKeysFromSeed = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, "hex"));
  if (hdWallet.type !== "seedOk") {
    throw new Error("Failed to initialize HDWallet from seed");
  }
  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derivationResult.type !== "keysDerived") {
    throw new Error("Failed to derive keys");
  }
  hdWallet.hdWallet.clear();
  return derivationResult.keys;
};

const formatBalance = (balance: bigint): string => balance.toLocaleString();

export const withStatus = async <T>(message: string, fn: () => Promise<T>): Promise<T> => {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${frames[i++ % frames.length]} ${message}`);
  }, 80);
  try {
    const result = await fn();
    clearInterval(interval);
    process.stdout.write(`\r  ✓ ${message}\n`);
    return result;
  } catch (e) {
    clearInterval(interval);
    process.stdout.write(`\r  ✗ ${message}\n`);
    throw e;
  }
};

/** Register unshielded NIGHT UTXOs for dust generation (required to pay tx fees). */
const registerForDustGeneration = async (
  wallet: WalletFacade,
  unshieldedKeystore: UnshieldedKeystore,
): Promise<void> => {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));

  if (state.dust.availableCoins.length > 0) {
    const dustBal = state.dust.balance(new Date());
    console.log(`  ✓ Dust tokens already available (${formatBalance(dustBal)} DUST)`);
    return;
  }

  const nightUtxos = state.unshielded.availableCoins.filter(
    (coin: any) => coin.meta?.registeredForDustGeneration !== true,
  );
  if (nightUtxos.length === 0) {
    await withStatus("Waiting for dust tokens to generate", () =>
      Rx.firstValueFrom(
        wallet.state().pipe(
          Rx.throttleTime(5_000),
          Rx.filter((s) => s.isSynced),
          Rx.filter((s) => s.dust.balance(new Date()) > 0n),
        ),
      ),
    );
    return;
  }

  await withStatus(`Registering ${nightUtxos.length} NIGHT UTXO(s) for dust generation`, async () => {
    const recipe = await wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      unshieldedKeystore.getPublicKey(),
      (payload) => unshieldedKeystore.signData(payload),
    );
    const finalized = await wallet.finalizeRecipe(recipe);
    await wallet.submitTransaction(finalized);
  });

  await withStatus("Waiting for dust tokens to generate", () =>
    Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(5_000),
        Rx.filter((s) => s.isSynced),
        Rx.filter((s) => s.dust.balance(new Date()) > 0n),
      ),
    ),
  );
};

const printWalletSummary = (state: any, unshieldedKeystore: UnshieldedKeystore) => {
  const networkId = getNetworkId();
  const unshieldedBalance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;

  const coinPubKey = ShieldedCoinPublicKey.fromHexString(state.shielded.coinPublicKey.toHexString());
  const encPubKey = ShieldedEncryptionPublicKey.fromHexString(state.shielded.encryptionPublicKey.toHexString());
  const shieldedAddress = MidnightBech32m.encode(
    networkId,
    new ShieldedAddress(coinPubKey, encPubKey),
  ).toString();

  console.log(`
  Wallet Overview                            Network: ${networkId}
  ------------------------------------------------------------
  Shielded (ZSwap)
  └─ Address: ${shieldedAddress}

  Unshielded
  ├─ Address: ${unshieldedKeystore.getBech32Address()}
  └─ Balance: ${formatBalance(unshieldedBalance)} tNight

  Dust
  └─ Address: ${MidnightBech32m.encode(networkId, state.dust.address).toString()}
  ------------------------------------------------------------`);
};

/**
 * Build (or restore) a wallet from a hex seed, then wait for the wallet to
 * sync and receive funds. Prints the unshielded address immediately so it
 * can be funded (locally, via `midnight-local-dev`'s funding tool) while
 * the sync is still in progress.
 */
export const buildWalletAndWaitForFunds = async (config: Config, seed: string): Promise<WalletContext> => {
  console.log("");
  const networkId = getNetworkId();
  const cacheDir = walletCacheDir(networkId, seed);

  const { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore } = await withStatus(
    "Building wallet",
    async () => {
      const keys = deriveKeysFromSeed(seed);
      const shieldedSecretKeys = ledgerNs.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
      const dustSecretKey = ledgerNs.DustSecretKey.fromSeed(keys[Roles.Dust]);
      const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], networkId);

      const walletConfig = {
        ...buildShieldedConfig(config),
        ...buildUnshieldedConfig(config),
        ...buildDustConfig(config),
      };

      const shieldedCache = loadCachedState(cacheDir, "shielded");
      const unshieldedCache = loadCachedState(cacheDir, "unshielded");
      const dustCache = loadCachedState(cacheDir, "dust");
      const fromCache = shieldedCache && unshieldedCache && dustCache;

      const wallet = await WalletFacade.init({
        configuration: walletConfig,
        shielded: (cfg) =>
          fromCache
            ? ShieldedWallet(cfg).restore(shieldedCache)
            : ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
        unshielded: (cfg) =>
          fromCache
            ? UnshieldedWallet(cfg).restore(unshieldedCache)
            : UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
        dust: (cfg) =>
          fromCache
            ? DustWallet(cfg).restore(dustCache)
            : DustWallet(cfg).startWithSecretKey(
                dustSecretKey,
                ledgerNs.LedgerParameters.initialParameters().dust,
              ),
      });
      await wallet.start(shieldedSecretKeys, dustSecretKey);

      return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
    },
  );

  console.log(`
  ------------------------------------------------------------
  Unshielded Address (fund this, e.g. via midnight-local-dev):
  ${unshieldedKeystore.getBech32Address()}
  ------------------------------------------------------------
`);

  const syncedState = await withStatus("Syncing with network", () => waitForSync(wallet));
  await persistWalletState(wallet, cacheDir);
  printWalletSummary(syncedState, unshieldedKeystore);

  const balance = syncedState.unshielded.balances[unshieldedToken().raw] ?? 0n;
  if (balance === 0n) {
    const fundedBalance = await withStatus("Waiting for incoming tokens", () => waitForFunds(wallet));
    console.log(`    Balance: ${formatBalance(fundedBalance)} tNight\n`);
  }

  await registerForDustGeneration(wallet, unshieldedKeystore);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

export const buildFreshWallet = async (config: Config): Promise<WalletContext> => {
  const seed = toHex(Buffer.from(generateRandomSeed()));
  console.log(`
  ------------------------------------------------------------
  New Wallet Seed -- save this before continuing
  ------------------------------------------------------------
  ${seed}
  ------------------------------------------------------------
`);
  return await buildWalletAndWaitForFunds(config, seed);
};

// ============================================================================
// UMBRA -- contract-specific deployment and circuit calls
// ============================================================================

import {
  Contract,
  type Ledger,
  ledger,
  type Witnesses,
  pureCircuits,
  umbraWitnesses,
  UmbraPrivateStateId,
  type UmbraPrivateState,
  initialUmbraPrivateState,
} from "@umbra/contract";

export { pureCircuits };

const umbraContractConfig = {
  privateStateStoreName: "umbra-private-state",
  zkConfigPath: path.resolve(currentDir, "..", "..", "contract", "src", "managed", "umbra"),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CC = CompiledContract as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const umbraCompiledContract = CC.make("umbra", Contract).pipe(
  CC.withWitnesses(umbraWitnesses),
  CC.withCompiledFileAssets(umbraContractConfig.zkConfigPath),
);

export type UmbraProviders = Awaited<ReturnType<typeof configureUmbraProviders>>;
export type DeployedUmbraContract = Awaited<ReturnType<typeof deployUmbra>>;

/** Configure midnight-js providers for Umbra contract interaction. */
export const configureUmbraProviders = async (ctx: WalletContext, config: Config) => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const accountId = walletAndMidnightProvider.getCoinPublicKey();
  const storagePassword = `${Buffer.from(accountId, "hex").toString("base64")}!`;
  const zkConfigProvider = new NodeZkConfigProvider(umbraContractConfig.zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<typeof UmbraPrivateStateId>({
      privateStateStoreName: umbraContractConfig.privateStateStoreName,
      accountId,
      privateStoragePasswordProvider: () => storagePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};

/**
 * Set which logical identity (secret key, and optionally work + salt) is
 * "active" for the next circuit call. One real wallet/network identity can
 * play multiple Umbra roles (grader, submitter A, submitter B, ...) across
 * calls -- the contract only ever sees the derived key from whichever
 * secretKey is active when a circuit runs, never the underlying wallet.
 */
export const setUmbraIdentity = async (
  providers: UmbraProviders,
  secretKey: Uint8Array,
  work?: { workHash: Uint8Array; salt: Uint8Array },
): Promise<void> => {
  const current =
    (await providers.privateStateProvider.get(UmbraPrivateStateId)) ??
    initialUmbraPrivateState(secretKey);
  const next: UmbraPrivateState = {
    secretKey,
    workHash: work?.workHash ?? current.workHash,
    salt: work?.salt ?? current.salt,
  };
  await providers.privateStateProvider.set(UmbraPrivateStateId, next);
};

export const deployUmbra = async (
  providers: UmbraProviders,
  initialPrivateState: UmbraPrivateState,
  assignmentId: Uint8Array,
  graderKey: Uint8Array,
) => {
  console.log("Deploying Umbra contract...");
  const contract = await deployContract(providers, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    compiledContract: umbraCompiledContract as any,
    privateStateId: UmbraPrivateStateId,
    initialPrivateState,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: [assignmentId, graderKey] as any,
  });
  console.log(`Deployed Umbra contract at: ${contract.deployTxData.public.contractAddress}`);
  return contract;
};

export const joinUmbra = async (providers: UmbraProviders, contractAddress: string) => {
  console.log(`Joining Umbra contract at: ${contractAddress}`);
  const contract = await findDeployedContract(providers, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contractAddress: contractAddress as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    compiledContract: umbraCompiledContract as any,
    privateStateId: UmbraPrivateStateId,
    initialPrivateState: initialUmbraPrivateState(),
  });
  return contract;
};

export const submitUmbra = async (contract: DeployedUmbraContract): Promise<FinalizedTxData> => {
  console.log("Submitting...");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalizedTxData = await (contract as any).callTx.submit();
  console.log(`Submit TX ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public as FinalizedTxData;
};

export const gradeUmbra = async (
  contract: DeployedUmbraContract,
  id: bigint,
  score: bigint,
): Promise<FinalizedTxData> => {
  console.log(`Grading submission ${id} -> ${score}...`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalizedTxData = await (contract as any).callTx.grade(id, score);
  console.log(`Grade TX ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public as FinalizedTxData;
};

export const revealUmbra = async (
  contract: DeployedUmbraContract,
  id: bigint,
): Promise<FinalizedTxData> => {
  console.log(`Revealing submission ${id}...`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalizedTxData = await (contract as any).callTx.reveal(id);
  console.log(`Reveal TX ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public as FinalizedTxData;
};

export const getUmbraState = async (
  providers: UmbraProviders,
  contractAddress: string,
): Promise<Ledger | null> => {
  const state = await providers.publicDataProvider
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .queryContractState(contractAddress as any)
    .then((contractState) => (contractState != null ? ledger(contractState.data as any) : null));
  return state;
};
