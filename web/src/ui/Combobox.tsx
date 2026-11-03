import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ComboOption { value: string; label?: string; hint?: string; group?: string; /** searchable but not shown */ keywords?: string }

interface Props {
  value: string;
  options: ComboOption[];
  onPick(value: string): void;
  ariaLabel: string;
  placeholder?: string;
  /** commit typed text that matches no option (values); columns stay strict */
  allowFree?: boolean;
  /** false when the options already come filtered from a server */
  filter?: boolean;
  onType?(text: string): void;
  maxShown?: number;
  disabled?: boolean;
  /** the row the user is on (arrow keys / hover) while the list is open; null when closed */
  onActive?(value: string | null): void;
  /** the list closed without a pick (Escape, click away) */
  onClose?(): void;
  inputRef?: React.Ref<HTMLInputElement>;
  /** show an empty box after a pick instead of the picked value */
  clearOnPick?: boolean;
  style?: React.CSSProperties;
}

const norm = (s: string) => s.toLowerCase();

/** A text box with a filtered, keyboard-driven list under it. */
export function Combobox({ value, options, onPick, ariaLabel, placeholder, allowFree = false, filter = true, onType, maxShown = 80, disabled, style, onActive, onClose, inputRef, clearOnPick = false }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null); // null = show the committed value
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listEl = useRef<HTMLUListElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; maxHeight: number }>({ left: 0, top: 0, width: 360, maxHeight: 300 });

  const shown = useMemo(() => {
    const words = norm(text ?? "").split(/\s+/).filter(Boolean);
    if (!filter || !words.length) return options;
    const hit = options.filter((o) => {
      const hay = norm(`${o.group ?? ""} ${o.label ?? o.value} ${o.value} ${o.hint ?? ""} ${o.keywords ?? ""}`);
      return words.every((w) => hay.includes(w));
    });
    // names first: a table called "shipments" outranks one that merely has a shipping_* column
    const byName = (o: ComboOption) => words.every((w) => norm(`${o.label ?? o.value} ${o.value}`).includes(w));
    return [...hit.filter(byName), ...hit.filter((o) => !byName(o))];
  }, [options, text, filter]);
  const rows = shown.slice(0, maxShown);
  useEffect(() => setActive(0), [text]);
  const activeValue = open ? rows[active]?.value ?? null : null;
  useEffect(() => onActive?.(activeValue), [activeValue]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && !listEl.current?.contains(e.target as Node) && close();
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  });

  // The list floats above everything (outside the panel, so the panel cannot clip it) and is wider than a narrow box.
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const place = () => {
      const r = root.current!.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, 360), window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 180 && above > below;
      setBox({ left, top: up ? Math.max(8, r.top - Math.min(320, above) - 2) : r.bottom + 2, width, maxHeight: Math.max(120, Math.min(320, up ? above : below)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, rows.length]);

  function close(picked = false) {
    setOpen(false);
    setText(null);
    if (!picked) onClose?.();
  }
  function pick(v: string) {
    onPick(v);
    close(true);
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && rows[active]) pick(rows[active].value);
      else if (allowFree && text !== null && text !== "") pick(text);
      else close();
    } else if (e.key === "Escape") {
      if (open) e.stopPropagation();
      close();
    }
  }

  const g = new Map<string, ComboOption[]>();
  rows.forEach((o) => g.set(o.group ?? "", [...(g.get(o.group ?? "") ?? []), o]));
  let n = -1;
  return (
    <div ref={root} className="combo" style={{ position: "relative", ...style }}>
      <input
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && rows[active] ? `${id}-${active}` : undefined}
        disabled={disabled}
        placeholder={placeholder}
        ref={inputRef}
        value={text ?? (clearOnPick ? "" : value)}
        autoComplete="off"
        spellCheck={false}
        onFocus={(e) => { setOpen(true); e.currentTarget.select(); }}
        onChange={(e) => { setText(e.target.value); setOpen(true); onType?.(e.target.value); }}
        onBlur={() => allowFree && text !== null && text !== value && text !== "" ? pick(text) : undefined}
        onKeyDown={onKey}
      />
      {open && createPortal(
        <ul ref={listEl} id={`${id}-list`} role="listbox" className="combo-list" aria-label={`${ariaLabel} options`} style={{ position: "fixed", left: box.left, top: box.top, minWidth: Math.min(360, window.innerWidth - 16), width: box.width, maxHeight: box.maxHeight }}>
          {rows.length === 0 && <li className="combo-empty">No matches</li>}
          {[...g].map(([group, items]) => (
            <li key={group} role="presentation">
              {group && <div className="combo-group">{group}</div>}
              <ul role="presentation">
                {items.map((o) => {
                  const i = ++n;
                  return (
                    <li key={o.value} id={`${id}-${i}`} role="option" aria-selected={i === active} className={i === active ? "combo-opt active" : "combo-opt"} onMouseDown={(e) => { e.preventDefault(); pick(o.value); }} onMouseEnter={() => setActive(i)}>
                      <span>{o.label ?? o.value}</span>
                      {o.hint && <span className="combo-hint">{o.hint}</span>}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {shown.length > rows.length && <li className="combo-empty">Showing {rows.length} of {shown.length}; keep typing to narrow.</li>}
        </ul>,
        (root.current?.closest(".ui-layer") as HTMLElement | null) ?? document.body,
      )}
    </div>
  );
}
