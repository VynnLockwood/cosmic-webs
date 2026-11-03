import { useEffect, useMemo, useState } from "react";
import { applyStructure, deltaPct, loadStructure, refillData } from "../../store/structureActions";
import { useStore } from "../../store/useStore";
import type { StructureOp } from "../../types";
import { Fold } from "../Fold";
import { ExportSection } from "./ExportSection";
import { SuggestedLinks } from "./SuggestedLinks";

const short = (t: string) => t.replace(/^public\./, "");
const TYPES = ["int4", "int8", "text", "varchar", "bool", "numeric", "timestamptz", "date", "uuid", "jsonb", "float8"];
const SIZES = [1_000, 10_000, 50_000, 100_000];

type Run = (ops: StructureOp[]) => Promise<boolean>;

function useTables() {
  const graph = useStore((s) => s.graph);
  return useMemo(() => graph?.tables ?? [], [graph]);
}

function IndexSection({ run, busy }: { run: Run; busy: boolean }) {
  const tables = useTables();
  const indexes = useStore((s) => s.indexes);
  const [table, setTable] = useState("");
  const [cols, setCols] = useState<string[]>([]);
  const [unique, setUnique] = useState(false);
  const t = tables.find((x) => x.name === table) ?? tables[0];
  const toggle = (c: string) => setCols(cols.includes(c) ? cols.filter((x) => x !== c) : [...cols, c]);
  return (
    <section aria-label="Indexes">
      <div>
        {indexes.map((i) => (
          <span key={`${i.schema}.${i.name}`} className="chip mono" title={i.definition}>
            {short(i.table)}({i.columns.join(", ")}){i.unique ? " unique" : ""}{i.primary ? " PK" : ""}
            {!i.primary && <button aria-label={`Drop index ${i.name}`} disabled={busy} onClick={() => run([{ kind: "drop_index", schema: i.schema, name: i.name }])}>drop</button>}
          </span>
        ))}
        {indexes.length === 0 && <span style={{ color: "var(--ui-muted)" }}>No indexes yet.</span>}
      </div>
      <div className="row">
        <label htmlFor="ix-table">Table</label>
        <select id="ix-table" value={t?.name ?? ""} onChange={(e) => { setTable(e.target.value); setCols([]); }}>
          {tables.map((x) => <option key={x.name} value={x.name}>{short(x.name)}</option>)}
        </select>
      </div>
      <div role="group" aria-label="Index columns" style={{ maxHeight: 110, overflow: "auto" }}>
        {t?.columns.map((c) => (
          <label key={c.name} className="mono" style={{ display: "flex", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={cols.includes(c.name)} onChange={() => toggle(c.name)} aria-label={`index column ${c.name}`} /> {c.name} <span style={{ color: "var(--ui-muted)" }}>{c.type}</span>
          </label>
        ))}
      </div>
      <div className="row">
        <label style={{ flex: "0 0 auto", cursor: "pointer" }}><input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} /> unique</label>
        <button className="btn" disabled={busy || !t || cols.length === 0} onClick={() => run([{ kind: "create_index", table: t!.name, columns: cols, unique }]).then((ok) => ok && setCols([]))}>Add index</button>
      </div>
    </section>
  );
}

function FkSection({ run, busy }: { run: Run; busy: boolean }) {
  const tables = useTables();
  const fks = useStore((s) => s.graph?.fks ?? []);
  const [from, setFrom] = useState("");
  const [fromCol, setFromCol] = useState("");
  const [to, setTo] = useState("");
  const [toCol, setToCol] = useState("");
  const a = tables.find((x) => x.name === from) ?? tables[0];
  const b = tables.find((x) => x.name === to) ?? tables[0];
  const ac = a?.columns.find((c) => c.name === fromCol) ?? a?.columns[0];
  const bc = b?.columns.find((c) => c.name === toCol) ?? b?.columns.find((c) => c.pk) ?? b?.columns[0];
  return (
    <section aria-label="Foreign keys">
      <div>
        {fks.map((f) => (
          <span key={f.id} className="chip mono">
            {short(f.from.table)}({f.from.columns.join(",")}) → {short(f.to.table)}
            <button aria-label={`Drop foreign key ${f.id}`} disabled={busy} onClick={() => run([{ kind: "drop_fk", table: f.from.table, name: f.id }])}>drop</button>
          </span>
        ))}
      </div>
      <div className="row">
        <select aria-label="FK from table" value={a?.name ?? ""} onChange={(e) => { setFrom(e.target.value); setFromCol(""); }}>{tables.map((x) => <option key={x.name} value={x.name}>{short(x.name)}</option>)}</select>
        <select aria-label="FK from column" value={ac?.name ?? ""} onChange={(e) => setFromCol(e.target.value)}>{a?.columns.map((c) => <option key={c.name}>{c.name}</option>)}</select>
      </div>
      <div className="row">
        <span style={{ color: "var(--ui-muted)" }}>references</span>
        <select aria-label="FK to table" value={b?.name ?? ""} onChange={(e) => { setTo(e.target.value); setToCol(""); }}>{tables.map((x) => <option key={x.name} value={x.name}>{short(x.name)}</option>)}</select>
        <select aria-label="FK to column" value={bc?.name ?? ""} onChange={(e) => setToCol(e.target.value)}>{b?.columns.map((c) => <option key={c.name}>{c.name}</option>)}</select>
      </div>
      <div className="row">
        <button className="btn" disabled={busy || !ac || !bc} onClick={() => run([{ kind: "add_fk", table: a!.name, columns: [ac!.name], ref_table: b!.name, ref_columns: [bc!.name] }])}>Add link</button>
        <span style={{ color: "var(--ui-muted)", fontSize: 12 }}>added NOT VALID: existing rows are not checked</span>
      </div>
    </section>
  );
}

function ColumnSection({ run, busy }: { run: Run; busy: boolean }) {
  const tables = useTables();
  const [table, setTable] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("text");
  const [drop, setDrop] = useState("");
  const t = tables.find((x) => x.name === table) ?? tables[0];
  const dropCol = t?.columns.find((c) => c.name === drop) ?? t?.columns[0];
  return (
    <section aria-label="Columns">
      <div className="row">
        <select aria-label="Column table" value={t?.name ?? ""} onChange={(e) => { setTable(e.target.value); setDrop(""); }}>{tables.map((x) => <option key={x.name} value={x.name}>{short(x.name)}</option>)}</select>
      </div>
      <div className="row">
        <input aria-label="New column name" placeholder="new_column" value={name} onChange={(e) => setName(e.target.value)} />
        <select aria-label="New column type" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((x) => <option key={x}>{x}</option>)}</select>
        <button className="btn" disabled={busy || !t || !name.trim()} onClick={() => run([{ kind: "add_column", table: t!.name, name: name.trim(), type }]).then((ok) => ok && setName(""))}>Add</button>
      </div>
      <div className="row">
        <select aria-label="Column to drop" value={dropCol?.name ?? ""} onChange={(e) => setDrop(e.target.value)}>{t?.columns.map((c) => <option key={c.name}>{c.name}</option>)}</select>
        <button className="btn ghost" disabled={busy || !dropCol} onClick={() => run([{ kind: "drop_column", table: t!.name, name: dropCol!.name }])}>Drop column</button>
      </div>
    </section>
  );
}

