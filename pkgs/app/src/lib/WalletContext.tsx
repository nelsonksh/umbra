import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { connectToWallet } from "./wallet";
import { NETWORK_ID } from "@/utils/constants";
import type { WalletState } from "@/utils/types";

type WalletContextValue = {
  state: WalletState;
  connect: () => Promise<void>;
  disconnect: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({ status: "disconnected" });

  const connect = useCallback(async () => {
    setState({ status: "connecting" });
    try {
      // Required before any wallet/contract operation -- midnight-js-network-id
      // has no default and throws "Network ID has not been configured" if this
      // is skipped. Set here (not at module load) since it's the earliest point
      // that's guaranteed to run before providers.ts/umbra.ts touch the SDK.
      setNetworkId(NETWORK_ID);
      const connection = await connectToWallet(NETWORK_ID);
      setState({ status: "connected", connection });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const disconnect = useCallback(() => setState({ status: "disconnected" }), []);

  return <WalletContext.Provider value={{ state, connect, disconnect }}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
