import { useState, useCallback, type ReactNode } from "react";
import { useWallet } from "@/lib/WalletContext";
import { createUmbraProviders, type UmbraProviders } from "@/lib/providers";
import {
  deployUmbraContract,
  joinUmbraContract,
  setActiveIdentity,
  pureCircuits,
  type DeployedUmbraContract,
} from "@/lib/umbra";
import { identitySecretKey, type Identity } from "@/lib/umbra";
import { initialUmbraPrivateState } from "@umbra/contract";

type ContractHandle = {
  providers: UmbraProviders;
  contract: DeployedUmbraContract;
  contractAddress: string;
};

export function ContractPanel({
  activeIdentity,
  children,
}: {
  activeIdentity: Identity | null;
  children: (handle: ContractHandle) => ReactNode;
}) {
  const { state } = useWallet();
  const [addressInput, setAddressInput] = useState("");
  const [handle, setHandle] = useState<ContractHandle | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connected = state.status === "connected";

  const deploy = useCallback(async () => {
    if (state.status !== "connected" || !activeIdentity) return;
    setBusy("Deploying...");
    setError(null);
    try {
      const providers = createUmbraProviders(state.connection);
      const graderSecretKey = identitySecretKey(activeIdentity);
      const graderKey = pureCircuits.derive_pk(graderSecretKey);
      const assignmentId = crypto.getRandomValues(new Uint8Array(32));
      const contract = await deployUmbraContract(
        providers,
        initialUmbraPrivateState(graderSecretKey),
        assignmentId,
        graderKey,
      );
      const contractAddress = contract.deployTxData.public.contractAddress;
      setAddressInput(contractAddress);
      setHandle({ providers, contract, contractAddress });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [state, activeIdentity]);

  const join = useCallback(async () => {
    if (state.status !== "connected" || !addressInput.trim() || !activeIdentity) return;
    setBusy("Joining...");
    setError(null);
    try {
      const providers = createUmbraProviders(state.connection);
      await setActiveIdentity(providers, identitySecretKey(activeIdentity));
      const contract = await joinUmbraContract(providers, addressInput.trim());
      setHandle({ providers, contract, contractAddress: addressInput.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [state, addressInput, activeIdentity]);

  if (!connected) return null;

  return (
    <section className="panel">
      <h2>Assignment contract</h2>
      {!activeIdentity && <p className="hint">Pick or create an identity above first.</p>}
      <div className="row">
        <input
          type="text"
          placeholder="Contract address (paste one, or deploy a new assignment)"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          disabled={!!busy}
        />
        <button type="button" onClick={join} disabled={!!busy || !addressInput.trim() || !activeIdentity}>
          Join
        </button>
        <button type="button" onClick={deploy} disabled={!!busy || !activeIdentity}>
          Deploy new assignment
        </button>
      </div>
      {busy && <p className="status">{busy}</p>}
      {error && <p className="error">{error}</p>}
      {handle && (
        <>
          <p className="hint">
            Contract: <code>{handle.contractAddress}</code>
          </p>
          {children(handle)}
        </>
      )}
    </section>
  );
}
