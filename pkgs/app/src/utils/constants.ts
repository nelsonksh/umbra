import type { ServiceUriConfig } from "@midnight-ntwrk/dapp-connector-api";

/** Compatible Lace Connector API version range. */
export const COMPATIBLE_CONNECTOR_VERSION = ">=1.0.0";

/** Max time to wait for window.midnight.mnLace to appear (ms). */
export const DETECT_TIMEOUT_MS = 10_000;

/** Poll interval while detecting the wallet extension (ms). */
export const POLL_INTERVAL_MS = 100;

export const APP_NAME = "Umbra";

/** This dApp targets the local Midnight network by default (see the repo
 * root README for how to bring it up). networkId "undeployed" matches
 * Lace's own "Undeployed" network setting. */
export const NETWORK_ID = "undeployed";

/** Fallback service URIs, used if the connected wallet doesn't expose
 * getConfiguration(). Matches midnight-local-dev's standalone network. */
export const FALLBACK_URIS: ServiceUriConfig = {
  indexerUri: "http://127.0.0.1:8088/api/v4/graphql",
  indexerWsUri: "ws://127.0.0.1:8088/api/v4/graphql/ws",
  proverServerUri: "http://127.0.0.1:6300",
  substrateNodeUri: "http://127.0.0.1:9944",
};
