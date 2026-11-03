import { useStore } from "../store/useStore";
import { ResultsPanel } from "./ResultsPanel";
import { SchemaPanel } from "./SchemaPanel";
import { SearchPanel } from "./search/SearchPanel";
import { SettingsPanel } from "./SettingsPanel";
import { SourcePanel } from "./SourcePanel";

export function Drawer() {
  const drawer = useStore((s) => s.drawer);
  return (
    <aside className={`drawer glass${drawer ? " open" : ""}`} aria-hidden={!drawer} aria-label="Function drawer">
      {drawer === "schema" && <SchemaPanel />}
      {drawer === "source" && <SourcePanel />}
      {drawer === "search" && <SearchPanel />}
      {drawer === "results" && <ResultsPanel />}
      {drawer === "settings" && <SettingsPanel />}
    </aside>
  );
}
