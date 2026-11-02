import { useStore, type TierSetting } from "../store/useStore";

export function SettingsPanel() {
  const tier = useStore((s) => s.tier);
  const reduced = useStore((s) => s.reducedMotion);
  const s = useStore.getState();
  return (
    <>
      <h2>Settings</h2>
      <div className="row">
        <label htmlFor="tier">Quality</label>
        <select id="tier" value={tier} onChange={(e) => s.setTier(e.target.value as TierSetting)}>
          <option value="auto">Auto (measured)</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
      </div>
      <div className="row">
        <label htmlFor="rm">Motion</label>
        <input id="rm" type="checkbox" checked={reduced} onChange={(e) => s.setReducedMotion(e.target.checked)} /> <span>Reduce motion</span>
      </div>
    </>
  );
}
