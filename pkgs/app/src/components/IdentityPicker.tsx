import { useState, useEffect, useCallback } from "react";
import { listIdentities, createIdentity, getActiveIdentityName, setActiveIdentityName } from "@/lib/umbra";
import type { Identity } from "@/lib/umbra";

export function IdentityPicker({ onChange }: { onChange: (identity: Identity | null) => void }) {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    const all = listIdentities();
    setIdentities(all);
    const stored = getActiveIdentityName();
    const initial = all.find((i) => i.name === stored) ?? all[0] ?? null;
    setActiveName(initial?.name ?? null);
    onChange(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = useCallback(
    (name: string) => {
      setActiveName(name);
      setActiveIdentityName(name);
      onChange(identities.find((i) => i.name === name) ?? null);
    },
    [identities, onChange],
  );

  const create = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    const identity = createIdentity(name);
    setIdentities((prev) => [...prev, identity]);
    setNewName("");
    // Select the identity we just created directly, rather than going
    // through select()'s lookup -- select() closes over `identities` from
    // this render, which doesn't include `identity` yet (setIdentities
    // above won't be visible until the next render), so that lookup would
    // silently miss and call onChange(null).
    setActiveName(identity.name);
    setActiveIdentityName(identity.name);
    onChange(identity);
  }, [newName, onChange]);

  return (
    <section className="panel">
      <h2>Identity</h2>
      <p className="hint">
        A named secret key, kept only in this browser. Umbra never learns which one is "really" you -- only that
        whoever calls a circuit holds the matching key. Switch identities to act as a different submitter or the
        grader.
      </p>
      <div className="row">
        <select value={activeName ?? ""} onChange={(e) => select(e.target.value)}>
          {identities.length === 0 && <option value="">(none yet)</option>}
          {identities.map((i) => (
            <option key={i.name} value={i.name}>
              {i.name}
            </option>
          ))}
        </select>
        <input type="text" placeholder="New identity name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="button" onClick={create} disabled={!newName.trim()}>
          Create
        </button>
      </div>
    </section>
  );
}
