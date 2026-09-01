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
