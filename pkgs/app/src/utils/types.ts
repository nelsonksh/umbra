import type {
  DAppConnectorWalletAPI,
  DAppConnectorWalletState,
  ServiceUriConfig,
} from "@midnight-ntwrk/dapp-connector-api";

/** Lace v4: connector exposes connect() directly. */
export type LaceV4Connector = {
  connect: (networkId: string) => Promise<DAppConnectorWalletAPI>;
  getConfiguration?: () => Promise<Record<string, string>>;
};

/** Legacy Lace: enable() returns the API. */
export type LaceLegacyConnector = {
  enable: () => Promise<DAppConnectorWalletAPI>;
};

export type WalletConnectionResult = {
  wallet: DAppConnectorWalletAPI;
  uris: ServiceUriConfig;
  state: DAppConnectorWalletState;
};

export type WalletState =
  | { status: "disconnected" }
  | { status: "connecting" }
  | { status: "connected"; connection: WalletConnectionResult }
  | { status: "error"; message: string };
