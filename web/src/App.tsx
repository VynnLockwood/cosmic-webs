import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { resetSchema } from "./store/actions";
import { useSearchHighlight } from "./search/useHighlight";
import { motionActions } from "./scene/camera/motion";
import { SKY_ONLY } from "./scene/e2eHook";

// three.js and the scene are the heavy part of the bundle: load them in parallel with the schema, not before the UI
const Scene = lazy(() => import("./scene/Scene"));
import { Drawer } from "./ui/Drawer";
import { FindTable } from "./ui/FindTable";
import { ImportProgress } from "./ui/ImportProgress";
import { Hud } from "./ui/Hud";
import { Rail } from "./ui/Rail";
import { TablePanel } from "./ui/TablePanel";
import "./ui/theme.css";
import { useShortcuts, type Action } from "./shortcuts";
import { useStore } from "./store/useStore";

export default function App() {
  const [error, setError] = useState<string | null>(null);
  const graph = useStore((s) => s.graph);
  useEffect(() => {
    // the default schema loads as a background job: the graph shows at once, rows and progress follow
    resetSchema().then(() => {
      const e = useStore.getState().schemaError;
      if (e && !useStore.getState().graph) setError(e.message);
    });
  }, []);
  const onAction = useCallback((a: Action) => {
    switch (a.type) {
      case "back": {
        const st = useStore.getState();
        if (st.selectedTable) return motionActions.back();
        return st.drawer ? st.setDrawer(null) : undefined;
      }
      case "frameAll": return motionActions.frameAll();
      case "zoomIn": return motionActions.zoom(1);
      case "zoomOut": return motionActions.zoom(-1);
      case "rotate15": return motionActions.rotate15(a.dir);
      case "focusSearch": return useStore.getState().setDrawer("search");
      case "focusFind": return void window.dispatchEvent(new Event("cosmos:find"));
    }
  }, []);
  useShortcuts(onAction);
  useSearchHighlight();
  return (
    <div style={{ position: "fixed", inset: 0 }} onDoubleClick={() => !useStore.getState().hoveredTable && motionActions.resetView()}>
      <Suspense fallback={null}><Scene /></Suspense>
      {!graph && !error && <div className="boot" role="status">Loading the universe…</div>}
      {!SKY_ONLY && (
        <div className="ui-layer">
          <Rail />
          <Drawer />
          <TablePanel />
          <FindTable />
          <Hud />
          <ImportProgress floating />
        </div>
      )}
      {error && <div style={{ position: "absolute", top: 16, left: 80, color: "#FF5C6C" }}>Could not load schema: {error}</div>}
    </div>
  );
}
