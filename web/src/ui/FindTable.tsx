import { useEffect, useMemo, useRef } from "react";
import { motionActions } from "../scene/camera/motion";
import type { DotState } from "../scene/style";
import { useStore } from "../store/useStore";
import { Combobox, type ComboOption } from "./Combobox";

/** Search box over the 3D view: find a table by name (or column), light up the matches, Enter flies there. */
export function FindTable() {
  const graph = useStore((s) => s.graph);
  const input = useRef<HTMLInputElement>(null);
  const saved = useRef<Record<string, DotState> | null>(null);
  const typed = useRef("");
  const options = useMemo<ComboOption[]>(
    () => (graph?.tables ?? []).map((t) => ({ value: t.name, label: t.name.replace(/^public\./, ""), hint: `${t.columns.length} cols`, keywords: t.columns.map((c) => c.name).join(" ") })),
    [graph],
  );

  useEffect(() => {
    const focus = () => input.current?.focus();
    window.addEventListener("cosmos:find", focus);
    return () => window.removeEventListener("cosmos:find", focus);
  }, []);

  const matches = (text: string) => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return new Set<string>();
    return new Set(options.filter((o) => words.every((w) => `${o.label} ${o.value} ${o.keywords}`.toLowerCase().includes(w))).map((o) => o.value));
  };
  const restore = () => {
    if (saved.current) useStore.getState().setOverrides(saved.current, useStore.getState().linkOverrides);
    saved.current = null;
  };
  const paint = (active: string | null) => {
    const s = useStore.getState();
    if (!saved.current) saved.current = { ...s.dotOverrides };
    const hit = matches(typed.current);
    if (hit.size === 0 && !active) return;
    const dots: Record<string, DotState> = {};
    for (const o of options) dots[o.value] = o.value === active ? "selected" : hit.has(o.value) || (!typed.current && o.value === active) ? "required" : hit.size ? "dimmed" : saved.current[o.value] ?? "idle";
    s.setOverrides(dots, s.linkOverrides);
  };

  return (
    <div className="find-table glass" role="search">
      <Combobox
        ariaLabel="Find table"
        placeholder="Find a table…  (Ctrl/⌘ K)"
        value=""
        clearOnPick
        options={options}
        inputRef={input}
        onType={(t) => { typed.current = t; paint(null); }}
        onActive={(v) => (v ? paint(v) : undefined)}
        onClose={() => { typed.current = ""; restore(); }}
        onPick={(name) => { typed.current = ""; restore(); motionActions.flyToTable(name); input.current?.blur(); }}
      />
    </div>
  );
}
