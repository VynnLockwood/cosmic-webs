import { useStore, type Drawer } from "../store/useStore";

const ICONS: Record<Exclude<Drawer, null>, { label: string; d: string }> = {
  schema: { label: "Schema", d: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" },
  source: { label: "Data source", d: "M12 3v6m0 6v6M5 12H3m18 0h-2M7.5 7.5 6 6m12 12-1.5-1.5M16.5 7.5 18 6M6 18l1.5-1.5M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" },
  structure: { label: "Structure", d: "M4 5h16v4H4zM4 11h7v8H4zM13 11h7v3h-7zM13 16h7v3h-7z" },
  search: { label: "Search", d: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4" },
  results: { label: "Results", d: "M5 6h14M5 12h14M5 18h9" },
  settings: { label: "Settings", d: "M5 7h9m4 0h1M5 17h1m4 0h9M14 4v6m-4 4v6" },
};

export function Rail() {
  const drawer = useStore((s) => s.drawer);
  const setDrawer = useStore((s) => s.setDrawer);
  return (
    <nav className="rail glass" aria-label="Functions">
      {(Object.keys(ICONS) as Exclude<Drawer, null>[]).map((k) => (
        <button key={k} aria-label={ICONS[k].label} aria-pressed={drawer === k} title={ICONS[k].label} onClick={() => setDrawer(drawer === k ? null : k)}>
          <svg viewBox="0 0 24 24"><path d={ICONS[k].d} /></svg>
        </button>
      ))}
    </nav>
  );
}
