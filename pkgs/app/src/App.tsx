import { useState } from "react";
import { ConnectButton } from "@/components/ConnectButton";
import { IdentityPicker } from "@/components/IdentityPicker";
import { ContractPanel } from "@/components/ContractPanel";
import { SubmitPanel } from "@/components/SubmitPanel";
import { GradePanel } from "@/components/GradePanel";
import { RevealPanel } from "@/components/RevealPanel";
import { LedgerPanel } from "@/components/LedgerPanel";
import type { Identity } from "@/lib/umbra";

export default function App() {
  const [activeIdentity, setActiveIdentity] = useState<Identity | null>(null);

  return (
    <main>
      <header>
        <h1>Umbra</h1>
        <p className="tagline">Grade the work. Not the name.</p>
      </header>

      <section className="panel">
        <h2>Wallet</h2>
        <ConnectButton />
      </section>

      <IdentityPicker onChange={setActiveIdentity} />

      <ContractPanel activeIdentity={activeIdentity}>
        {({ providers, contract, contractAddress }) => (
          <div className="grid">
            <SubmitPanel providers={providers} contract={contract} contractAddress={contractAddress} activeIdentity={activeIdentity} />
            <GradePanel providers={providers} contract={contract} activeIdentity={activeIdentity} />
            <RevealPanel providers={providers} contract={contract} contractAddress={contractAddress} activeIdentity={activeIdentity} />
            <LedgerPanel providers={providers} contractAddress={contractAddress} />
          </div>
        )}
      </ContractPanel>
    </main>
  );
}
