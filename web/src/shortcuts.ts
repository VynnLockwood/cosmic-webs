import { useEffect } from "react";
import type { Dir } from "./scene/camera/motion";

export type Action =
  | { type: "focusSearch" | "back" | "frameAll" | "zoomIn" | "zoomOut" }
  | { type: "rotate15"; dir: Dir };

/** Keyboard map from the visual spec §8. */
export function keyToAction(e: { key: string; shiftKey?: boolean }): Action | null {
  switch (e.key) {
    case "/": return { type: "focusSearch" };
    case "Escape": return { type: "back" };
    case "f": case "F": return { type: "frameAll" };
    case "+": case "=": return { type: "zoomIn" };
    case "-": case "_": return { type: "zoomOut" };
    case "ArrowLeft": return { type: "rotate15", dir: "left" };
    case "ArrowRight": return { type: "rotate15", dir: "right" };
    case "ArrowUp": return { type: "rotate15", dir: "up" };
    case "ArrowDown": return { type: "rotate15", dir: "down" };
    default: return null;
  }
}

export function useShortcuts(handle: (a: Action) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (typing && e.key !== "Escape") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const a = keyToAction(e);
      if (a) {
        e.preventDefault();
        handle(a);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handle]);
}
