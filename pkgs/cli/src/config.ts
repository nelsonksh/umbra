// Adapted from midnightntwrk/example-counter (via midnight-rps-sample-app),
// Copyright (C) 2025 Midnight Foundation, licensed Apache License 2.0.
// Modified for Umbra: standalone (local-dev) and Preprod configs, endpoints
// per https://docs.midnight.network/guides/networks-and-environments.
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

import path from "node:path";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";

export const currentDir = path.resolve(new URL(import.meta.url).pathname, "..");

export interface Config {
  readonly logDir: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

const logDirFor = (network: string) =>
  path.resolve(currentDir, "..", "logs", network, `${new Date().toISOString()}.log`);

/** Targets the local Docker network from `midnight-local-dev` (see repo root README). */
export class StandaloneConfig implements Config {
  logDir = logDirFor("standalone");
  indexer = "http://127.0.0.1:8088/api/v4/graphql";
  indexerWS = "ws://127.0.0.1:8088/api/v4/graphql/ws";
  node = "http://127.0.0.1:9944";
  proofServer = "http://127.0.0.1:6300";
  constructor() {
    setNetworkId("undeployed");
  }
}

/**
 * Midnight's public Preview testnet -- fewer historical events than Preprod,
 * so a from-scratch wallet sync is meaningfully cheaper. Has its own
 * explorer too (preview.midnightexplorer.com). Prefer this over Preprod for
 * a quick real-network/explorer-visible run.
 * Get funded via the faucet: https://faucet.preview.midnight.network/
 */
export class PreviewConfig implements Config {
  logDir = logDirFor("preview");
  indexer = "https://indexer.preview.midnight.network/api/v4/graphql";
  indexerWS = "wss://indexer.preview.midnight.network/api/v4/graphql/ws";
  node = "https://rpc.preview.midnight.network";
  proofServer = "http://127.0.0.1:6300";
  constructor() {
    setNetworkId("preview");
  }
}

/**
 * Midnight's public Preprod testnet. Node/indexer are hosted remotely; the
 * proof server still runs locally (same image used by the standalone
 * network works fine -- it's a stateless proving service, not chain-specific).
 * Get funded via the faucet: https://faucet.preprod.midnight.network/
 * Much larger chain history than Preview (~2.3M vs ~600K blocks as of
 * writing) -- a from-scratch wallet sync here can genuinely take 25+
 * minutes and several GB of heap. Prefer PreviewConfig unless Preprod is
 * specifically required.
 */
export class PreprodConfig implements Config {
  logDir = logDirFor("preprod");
  indexer = "https://indexer.preprod.midnight.network/api/v4/graphql";
  indexerWS = "wss://indexer.preprod.midnight.network/api/v4/graphql/ws";
  node = "https://rpc.preprod.midnight.network";
  proofServer = "http://127.0.0.1:6300";
  constructor() {
    setNetworkId("preprod");
  }
}
