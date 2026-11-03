import { RANGES, type VisualSettings } from "../store/visualSettings";
import { useStore, type TierSetting } from "../store/useStore";

const SLIDERS: { key: keyof VisualSettings; label: string; hint: string; step: number }[] = [
  { key: "starSize", label: "Star size", hint: "size of every star and its spikes", step: 0.05 },
  { key: "brightness", label: "Star brightness", hint: "how bright the stars shine", step: 0.05 },
  { key: "webLine", label: "Web line brightness", hint: "the lines between tables (0 hides them)", step: 0.05 },
  { key: "spin", label: "Spin sensitivity", hint: "how fast dragging turns the view, and the slow idle spin", step: 0.05 },
];

export function SettingsPanel() {
  const tier = useStore((s) => s.tier);
  const reduced = useStore((s) => s.reducedMotion);
  const visual = useStore((s) => s.visual);
  const setVisual = useStore((s) => s.setVisual);
  const resetVisual = useStore((s) => s.resetVisual);
  const s = useStore.getState();
  return (
    <>
      <h2>Settings</h2>
      <h3>Look</h3>
      <p style={{ margin: "0 0 6px", color: "var(--ui-muted)" }}>Changes show at once and are saved in this browser.</p>
      {SLIDERS.map(({ key, label, hint, step }) => (
        <div key={key} style={{ margin: "8px 0" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <label htmlFor={`v-${key}`}>{label}</label>
            <span className="mono" style={{ flex: "0 0 auto", color: "var(--active)" }}>{+visual[key].toFixed(2)}×</span>
          </div>
          <input id={`v-${key}`} type="range" min={RANGES[key][0]} max={RANGES[key][1]} step={step} value={visual[key]} onChange={(e) => setVisual({ [key]: Number(e.target.value) })} />
          <div style={{ color: "var(--ui-muted)", fontSize: 12 }}>{hint}</div>
        </div>
      ))}
      <button className="btn ghost" onClick={resetVisual}>Reset look</button>
      <h3>Performance</h3>
      <div className="row">
        <label htmlFor="tier">Quality</label>
        <select id="tier" value={tier} onChange={(e) => s.setTier(e.target.value as TierSetting)}>
          <option value="auto">Auto (measured)</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
      </div>
      <label className="row" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={reduced} onChange={(e) => s.setReducedMotion(e.target.checked)} /> <span>Reduce motion</span>
      </label>
    </>
  );
}
