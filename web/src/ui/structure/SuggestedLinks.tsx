import { addSuggestions } from "../../store/structureActions";
import { useStore } from "../../store/useStore";
import type { Suggestion } from "../../types";

const short = (t: string) => t.replace(/^public\./, "");

export function evidence(s: Suggestion): { text: string; tone: "good" | "warn" | "muted" } {
  if (s.verified) return { text: `✓ ${s.matched?.toLocaleString("en-US")}/${s.checked?.toLocaleString("en-US")} values match`, tone: "good" };
  if (s.checked) return { text: `⚠ ${s.matched}/${s.checked} values match`, tone: "warn" };
  return { text: "name match only", tone: "muted" };
}

/** Relations the schema does not declare (found from column names, confirmed by the rows when they are real). */
export function SuggestedLinks({ canAdd }: { canAdd: boolean }) {
  const list = useStore((s) => s.suggestions);
  const source = useStore((s) => s.suggestionsSource);
  const declared = useStore((s) => s.graph?.fks.length ?? 0);
  const busy = useStore((s) => s.structureBusy);
  if (list.length === 0) return null;
  const verified = list.filter((s) => s.verified);
  return (
    <section aria-label="Suggested links">
      <h3>Suggested links ({list.length})</h3>
      <p style={{ margin: "0 0 6px", color: "var(--ui-muted)" }}>
        The schema declares {declared} foreign key{declared === 1 ? "" : "s"}. These columns look like relations too.{" "}
        {source === "mock" ? "Rows are generated, so only the names can be used as evidence." : "Matches are checked against the real rows."}
      </p>
      {canAdd && (
        <div className="row" style={{ flexWrap: "wrap" }}>
          {verified.length > 0 && <button className="btn" disabled={busy} onClick={() => addSuggestions(verified.map((s) => s.id))}>Add {verified.length} confirmed</button>}
          <button className="btn ghost" disabled={busy} onClick={() => addSuggestions(list.map((s) => s.id))}>Add all {list.length}</button>
        </div>
      )}
      <div style={{ maxHeight: 240, overflow: "auto" }}>
        {list.map((s) => {
          const ev = evidence(s);
          return (
            <div key={s.id} className="mono" style={{ display: "flex", gap: 6, alignItems: "baseline", padding: "2px 0" }} title={s.reason}>
              <span style={{ flex: 1 }}>{short(s.from_table)}.{s.from_columns.join(",")} → {short(s.to_table)}</span>
              <span className={ev.tone === "good" ? "good" : ev.tone === "warn" ? "warn" : ""} style={{ fontSize: 11, color: ev.tone === "muted" ? "var(--ui-muted)" : undefined }}>{ev.text}</span>
              {canAdd && <button className="btn ghost" style={{ padding: "0 8px" }} disabled={busy} onClick={() => addSuggestions([s.id])} aria-label={`Add link ${s.id}`}>add</button>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
