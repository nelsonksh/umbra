import { useState, useEffect, useCallback } from "react";
import type { UmbraProviders } from "@/lib/providers";
import { getUmbraLedgerState } from "@/lib/umbra";
import type { Ledger } from "@umbra/contract";

export function LedgerPanel({ providers, contractAddress }: { providers: UmbraProviders; contractAddress: string }) {
  const [ledgerState, setLedgerState] = useState<Ledger | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const state = await getUmbraLedgerState(providers, contractAddress);
      setLedgerState(state);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [providers, contractAddress]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const ids = ledgerState ? [...ledgerState.commitments].map(([id]) => id).sort((a, b) => (a < b ? -1 : 1)) : [];

  return (
    <div className="subpanel">
      <h3>Ledger state</h3>
      <button type="button" onClick={refresh}>
        Refresh
      </button>
      {error && <p className="error">{error}</p>}
      {ledgerState && (
        <>
          <p className="hint">{ledgerState.submission_count.toString()} submission(s) so far. No identity information appears anywhere below.</p>
          {ids.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>id</th>
                  <th>graded</th>
                  <th>score</th>
                  <th>revealed</th>
                </tr>
              </thead>
              <tbody>
                {ids.map((id) => {
                  const graded = ledgerState.graded_ids.member(id);
                  const revealed = ledgerState.revealed_ids.member(id);
                  const score = graded ? ledgerState.grades.lookup(id).toString() : "-";
                  return (
                    <tr key={id.toString()}>
                      <td>{id.toString()}</td>
                      <td>{graded ? "yes" : "no"}</td>
                      <td>{score}</td>
                      <td>{revealed ? "yes" : "no"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
