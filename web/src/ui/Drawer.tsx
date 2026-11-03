import { useStore } from "../store/useStore";
import { ResizeHandle } from "./ResizeHandle";
import { ResultsPanel } from "./ResultsPanel";
import { SchemaPanel } from "./SchemaPanel";
import { SearchPanel } from "./search/SearchPanel";
import { SettingsPanel } from "./SettingsPanel";
import { SourcePanel } from "./SourcePanel";
import { StructurePanel } from "./structure/StructurePanel";

export function Drawer() {
  const drawer = useStore((s) => s.drawer);
  const close = useStore((s) => s.setDrawer);
  const saved = useStore((s) => s.panelWidths.drawer);
  const setWidth = useStore((s) => s.setPanelWidth);
  const wide = drawer === "structure" || drawer === "results";
  const width = saved ?? (wide ? 470 : 320);
  return (
    <>
      <aside className={`drawer glass${drawer ? " open" : ""}`} style={{ width }} aria-hidden={!drawer} aria-label="Function drawer">
        <button className="drawer-close" aria-label="Close panel" title="Close (Esc)" onClick={() => close(null)}>×</button>
        {drawer === "schema" && <SchemaPanel />}
        {drawer === "source" && <SourcePanel />}
        {drawer === "structure" && <StructurePanel />}
        {drawer === "search" && <SearchPanel />}
        {drawer === "results" && <ResultsPanel />}
        {drawer === "settings" && <SettingsPanel />}
      </aside>
      <ResizeHandle label="Resize function drawer" edge="right" width={width} open={!!drawer} onResize={(w) => setWidth("drawer", w)} style={{ left: 80 + width - 5 }} />
    </>
  );
}
