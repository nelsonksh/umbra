// Adapted from midnightntwrk/example-counter (via midnight-rps-sample-app),
// Copyright (C) 2025 Midnight Foundation, licensed Apache License 2.0.
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

import {
  type CoinPublicKey,
  type EncPublicKey,
  type FinalizedTransaction,
  Transaction as LedgerTransaction,
  type TransactionId,
} from "@midnight-ntwrk/ledger-v8";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import type { MidnightProvider, UnboundTransaction, WalletProvider } from "@midnight-ntwrk/midnight-js-types";
import { fromHex, toHex } from "@midnight-ntwrk/midnight-js-utils";
import { UmbraPrivateStateId } from "@umbra/contract";
import type { WalletConnectionResult } from "@/utils/types";

export function createUmbraProviders(connection: WalletConnectionResult) {
  const { wallet, uris, state } = connection;
  const walletRaw = wallet as unknown as Record<string, unknown>;

  const walletProvider: WalletProvider = {
    getCoinPublicKey(): CoinPublicKey {
      return state.coinPublicKey;
    },
    getEncryptionPublicKey(): EncPublicKey {
      return state.encryptionPublicKey;
    },
    async balanceTx(tx: UnboundTransaction, _ttl?: Date): Promise<FinalizedTransaction> {
      if (typeof walletRaw.balanceUnsealedTransaction !== "function") {
        throw new Error("Lace wallet does not support balanceUnsealedTransaction. Please update Lace.");
      }
      const hexTx = toHex(tx.serialize());
      const result = await (walletRaw.balanceUnsealedTransaction as (tx: string) => Promise<{ tx: string }>)(hexTx);
      return LedgerTransaction.deserialize(
        "signature",
        "proof",
        "binding",
        new Uint8Array(fromHex(result.tx)),
      ) as FinalizedTransaction;
    },
  };

  const midnightProvider: MidnightProvider = {
    async submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
      await (walletRaw.submitTransaction as (tx: string) => Promise<void>)(toHex(tx.serialize()));
      return tx.identifiers()[0];
    },
  };

  const zkConfigProvider = new FetchZkConfigProvider(`${window.location.origin}/managed/umbra`, fetch.bind(window));

  // Route proof-server requests through the Vite dev-server proxy (see
  // vite.config.ts) rather than fetching 127.0.0.1 directly -- Lace's
  // service worker blocks page-level fetches to localhost.
  const proverServerUri = `${window.location.origin}/proof-server`;

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStoragePasswordProvider: () => "umbra-app-private-state",
      accountId: state.coinPublicKey,
      privateStateStoreName: UmbraPrivateStateId,
    }),
    publicDataProvider: indexerPublicDataProvider(uris.indexerUri, uris.indexerWsUri),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(proverServerUri, zkConfigProvider),
    walletProvider,
    midnightProvider,
  };
}

export type UmbraProviders = ReturnType<typeof createUmbraProviders>;
