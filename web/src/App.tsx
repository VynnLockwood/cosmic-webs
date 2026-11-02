import { useEffect, useState } from "react";
import { api } from "./api/client";
import Scene from "./scene/Scene";
import { useStore } from "./store/useStore";

export default function App() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .getDefaultSchema()
      .then((r) => useStore.getState().setGraph(r.graph))
      .catch((e) => setError(String(e.message ?? e)));
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Scene />
      {error && <div style={{ position: "absolute", top: 16, left: 80, color: "#FF5C6C" }}>Could not load schema: {error}</div>}
    </div>
  );
}
