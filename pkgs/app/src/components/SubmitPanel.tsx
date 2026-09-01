import { useState, useCallback } from "react";
import type { UmbraProviders } from "@/lib/providers";
import { setActiveIdentity, submitUmbra, getUmbraLedgerState, hashWork, randomSalt, identitySecretKey } from "@/lib/umbra";
import type { Identity } from "@/lib/umbra";
import { toHex } from "@midnight-ntwrk/midnight-js-utils";
import type { DeployedUmbraContract } from "@/lib/umbra";

const SUBMISSIONS_KEY = "umbra:submissions";

type SavedSubmission = { contractAddress: string; identityName: string; id: string; workHashHex: string; saltHex: string; text: string };

function saveSubmission(entry: SavedSubmission) {
  const all: SavedSubmission[] = JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) ?? "[]");
  all.push(entry);
  localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(all));
}

export function SubmitPanel({
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
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!activeIdentity || !text.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const before = await getUmbraLedgerState(providers, contractAddress);
      const nextId = before?.submission_count ?? 0n;

      const workHash = await hashWork(text);
      const salt = randomSalt();
      await setActiveIdentity(providers, identitySecretKey(activeIdentity), { workHash, salt });
      await submitUmbra(contract);

      saveSubmission({
        contractAddress,
        identityName: activeIdentity.name,
        id: nextId.toString(),
        workHashHex: toHex(workHash),
        saltHex: toHex(salt),
        text,
      });
      setResult(`Submitted as submission #${nextId}. Save that id -- you'll need it to reveal later.`);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [providers, contract, contractAddress, activeIdentity, text]);

  return (
    <div className="subpanel">
      <h3>Submit</h3>
      <p className="hint">
        Acting as <strong>{activeIdentity?.name ?? "(no identity selected)"}</strong>. Only a commitment to this text
        goes on-chain -- the text itself stays local until you reveal.
      </p>
      <textarea
        placeholder="Paste or type your work here..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        disabled={busy}
      />
      <button type="button" onClick={submit} disabled={busy || !text.trim() || !activeIdentity}>
        {busy ? "Submitting..." : "Submit"}
      </button>
      {result && <p className="status">{result}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