function DataSection({ busy }: { busy: boolean }) {
  const tables = useTables();
  const rows = tables.length ? Math.max(...tables.map((t) => t.row_estimate)) : 0;
  return (
    <section aria-label="Data size">
      <p style={{ margin: "0 0 6px", color: "var(--ui-muted)" }}>Now about {rows.toLocaleString("en-US")} rows per table. Indexes only pay off on bigger tables — try 50,000 or more.</p>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {SIZES.map((n) => <button key={n} className="btn ghost" disabled={busy} onClick={() => refillData(n)}>{n.toLocaleString("en-US")} rows</button>)}
      </div>
    </section>
  );
}

function RawSection({ run, busy }: { run: Run; busy: boolean }) {
  const [sql, setSql] = useState("");
  return (
    <div>
      <textarea aria-label="DDL statement" value={sql} onChange={(e) => setSql(e.target.value)} placeholder="CREATE INDEX ON orders (created_at DESC);" spellCheck={false} style={{ minHeight: 70 }} />
      <p style={{ color: "var(--ui-muted)", fontSize: 12, margin: "4px 0" }}>CREATE INDEX, ALTER TABLE, CREATE TABLE, DROP INDEX, DROP TABLE. Runs without superuser rights.</p>
      <button className="btn" disabled={busy || !sql.trim()} onClick={() => run([{ kind: "sql", statement: sql }]).then((ok) => ok && setSql(""))}>Run</button>
    </div>
  );
}

const fmtValue = (v: number, metric: "cost" | "time") => (metric === "time" ? `${v.toFixed(2)} ms` : v.toFixed(1));

