import { useWallet } from "@/lib/WalletContext";

export function ConnectButton() {
  const { state, connect, disconnect } = useWallet();

  if (state.status === "connected") {
    const addr = state.connection.state.address || state.connection.state.coinPublicKey;
    return (
      <div className="row">
        <span className="hint">
          Connected: <code>{addr.slice(0, 24)}...</code>
        </span>
        <button type="button" onClick={disconnect}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div>
      <button type="button" onClick={connect} disabled={state.status === "connecting"}>
        {state.status === "connecting" ? "Connecting..." : "Connect Lace wallet"}
      </button>
      {state.status === "error" && <p className="error">{state.message}</p>}
    </div>
  );
}
