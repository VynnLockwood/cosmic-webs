import { useState } from "react";
import { applyCase, deleteCase, renameCase, saveCurrentCase, setAutoOpen } from "../store/caseActions";
import { summaryOf } from "../store/useCases";
import { useStore } from "../store/useStore";

/** Settings → Use cases: save what you want to see, with your settings, and bring it back with one click. */
export function UseCasesTab() {
  const book = useStore((s) => s.cases);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = () => {
    setErr(null);
    const replaced = book.items.some((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    const c = saveCurrentCase(name);
    if (!c) return setErr("Give the use case a name first.");
    setNote(`${replaced ? "Replaced" : "Saved"} “${c.name}”.`);
    setName("");
  };
  const apply = (id: string) => {
    setErr(null);
    const r = applyCase(id, { openSearch: true });
    setNote(r && r.missing.length ? `Applied. ${r.missing.length} column${r.missing.length === 1 ? " is" : "s are"} not in this database and left out: ${r.missing.join(", ")}.` : "Applied. The Search panel shows it.");
  };
  const rename = () => {
    if (!editing) return;
    if (!renameCase(editing.id, editing.name)) return setErr("That name is empty or already used.");
    setErr(null);
    setEditing(null);
  };

  return (
    <>
      <h3>Use cases</h3>
      <p style={{ margin: "0 0 6px", color: "var(--ui-muted)" }}>
        Remember what you want to see: the wish in Expected result, the search builder, your joins, the AI's SQL, and your settings (look, SQL mode, panel widths, quality).
        Saved in this browser only (localStorage). Your OpenRouter key is never copied into a use case.
      </p>
      <div className="row">
        <label htmlFor="case-name">Name</label>
        <input id="case-name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="e.g. Paid per customer" autoComplete="off" />
      </div>
      <button className="btn" onClick={save}>Save current as use case</button>
      <label className="row" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={book.autoOpen} onChange={(e) => setAutoOpen(e.target.checked)} /> <span>Open the last used one when the app starts</span>
      </label>
      {err && <div className="err" role="alert">{err}</div>}
      {note && <div role="status" style={{ color: "var(--ui-muted)", margin: "4px 0" }}>{note}</div>}
      {book.items.length === 0 ? (
        <p style={{ color: "var(--ui-muted)" }}>Nothing saved yet. Set up a search, then save it here.</p>
      ) : (
        <ul aria-label="Saved use cases" style={{ listStyle: "none", padding: 0, margin: "8px 0" }}>
          {book.items.map((c) => (
            <li key={c.id} className="glass" style={{ padding: 8, margin: "0 0 6px", boxShadow: "none" }}>
              {editing?.id === c.id ? (
                <div className="row">
                  <input aria-label={`New name for ${c.name}`} value={editing.name} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && rename()} />
                  <button className="btn" onClick={rename}>Save name</button>
                  <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <div><b>{c.name}</b>{book.last === c.id && <span className="badge" style={{ marginLeft: 6 }}>last used</span>}</div>
                  <div style={{ color: "var(--ui-muted)", fontSize: 12 }}>{summaryOf(c)} · {new Date(c.savedAt).toLocaleString()}</div>
                  {c.goal.trim() && <div style={{ fontSize: 12, margin: "2px 0" }}>“{c.goal.length > 90 ? c.goal.slice(0, 90) + "…" : c.goal}”</div>}
                  <div className="row">
                    <button className="btn" aria-label={`Apply ${c.name}`} onClick={() => apply(c.id)}>Apply</button>
                    <button className="btn ghost" aria-label={`Rename ${c.name}`} onClick={() => setEditing({ id: c.id, name: c.name })}>Rename</button>
                    <button className="btn ghost" aria-label={`Delete ${c.name}`} onClick={() => deleteCase(c.id)}>Delete</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
