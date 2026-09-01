import { useState, useCallback } from "react";
import type { UmbraProviders } from "@/lib/providers";
import { setActiveIdentity, gradeUmbra, identitySecretKey } from "@/lib/umbra";
import type { Identity, DeployedUmbraContract } from "@/lib/umbra";

export function GradePanel({
  providers,
  contract,
  activeIdentity,
}: {
  providers: UmbraProviders;
  contract: DeployedUmbraContract;
  activeIdentity: Identity | null;
}) {
  const [id, setId] = useState("");
  const [score, setScore] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const grade = useCallback(async () => {
    if (!activeIdentity || id === "" || score === "") return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      await setActiveIdentity(providers, identitySecretKey(activeIdentity));
      await gradeUmbra(contract, BigInt(id), BigInt(score));
      setResult(`Graded submission #${id} -> ${score}. The submitter's identity is still unknown to you.`);
      setId("");
      setScore("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [providers, contract, activeIdentity, id, score]);

  return (
    <div className="subpanel">
      <h3>Grade</h3>
      <p className="hint">
        Acting as <strong>{activeIdentity?.name ?? "(no identity selected)"}</strong>. Only works if this identity's
        derived key matches the grader key this contract was deployed with.
      </p>
      <div className="row">
        <input type="number" min="0" placeholder="Submission id" value={id} onChange={(e) => setId(e.target.value)} disabled={busy} />
        <input
          type="number"
          min="0"
          max="255"
          placeholder="Score (0-255)"
          value={score}
          onChange={(e) => setScore(e.target.value)}
          disabled={busy}
        />
        <button type="button" onClick={grade} disabled={busy || id === "" || score === "" || !activeIdentity}>
          {busy ? "Grading..." : "Grade"}
        </button>
      </div>
      {result && <p className="status">{result}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
