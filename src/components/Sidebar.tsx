import { Outlet } from "../types";

interface SidebarProps {
  outlets: Outlet[];
  selectedOutlet: Outlet | null;
  onSelectOutlet: (o: Outlet | null) => void;
  loading: boolean;
  loadingProgress: number;
  loadingTotal: number;
  error: string | null;
  collapsed: boolean;
  onSetCollapsed: (v: boolean) => void;
}

const STATUS_COLORS: Record<string, string> = {
  Active:   "#22c55e",
  Inactive: "#ef4444",
  Pending:  "#f59e0b",
};
const STATUS_BG: Record<string, string> = {
  Active:   "rgba(34,197,94,0.12)",
  Inactive: "rgba(239,68,68,0.12)",
  Pending:  "rgba(245,158,11,0.12)",
};

// The map shows every outlet, but the sidebar only renders a capped window.
// Rendering all ~60k outlets as DOM nodes floods the page and makes every
// selection/filter re-render janky; the list is for browsing, not exhaustively
// scrolling 60k rows, so we cap it and tell the user to refine instead.
const MAX_VISIBLE = 300;

export default function Sidebar({
  outlets, selectedOutlet, onSelectOutlet,
  loading, loadingProgress, loadingTotal, error,
  collapsed, onSetCollapsed,
}: SidebarProps) {
  const pct = loadingTotal > 0 ? Math.round((loadingProgress / loadingTotal) * 100) : 0;

  const limited = outlets.length > MAX_VISIBLE;
  let visibleOutlets = limited ? outlets.slice(0, MAX_VISIBLE) : outlets;
  if (
    limited &&
    selectedOutlet &&
    !visibleOutlets.some((o) => o.id === selectedOutlet.id) &&
    outlets.some((o) => o.id === selectedOutlet.id)
  ) {
    visibleOutlets = [selectedOutlet, ...outlets.slice(0, MAX_VISIBLE - 1)];
  }

  if (collapsed) return null;

  return (
    <aside className="sidebar">
      {/* Outlet list header */}
      <div className="sidebar-list-header">
        <p className="sidebar-heading">Outlets</p>
        <div className="sidebar-header-right">
          {!loading && !error && (
            <span className="results-count">{outlets.length.toLocaleString()} found</span>
          )}
          <button
            className="sidebar-collapse-btn"
            onClick={() => onSetCollapsed(true)}
            title="Collapse outlet list"
            aria-label="Collapse outlet list"
          >
            <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="sidebar-results">
        {loading && (
          <div className="sidebar-state">
            <div className="spinner" />
            {loadingTotal > 0 ? (
              <>
                <span style={{ fontWeight: 600, color: "var(--text-secondary)", fontSize: 13 }}>
                  Loading {loadingProgress.toLocaleString()} / {loadingTotal.toLocaleString()}
                </span>
                <div style={{ width: "100%", height: 3, background: "var(--border-strong)", borderRadius: 2, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${pct}%`,
                      background: "var(--brand)",
                      borderRadius: 2,
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{pct}% complete</span>
              </>
            ) : (
              <span>Connecting to service…</span>
            )}
          </div>
        )}

        {error && !loading && (
          <div className="sidebar-state sidebar-error">
            <svg viewBox="0 0 16 16" fill="none" width="18" height="18">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 12, lineHeight: 1.5 }}>{error}</span>
          </div>
        )}

        {!loading && !error && (
          <ul className="outlet-list">
            {outlets.length === 0 && (
              <li className="outlet-empty">No outlets match the current filters.</li>
            )}
            {visibleOutlets.map((outlet) => {
              const isSelected = selectedOutlet?.id === outlet.id;
              const color = STATUS_COLORS[outlet.status] ?? "#475569";
              const bg = STATUS_BG[outlet.status] ?? "rgba(71,85,105,0.12)";

              return (
                <li
                  key={outlet.id}
                  className={`outlet-item${isSelected ? " selected" : ""}`}
                  style={{ borderLeftColor: isSelected ? color : "transparent" }}
                  onClick={() => onSelectOutlet(isSelected ? null : outlet)}
                >
                  <div className="outlet-item-top">
                    <span className="outlet-name">{outlet.name}</span>
                    <span className="outlet-status-badge" style={{ background: bg, color }}>
                      <span className="dot" style={{ background: color }} />
                      {outlet.status}
                    </span>
                  </div>

                  <div className="outlet-item-bottom">
                    <span className="outlet-category">{outlet.channel}</span>
                    {outlet.outletType && outlet.outletType !== "Unknown" && (
                      <>
                        <span className="outlet-sep">·</span>
                        <span className="outlet-region">{outlet.outletType}</span>
                      </>
                    )}
                  </div>

                  {isSelected && (
                    <div className="outlet-detail">
                      {/* Photo link */}
                      {outlet.photoLink && outlet.photoLink !== "undefined" && outlet.photoLink !== "null" && outlet.photoLink !== "" && (
                        <a
                          href={outlet.photoLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="outlet-photo-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                          View Photo (2025)
                        </a>
                      )}

                      {/* Outlet type */}
                      {outlet.outletType && outlet.outletType !== "Unknown" && (
                        <p className="outlet-meta-item outlet-meta-type">
                          <svg viewBox="0 0 16 16" fill="none" className="detail-icon">
                            <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                            <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                            <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                            <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                          </svg>
                          {outlet.outletType}
                        </p>
                      )}

                      {/* Address */}
                      {outlet.address && outlet.address !== "undefined" && outlet.address !== "" && (
                        <p className="outlet-meta-item outlet-address">
                          <svg viewBox="0 0 16 16" fill="none" className="detail-icon">
                            <path d="M8 2C5.8 2 4 3.8 4 6c0 3 4 8 4 8s4-5 4-8c0-2.2-1.8-4-4-4z" stroke="currentColor" strokeWidth="1.2" />
                            <circle cx="8" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.2" />
                          </svg>
                          {outlet.address}
                        </p>
                      )}

                      {/* Mobile */}
                      {outlet.phone && outlet.phone !== "undefined" && outlet.phone !== "null" && outlet.phone !== "" && (
                        <p className="outlet-meta-item">
                          <svg viewBox="0 0 16 16" fill="none" className="detail-icon">
                            <path d="M3 2h3l1.5 3.5-1.5 1a8 8 0 004 4l1-1.5L14.5 10.5V13.5A1 1 0 0113.5 14C6 14 2 8 2 2.5A1 1 0 013 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                          </svg>
                          {outlet.phone}
                        </p>
                      )}

                      {/* Status */}
                      <p className="outlet-meta-item" style={{ marginTop: 4 }}>
                        <span className="outlet-status-badge" style={{ background: STATUS_BG[outlet.status] ?? "rgba(71,85,105,0.12)", color: STATUS_COLORS[outlet.status] ?? "#475569" }}>
                          <span className="dot" style={{ background: STATUS_COLORS[outlet.status] ?? "#475569" }} />
                          {outlet.status}
                        </span>
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
            {limited && (
              <li className="outlet-more-note">
                Showing {MAX_VISIBLE.toLocaleString()} of {outlets.length.toLocaleString()} outlets.
                Refine filters or search to find specific outlets — the map still shows them all.
              </li>
            )}
          </ul>
        )}
      </div>
    </aside>
  );
}
