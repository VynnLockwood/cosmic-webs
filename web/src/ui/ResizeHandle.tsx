import { useRef } from "react";

export const MIN_WIDTH = 280;
/** Keep a panel readable (min 280px) and never wider than 80% of the window. */
export function clampWidth(w: number, windowWidth: number): number {
  return Math.round(Math.max(MIN_WIDTH, Math.min(w, windowWidth * 0.8)));
}

interface Props {
  label: string;
  /** which side of its panel the handle sits on: dragging away from the panel makes it wider */
  edge: "left" | "right";
  width: number;
  onResize(w: number | null): void;
  open: boolean;
  style: React.CSSProperties;
}

/** A draggable divider (mouse, touch, pen, arrow keys; double-click resets). */
export function ResizeHandle({ label, edge, width, onResize, open, style }: Props) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const grow = edge === "right" ? 1 : -1;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      tabIndex={open ? 0 : -1}
      className={`resize-handle${open ? " open" : ""}`}
      style={style}
      title="Drag to resize (double-click to reset)"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, w: width };
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={(e) => drag.current && onResize(clampWidth(drag.current.w + grow * (e.clientX - drag.current.x), window.innerWidth))}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={() => onResize(null)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const dir = (e.key === "ArrowRight" ? 1 : -1) * grow;
        onResize(clampWidth(width + dir * 24, window.innerWidth));
      }}
    />
  );
}
