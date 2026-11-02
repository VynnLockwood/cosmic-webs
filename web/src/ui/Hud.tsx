import { motionActions } from "../scene/camera/motion";
import { useStore } from "../store/useStore";

export function Hud() {
  const g = useStore((s) => s.graph);
  return (
    <div className="hud glass" aria-label="Status">
      <span>{g?.tables.length ?? 0} tables</span>
      <span>{g?.fks.length ?? 0} links</span>
      <button className="btn ghost" onClick={() => motionActions.resetView()}>Reset view</button>
    </div>
  );
}
