import { useStore } from "../store/useStore";

/** Progress of a background schema import: stage, current table and a bar. Renders nothing when idle. */
export function ImportProgress({ floating = false }: { floating?: boolean }) {
  const p = useStore((s) => s.importProgress);
  if (!p) return null;
  return (
    <div className={floating ? "import-progress floating" : "import-progress"} role="status" aria-live="polite">
      <div className="import-line">
        <span>{p.stage}{p.message ? <span className="mono"> · {p.message}</span> : null}</span>
        <span className="mono">{p.percent}%</span>
      </div>
      <div className="import-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent} aria-label="Import progress">
        <div className="import-fill" style={{ width: `${p.percent}%` }} />
      </div>
    </div>
  );
}