function ExperimentsSection() {
  const experiments = useStore((s) => s.experiments);
  const hasSearch = useStore((s) => !!s.searchRequest);
  const patch = useStore((s) => s.patchStructure);
  const base = experiments[0];
  return (
    <section aria-label="Experiments">
      {experiments.length === 0 && (
        <p style={{ margin: 0, color: "var(--ui-muted)" }}>
          {hasSearch ? "Make a change: the search re-runs and the best plan is compared here." : "Run a search first (Search → Search), then change the structure to see whether it gets faster."}
        </p>
      )}
      {experiments.length > 0 && (
        <div style={{ overflow: "auto" }}>
          <table className="grid" aria-label="Experiment results">
            <thead><tr><th>Change</th><th>Best plan</th><th>{base?.best?.metric === "time" ? "Time" : "Est. cost"}</th><th>vs baseline</th></tr></thead>
            <tbody>
              {experiments.map((e, i) => {
                const d = i === 0 ? null : deltaPct(base, e);
                return (
                  <tr key={e.id} title={e.best?.sql}>
                    <td style={{ whiteSpace: "normal" }}>{e.label}</td>
                    <td>{e.best ? `${e.best.shape}, ${e.best.joins} join${e.best.joins === 1 ? "" : "s"}` : "none"}</td>
                    <td>{e.best ? fmtValue(e.best.value, e.best.metric) : "—"}</td>
                    <td className={d === null ? "" : d < -1 ? "good" : d > 1 ? "bad" : ""}>{i === 0 ? "baseline" : d === null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(0)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button className="btn ghost" style={{ marginTop: 6 }} onClick={() => patch({ experiments: [] })}>Clear</button>
        </div>
      )}
    </section>
  );
}

/** Live structure lab: change indexes, links, columns and data size of the sandbox and compare the best plan before/after. */
export function StructurePanel() {
  const mode = useStore((s) => s.sourceMode);
  const busy = useStore((s) => s.structureBusy);
  const error = useStore((s) => s.structureError);
  const executed = useStore((s) => s.lastExecuted);
  const experiments = useStore((s) => s.experiments);
  const indexes = useStore((s) => s.indexes);
  const fks = useStore((s) => s.graph?.fks.length ?? 0);
  const changes = useStore((s) => s.changeLog.length);
  const run: Run = (ops) => applyStructure(ops);
  useEffect(() => {
    if (mode === "sandbox") void loadStructure();
  }, [mode]);

  if (mode !== "sandbox") {
    return (
      <>
        <h2>Structure lab</h2>
        <p className="warn">Structure editing only works on the sandbox, never on a live database. Switch the data source back to the sandbox to experiment.</p>
        <SuggestedLinks canAdd={false} />
      </>
    );
  }
  return (
    <>
      <h2>Structure lab</h2>
      <p style={{ margin: "0 0 4px", color: "var(--ui-muted)" }}>Change the sandbox database live. The web updates, your search re-runs, and the Before / after table shows whether the best plan got faster.</p>
      <ol className="steps" aria-label="How it works">
        <li>Run a search</li><li>Change the structure</li><li>Read Before / after</li><li>Export what worked</li>
      </ol>
      {busy && <div role="status" style={{ color: "var(--active)" }}>Applying…</div>}
      {error && <div className="err" role="alert">{error}</div>}
      {executed.length > 0 && <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: "6px 0", color: "var(--ui-muted)" }} aria-label="Executed SQL">{executed.join(";\n")}</pre>}
      <Fold title="Before / after" hint="did it get faster?" badge={experiments.length || undefined} defaultOpen><ExperimentsSection /></Fold>
      <SuggestedLinks canAdd />
      <Fold title="Indexes" hint="speed up lookups" badge={indexes.length} defaultOpen><IndexSection run={run} busy={busy} /></Fold>
      <Fold title="Foreign keys" hint="links between tables" badge={fks}><FkSection run={run} busy={busy} /></Fold>
      <Fold title="Columns" hint="add or drop"><ColumnSection run={run} busy={busy} /></Fold>
      <Fold title="Data size" hint="how many mock rows"><DataSection busy={busy} /></Fold>
      <Fold title="Export" hint="structure, data, changes" badge={changes || undefined}><ExportSection /></Fold>
      <Fold title="Advanced" hint="run one DDL statement"><RawSection run={run} busy={busy} /></Fold>
    </>
  );
}
