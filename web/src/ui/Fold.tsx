import type { ReactNode } from "react";

interface Props { title: string; hint?: string; badge?: string | number; defaultOpen?: boolean; children: ReactNode }

/** A collapsible card for one group of controls (title, short hint, optional count). */
export function Fold({ title, hint, badge, defaultOpen = false, children }: Props) {
  return (
    <details className="fold" open={defaultOpen}>
      <summary>
        <span className="fold-title">{title}</span>
        {badge !== undefined && <span className="fold-badge">{badge}</span>}
        {hint && <span className="fold-hint">{hint}</span>}
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}
