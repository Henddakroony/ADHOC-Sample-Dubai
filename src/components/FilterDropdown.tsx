import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface FilterOption {
  value: string;
  count: number;
}

interface FilterDropdownProps {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
  icon: React.ReactNode;
}

interface PanelPos { top: number; left: number; maxHeight: number; }

/** Panel width from CSS (.fd-panel max-width) plus a small viewport margin. */
const PANEL_MAX_W = 280;
const VIEWPORT_PAD = 8;

export default function FilterDropdown({
  label, value, options, onChange, disabled, icon,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos>({ top: 0, left: 0, maxHeight: 280 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const openPanel = () => {
    if (disabled) return;
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      // Keep the panel inside the viewport: clamp the left edge for the
      // right-most filters, and cap the height so a long list (District,
      // Outlet Type) stays scrollable instead of running off the screen.
      const left = Math.max(
        VIEWPORT_PAD,
        Math.min(rect.left, window.innerWidth - PANEL_MAX_W - VIEWPORT_PAD),
      );
      const top = rect.bottom + 5;
      const maxHeight = Math.max(160, window.innerHeight - top - VIEWPORT_PAD);
      setPos({ top, left, maxHeight });
    }
    setOpen((v) => !v);
  };

  /* Close on outside click */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current && !panelRef.current.contains(target) &&
        triggerRef.current && !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  /* Close when the page scrolls under the panel (it is position:fixed, so it
     would otherwise detach from its trigger) — but NOT when the user scrolls
     the option list itself. The listener is capture-phase, so without this
     check every wheel tick inside a long list closed the dropdown. */
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const isActive = value !== "All";
  const selectedCount = options.find((o) => o.value === value)?.count ?? 0;

  const panel = open ? createPortal(
    <div
      ref={panelRef}
      className="fd-panel"
      style={{ position: "fixed", top: pos.top, left: pos.left }}
      role="listbox"
    >
      <div
        className="fd-panel-inner"
        style={{ maxHeight: Math.min(pos.maxHeight, 360) }}
      >
        {options.map((opt) => {
          const isSelected = opt.value === value;
          const isAll = opt.value === "All";
          return (
            <button
              key={opt.value}
              className={`fd-option${isSelected ? " fd-option-selected" : ""}${isAll ? " fd-option-all" : ""}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              role="option"
              aria-selected={isSelected}
            >
              <span className={`fd-check${isSelected ? " fd-check-on" : ""}${isAll ? " fd-check-hidden" : ""}`}>
                {isSelected && (
                  <svg viewBox="0 0 10 8" fill="none" width="10" height="8">
                    <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </span>
              <span className="fd-option-label">
                {isAll ? "Select all" : opt.value}
              </span>
              <span className="fd-option-count">
                {opt.count.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div className={`fd-wrap${isActive ? " fd-active" : ""}${open ? " fd-open" : ""}`}>
      <button
        ref={triggerRef}
        className="fd-trigger"
        onClick={openPanel}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="fd-icon">{icon}</span>
        <span className="fd-label">{isActive ? value : label}</span>
        {isActive && (
          <span className="fd-count-badge">{selectedCount.toLocaleString()}</span>
        )}
        <span className={`fd-chevron${open ? " fd-chevron-up" : ""}`}>
          <svg viewBox="0 0 10 6" fill="none" width="9" height="9">
            <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      </button>
      {panel}
    </div>
  );
}
