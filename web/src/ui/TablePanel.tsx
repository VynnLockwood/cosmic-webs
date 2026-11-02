import { useEffect, useState } from "react";
import { api as realApi, type Api } from "../api/client";
import { motionActions } from "../scene/camera/motion";
import { useStore } from "../store/useStore";
import type { RowsPage } from "../types";

const PAGE = 50;

export function TablePanel({ api = realApi }: { api?: Pick<Api, "getRows"> }) {
  const name = useStore((s) => s.panelTable);
  const graph = useStore((s) => s.graph);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<RowsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setOffset(0), [name]);
  useEffect(() => {
    if (!name) return;
    let alive = true;
    setError(null);
    api.getRows(name, PAGE, offset).then((p) => alive && setPage(p)).catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [name, offset, api]);

  const table = graph?.tables.find((t) => t.name === name);
  const fkOf = (col: string) => graph?.fks.find((f) => f.from.table === name && f.from.columns.includes(col));
  return (
    <aside className={`panel glass${table ? " open" : ""}`} aria-label="Table details" aria-hidden={!table}>
      {table && (
        <>
          <button className="btn ghost close" onClick={() => motionActions.back()} aria-label="Close table panel">Esc</button>
          <h2 className="mono">{table.name}</h2>
          <h3>Columns</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {table.columns.map((c) => {
              const fk = fkOf(c.name);
              return (
                <li key={c.name} className="mono" style={{ padding: "2px 0" }}>
                  {c.name} <span style={{ color: "var(--ui-muted)" }}>{c.type}{c.nullable ? "" : " not null"}</span>
                  {c.pk && <span className="badge pk">PK</span>}
                  {fk && <span className="badge fk">FK → {fk.to.table.replace(/^public\./, "")}</span>}
                </li>
              );
            })}
          </ul>
          <h3>Rows</h3>
          {error && <div className="err">{error}</div>}
          {page && (
            <>
              <div style={{ overflow: "auto" }}>
                <table className="grid">
                  <thead><tr>{page.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>{page.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v === null ? <i style={{ color: "var(--ui-muted)" }}>null</i> : String(v)}</td>)}</tr>)}</tbody>
                </table>
              </div>
              <div className="row">
                <button className="btn ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Prev</button>
                <span style={{ color: "var(--ui-muted)" }}>{offset + 1}–{offset + page.rows.length} of ~{page.total_estimate}</span>
                <button className="btn ghost" disabled={page.rows.length < PAGE} onClick={() => setOffset(offset + PAGE)}>Next</button>
              </div>
            </>
          )}
        </>
      )}
    </aside>
  );
}
