import { useState, useCallback, useMemo } from "react";
import type { UmbraProviders } from "@/lib/providers";
import { setActiveIdentity, revealUmbra, identitySecretKey } from "@/lib/umbra";
import type { Identity, DeployedUmbraContract } from "@/lib/umbra";

const SUBMISSIONS_KEY = "umbra:submissions";

type SavedSubmission = { contractAddress: string; identityName: string; id: string; workHashHex: string; saltHex: string; text: string };

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16)));
}

export function RevealPanel({
  providers,
  contract,
  contractAddress,
  activeIdentity,
}: {
  providers: UmbraProviders;
  contract: DeployedUmbraContract;
  contractAddress: string;
  activeIdentity: Identity | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const savedForThisIdentity = useMemo((): SavedSubmission[] => {
    if (!activeIdentity) return [];
    const all: SavedSubmission[] = JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) ?? "[]");
    return all.filter((s) => s.contractAddress === contractAddress && s.identityName === activeIdentity.name);
  }, [contractAddress, activeIdentity]);

  const reveal = useCallback(
    async (submission: SavedSubmission) => {
      if (!activeIdentity) return;
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        await setActiveIdentity(providers, identitySecretKey(activeIdentity), {
          workHash: hexToBytes(submission.workHashHex),
          salt: hexToBytes(submission.saltHex),
        });
        await revealUmbra(contract, BigInt(submission.id));
        setResult(`Revealed and claimed submission #${submission.id}.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [providers, contract, activeIdentity],
  );

  return (
    <div className="subpanel">
      <h3>Reveal &amp; claim</h3>
      <p className="hint">
        Acting as <strong>{activeIdentity?.name ?? "(no identity selected)"}</strong>. Only works once a submission has
        been graded.
      </p>
      {savedForThisIdentity.length === 0 && <p className="hint">No submissions saved locally for this identity/contract.</p>}
      {savedForThisIdentity.map((s) => (
        <div className="row" key={s.id}>
          <span>
            #{s.id} — "{s.text.slice(0, 40)}
            {s.text.length > 40 ? "..." : ""}"
          </span>
          <button type="button" onClick={() => reveal(s)} disabled={busy}>
            {busy ? "Revealing..." : "Reveal"}
          </button>
        </div>
      ))}
      {result && <p className="status">{result}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
