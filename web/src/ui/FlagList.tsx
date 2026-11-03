import { motionActions } from "../scene/camera/motion";
import { useStore } from "../store/useStore";
import type { Flag } from "../types";
import { FkChooser } from "./FkChooser";

const AMBER = new Set(["AMBIGUOUS_FK", "EMPTY_RESULT"]);

export function FlagList({ flags }: { flags: Flag[] }) {
  const choices = useStore((s) => s.fkChoices);
  if (!flags.length) return null;
  return (
    <div aria-label="Flags">
      <h3>Flags</h3>
      {flags.map((f, i) => (
        <div key={i}>
          <div
            className="mono"
            style={{ display: "flex", gap: 8, cursor: f.table ? "pointer" : "default", color: AMBER.has(f.code) ? "var(--amber)" : "var(--red)", padding: "3px 0" }}
            onClick={() => f.table && motionActions.flyToTable(f.table)}
            title={f.table ? "Fly to this table" : undefined}
          >
            <span aria-hidden>{AMBER.has(f.code) ? "▲" : "●"}</span>
            <span><b>{f.code}</b> <span style={{ color: "var(--ui-text)" }}>{f.message}</span></span>
          </div>
          {f.code === "AMBIGUOUS_FK" && <FkChooser flag={f} key={JSON.stringify(choices)} />}
        </div>
      ))}
    </div>
  );
}
