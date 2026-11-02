import { useCallback, useEffect, useState } from "react";
import { api } from "./api/client";
import { motionActions } from "./scene/camera/motion";
import Scene from "./scene/Scene";
import { useShortcuts, type Action } from "./shortcuts";
import { useStore } from "./store/useStore";

export default function App() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .getDefaultSchema()
      .then((r) => useStore.getState().setGraph(r.graph))
      .catch((e) => setError(String(e.message ?? e)));
  }, []);
  const onAction = useCallback((a: Action) => {
    switch (a.type) {
      case "back": return useStore.getState().selectedTable ? motionActions.back() : undefined;
      case "frameAll": return motionActions.frameAll();
      case "zoomIn": return motionActions.zoom(1);
      case "zoomOut": return motionActions.zoom(-1);
      case "rotate15": return motionActions.rotate15(a.dir);
      case "focusSearch": return useStore.getState().setDrawer("search");
    }
  }, []);
  useShortcuts(onAction);
  return (
    <div style={{ position: "fixed", inset: 0 }} onDoubleClick={() => !useStore.getState().hoveredTable && motionActions.resetView()}>
      <Scene />
      {error && <div style={{ position: "absolute", top: 16, left: 80, color: "#FF5C6C" }}>Could not load schema: {error}</div>}
    </div>
  );
}
