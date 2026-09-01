// Adapted from midnightntwrk/example-counter (via midnight-rps-sample-app),
// Copyright (C) 2025 Midnight Foundation, licensed Apache License 2.0.
// Modified for Umbra: i18n stripped to plain English messages, single
// hardcoded network (no network-toggle UI).
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

import type {
  DAppConnectorAPI,
  DAppConnectorWalletAPI,
  ServiceUriConfig,
} from "@midnight-ntwrk/dapp-connector-api";
import { filter, firstValueFrom, interval, map, take, timeout } from "rxjs";
import semver from "semver";
import {
  COMPATIBLE_CONNECTOR_VERSION,
  DETECT_TIMEOUT_MS,
  FALLBACK_URIS,
  POLL_INTERVAL_MS,
} from "@/utils/constants";
import type {
  LaceLegacyConnector,
  LaceV4Connector,
  WalletConnectionResult,
} from "@/utils/types";

export class WalletNotFoundError extends Error {
  constructor() {
    super("No Midnight wallet extension found. Install Lace and refresh.");
    this.name = "WalletNotFoundError";
  }
}

export class VersionMismatchError extends Error {
  constructor(version: string) {
    super(`Installed Lace connector (v${version}) is not compatible with this app.`);
    this.name = "VersionMismatchError";
  }
}

export class NetworkMismatchError extends Error {
  constructor(networkLabel: string) {
    super(`Set Lace's network to "${networkLabel}" and try again.`);
    this.name = "NetworkMismatchError";
  }
}

export class UserRejectedError extends Error {
  constructor() {
    super("Connection request was rejected in the wallet.");
    this.name = "UserRejectedError";
  }
}

export class WalletSyncingError extends Error {
  constructor() {
    super("Wallet is still syncing. Try again in a moment.");
    this.name = "WalletSyncingError";
  }
}

/** Poll for window.midnight.mnLace (or any injected connector exposing an
 * apiVersion) until found or DETECT_TIMEOUT_MS elapses. */
function detectConnectorAPI(): Promise<DAppConnectorAPI> {
  return firstValueFrom(
    interval(POLL_INTERVAL_MS).pipe(
      map(() => {
        const midnight = (globalThis.window as unknown as Record<string, unknown>)
          ?.midnight as Record<string, unknown> | undefined;
        if (!midnight) return null;
        if (midnight.mnLace) return midnight.mnLace as DAppConnectorAPI;
        return (
          (Object.values(midnight).find(
            (v) => typeof (v as Record<string, unknown>)?.apiVersion === "string",
          ) as DAppConnectorAPI | undefined) ?? null
        );
      }),
      filter((api): api is DAppConnectorAPI => api !== null),
      take(1),
      timeout({ first: DETECT_TIMEOUT_MS }),
    ),
  ).catch(() => {
    throw new WalletNotFoundError();
  });
}

/** Connect via Lace v4's connect() API, then read addresses/keys off the
 * resulting wallet API (getShieldedAddresses(), across a couple of shapes
 * different Lace versions have used). */
async function connectViaV4(
  connector: LaceV4Connector,
  networkId: string,
): Promise<WalletConnectionResult> {
  let walletAPI: DAppConnectorWalletAPI | null = null;
  let uris: ServiceUriConfig = FALLBACK_URIS;

  try {
    walletAPI = await connector.connect(networkId);
    const walletRaw = walletAPI as unknown as Record<string, unknown>;
    if (typeof walletRaw.getConfiguration === "function") {
      const cfg = (await (walletRaw.getConfiguration as () => Promise<Record<string, string>>)()) as Record<
        string,
        string
      >;
      uris = {
        indexerUri: cfg.indexerUri ?? cfg.indexerUrl ?? FALLBACK_URIS.indexerUri,
        indexerWsUri: cfg.indexerWsUri ?? cfg.indexerWsUrl ?? FALLBACK_URIS.indexerWsUri,
        proverServerUri: cfg.proverServerUri ?? cfg.proofServerUri ?? FALLBACK_URIS.proverServerUri,
        substrateNodeUri: cfg.substrateNodeUri ?? cfg.nodeUri ?? FALLBACK_URIS.substrateNodeUri,
      };
    }
  } catch (e: unknown) {
    const lowerMsg = String((e as Record<string, unknown>)?.message ?? e).toLowerCase();
    if (lowerMsg.includes("rejected") || lowerMsg.includes("cancel")) throw new UserRejectedError();
    if (lowerMsg.includes("sync")) throw new WalletSyncingError();
    throw new NetworkMismatchError(networkId);
  }

  const walletRaw = walletAPI as unknown as Record<string, unknown>;
  let address = "";
  let coinPublicKey = "";
  let encryptionPublicKey = "";

  if (typeof walletRaw.getShieldedAddresses === "function") {
    try {
      const result = await (walletRaw.getShieldedAddresses as () => Promise<Record<string, unknown>>)();
      const entry = (Array.isArray(result) ? result[0] : result) as Record<string, unknown> | undefined;
      if (entry) {
        address = String(entry.shieldedAddress ?? entry.address ?? "");
        coinPublicKey = String(entry.shieldedCoinPublicKey ?? entry.coinPublicKey ?? "");
        encryptionPublicKey = String(entry.shieldedEncryptionPublicKey ?? entry.encryptionPublicKey ?? "");
      }
    } catch (e: unknown) {
      console.error("[wallet] getShieldedAddresses() failed:", e);
      const lowerMsg = String((e as Record<string, unknown>)?.message ?? e).toLowerCase();
      if (lowerMsg.includes("sync")) throw new WalletSyncingError();
      throw e;
    }
  }

  const state = {
    address,
    coinPublicKey,
    encryptionPublicKey,
    addressLegacy: "",
    coinPublicKeyLegacy: "",
    encryptionPublicKeyLegacy: "",
  };
  return { wallet: walletAPI, uris, state };
}

/**
 * Connect to the Lace wallet extension.
 * Flow: detect window.midnight.mnLace -> check apiVersion via semver ->
 * connect() (v4) or enable() (legacy).
 */
export async function connectToWallet(networkId: string): Promise<WalletConnectionResult> {
  const connectorAPI = await detectConnectorAPI();

  if (!semver.satisfies(connectorAPI.apiVersion, COMPATIBLE_CONNECTOR_VERSION)) {
    throw new VersionMismatchError(connectorAPI.apiVersion);
  }

  const raw = connectorAPI as unknown as Record<string, unknown>;

  if (typeof raw.connect === "function") {
    return connectViaV4(connectorAPI as unknown as LaceV4Connector, networkId);
  }

  if (typeof raw.enable !== "function") {
    throw new Error("Installed wallet does not expose a supported connector API.");
  }

  try {
    const legacyConnector = connectorAPI as unknown as LaceLegacyConnector;
    const enabledAPI = await legacyConnector.enable();
    const enabledRaw = enabledAPI as unknown as Record<string, unknown>;

    if (typeof enabledRaw.connect === "function") {
      return connectViaV4(enabledAPI as unknown as LaceV4Connector, networkId);
    }

    const state = await enabledAPI.state();
    return { wallet: enabledAPI, uris: FALLBACK_URIS, state };
  } catch (e: unknown) {
    const msg = String((e as Record<string, unknown>)?.message ?? e).toLowerCase();
    if (msg.includes("rejected") || msg.includes("cancel")) throw new UserRejectedError();
    throw e;
  }
}
