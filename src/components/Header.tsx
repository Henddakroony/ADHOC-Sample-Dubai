import { useState, useEffect, useRef } from "react";
import Logo from "./Logo";
import AdhocLogo from "./AdhocLogo";
import { FilterState } from "../types";
import FilterDropdown, { FilterOption } from "./FilterDropdown";

interface HeaderProps {
  totalOutlets: number;
  filteredCount: number;
  activeOutlets: number;
  regionCount: number;
  loading: boolean;
  selectedRegion: string;
  selectedGovernorate: string;
  filters: FilterState;
  setFilters: (f: FilterState) => void;
  districtOptions: FilterOption[];
  regionOptions: FilterOption[];
  governorateOptions: FilterOption[];
  channelOptions: FilterOption[];
  outletTypeOptions: FilterOption[];
  segmentationOptions: FilterOption[];
  matchingStatusOptions: FilterOption[];
  view: "map" | "routing";
  onViewChange: (v: "map" | "routing") => void;
  routingEnabled?: boolean;
  analyticsOpen: boolean;
  onToggleAnalytics: () => void;
  brandsEnabled?: boolean;
  brandsOpen: boolean;
  onToggleBrands: () => void;
  matchingResultsConfigured?: boolean;
  matchingResultsOpen: boolean;
  onToggleMatchingResults: () => void;
  username?: string;
  onLogout?: () => void;
  onRefresh?: () => void;
}

const DEFAULT_FILTERS: FilterState = {
  district: "All", region: "All", governorate: "All", channel: "All",
  outletType: "All", segmentation: "All", matchingStatus: "All", searchQuery: "",
};

function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="active-filter-chip">
      {label}
      <button className="active-filter-chip-x" onClick={onRemove} aria-label={`Remove ${label} filter`}>
        <svg viewBox="0 0 10 10" fill="none" width="8" height="8">
          <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
      </button>
    </span>
  );
}

const ICON_REGION = (
  <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
    <path d="M7 1C5 1 3.5 2.7 3.5 4.8c0 2.8 3.5 7.2 3.5 7.2s3.5-4.4 3.5-7.2C10.5 2.7 9 1 7 1z" stroke="currentColor" strokeWidth="1.2"/>
    <circle cx="7" cy="4.8" r="1.3" fill="currentColor"/>
  </svg>
);
const ICON_GOV = (
  <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
    <path d="M2 5l5-3 5 3-5 3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M2 8.5l5 3 5-3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
  </svg>
);
const ICON_DISTRICT = (
  <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
    <rect x="2" y="2" width="10" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M2 6.5h10M6.5 2v10" stroke="currentColor" strokeWidth="1.1"/>
  </svg>
);
const ICON_CHANNEL = (
  <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
    <path d="M2 5.5V12h10V5.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M1.5 2.5h11l.7 2.8a1.8 1.8 0 01-3.5.7 1.8 1.8 0 01-3.6 0 1.8 1.8 0 01-3.5 0L1.5 2.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
  </svg>
);
const ICON_TYPE = (
  <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
    <path d="M7 2H3A1 1 0 002 3v4l5.5 5.5a1 1 0 001.4 0l3.1-3.1a1 1 0 000-1.4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <circle cx="4.8" cy="4.8" r="0.8" fill="currentColor"/>
  </svg>
);
const ICON_SEG = (
  <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M7 1.5V7l4 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);
const ICON_MATCHING = (
  <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
    <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
    <circle cx="9" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M7 5h1.5M5 7v1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
  </svg>
);

export default function Header({
  totalOutlets, filteredCount, activeOutlets: _activeOutlets, regionCount, loading,
  selectedRegion: _selectedRegion, selectedGovernorate: _selectedGovernorate,
  filters, setFilters,
  districtOptions, regionOptions, governorateOptions, channelOptions, outletTypeOptions, segmentationOptions, matchingStatusOptions,
  view, onViewChange, routingEnabled = false,
  analyticsOpen, onToggleAnalytics,
  brandsEnabled = false, brandsOpen, onToggleBrands,
  matchingResultsConfigured = false,
  matchingResultsOpen, onToggleMatchingResults,
  username = "ADHOC User",
  onLogout,
  onRefresh,
}: HeaderProps) {
  const sf = filters ?? DEFAULT_FILTERS;

  const [theme, setTheme] = useState<"dark" | "light">(() =>
    (localStorage.getItem("uc_theme") as "dark" | "light") ?? "dark"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("uc_theme", theme);
  }, [theme]);

  const update = (key: keyof FilterState, value: string) => {
    const next = { ...sf, [key]: value };
    if (key === "region") { next.governorate = "All"; next.district = "All"; }
    if (key === "governorate") next.district = "All";
    if (key === "channel") next.outletType = "All";
    setFilters(next);
  };

  // Debounced search: keep typing responsive, refilter only after a short pause
  const [searchInput, setSearchInput] = useState(sf.searchQuery);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearchInput(sf.searchQuery);
  }, [sf.searchQuery]);

  useEffect(() => () => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
  }, []);

  const onSearchInput = (val: string) => {
    setSearchInput(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => update("searchQuery", val), 250);
  };

  const clearSearch = () => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setSearchInput("");
    update("searchQuery", "");
  };

  const activeChips: { label: string; onRemove: () => void }[] = [];
  if (sf.region !== "All")         activeChips.push({ label: sf.region,        onRemove: () => update("region", "All") });
  if (sf.governorate !== "All")    activeChips.push({ label: sf.governorate,   onRemove: () => update("governorate", "All") });
  if (sf.district !== "All")       activeChips.push({ label: sf.district,      onRemove: () => update("district", "All") });
  if (sf.channel !== "All")        activeChips.push({ label: sf.channel,       onRemove: () => update("channel", "All") });
  if (sf.outletType !== "All")     activeChips.push({ label: sf.outletType,    onRemove: () => update("outletType", "All") });
  if (sf.segmentation !== "All")    activeChips.push({ label: sf.segmentation,    onRemove: () => update("segmentation", "All") });
  if (sf.matchingStatus !== "All")  activeChips.push({ label: sf.matchingStatus,   onRemove: () => update("matchingStatus", "All") });
  if (sf.searchQuery.trim() !== "") activeChips.push({ label: `"${sf.searchQuery}"`, onRemove: () => update("searchQuery", "") });

  const hasActive = activeChips.length > 0;
  const resetAll = () => setFilters(DEFAULT_FILTERS);

  const isFiltered = filteredCount < totalOutlets;

  return (
    <header className="header">
      <div className="header-shine" />

      {/* ══ ROW 1 ══ */}
      <div className="hdr-row1">
        <div className="hdr-brand">
          <Logo />
          <span className="hdr-brand-sep">×</span>
          <AdhocLogo />
        </div>

        <div className="hdr-center">
          <span className="hdr-app-label">
            <svg className="hdr-app-icon" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M2.5 8h11M8 2.5a10 10 0 010 11M8 2.5a10 10 0 000 11" stroke="currentColor" strokeWidth="1.1"/>
            </svg>
            Dubai Sample Data
          </span>
          {!loading && totalOutlets > 0 && (
            <div className="hdr-stat-row">
              <span className="hdr-stat">
                <span className="hdr-stat-dot" style={{ background: "#3b82f6" }} />
                {isFiltered
                  ? <><strong style={{ color: "#e2e8f0" }}>{filteredCount.toLocaleString()}</strong>&nbsp;/ {totalOutlets.toLocaleString()}</>
                  : <>{totalOutlets.toLocaleString()}</>
                } outlets
              </span>
              <span className="hdr-stat-sep" />
              <span className="hdr-stat">
                <span className="hdr-stat-dot" style={{ background: "#f59e0b" }} />
                {regionCount} emirates
              </span>
              {hasActive && (
                <>
                  <span className="hdr-stat-sep" />
                  <span className="hdr-stat hdr-stat-green">
                    <span className="hdr-stat-dot" style={{ background: "var(--brand)" }} />
                    {activeChips.length} {activeChips.length === 1 ? "filter" : "filters"} active
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="hdr-right">
          <div className="hdr-view-toggle">
            <button
              className={`hdr-view-btn${view === "map" ? " is-active" : ""}`}
              onClick={() => onViewChange("map")}
            >
              <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
                <path d="M1 3.5L5 2l4 1.5L13 2v8.5L9 12 5 10.5 1 12z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                <path d="M5 2v8.5M9 3.5V12" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
              Map
            </button>
            <button
              className={`hdr-view-btn${view === "map" && analyticsOpen ? " is-active" : ""}`}
              onClick={onToggleAnalytics}
            >
              <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
                <path d="M2 12V2M2 12h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                <rect x="4" y="7" width="2" height="3" fill="currentColor"/>
                <rect x="7.5" y="4.5" width="2" height="5.5" fill="currentColor"/>
                <rect x="11" y="6" width="2" height="4" fill="currentColor"/>
              </svg>
              Analytics
            </button>
            {brandsEnabled && (
              <button
                className={`hdr-view-btn${view === "map" && brandsOpen ? " is-active" : ""}`}
                onClick={onToggleBrands}
              >
                <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
                  <circle cx="4.5" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.2"/>
                  <circle cx="9.5" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.2"/>
                  <circle cx="7"   cy="9.5" r="2.5" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
                Brands
              </button>
            )}
            {routingEnabled && (
              <button
                className={`hdr-view-btn${view === "routing" ? " is-active" : ""}`}
                onClick={() => onViewChange("routing")}
              >
                <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
                  <circle cx="3" cy="3.2" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
                  <circle cx="11" cy="10.8" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M3 5v2.5A2.5 2.5 0 005.5 10H9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="1 1.6"/>
                </svg>
                Routing
              </button>
            )}
            {matchingResultsConfigured && (
              <button
                className={`hdr-view-btn hdr-view-btn--accent${view === "map" && matchingResultsOpen ? " is-active" : ""}`}
                onClick={onToggleMatchingResults}
              >
                <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
                  <circle cx="7" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M7 1.5v1.6M7 10.9v1.6M1.5 7h1.6M10.9 7h1.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                </svg>
                Matching Results
              </button>
            )}
          </div>

          <div className="hdr-divider-v" />

          {/* Live indicator */}
          <span className="hdr-live">
            <span className="hdr-live-dot" />
            Live
          </span>

          {/* Refresh button */}
          {onRefresh && (
            <button
              className={`hdr-icon-btn${loading ? " hdr-icon-btn--spinning" : ""}`}
              onClick={onRefresh}
              disabled={loading}
              title="Refresh data"
              aria-label="Refresh data"
            >
              <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
                <path d="M13.5 8a5.5 5.5 0 11-1.6-3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M11.5 1.5v3h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}

          <div className="hdr-divider-v" />

          {/* Theme toggle */}
          <button
            className="hdr-theme-btn"
            onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <>
                <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
                  <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                Light
              </>
            ) : (
              <>
                <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
                  <path d="M13.5 9.5A6 6 0 016.5 2.5a6 6 0 100 11 6 6 0 007-4z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Dark
              </>
            )}
          </button>

          <div className="hdr-divider-v" />

          {/* Username chip */}
          <span className="hdr-user-badge">
            <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
              <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M2.5 13.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            {username}
          </span>

          {/* Sign out */}
          {onLogout && (
            <button className="hdr-signout-btn" onClick={onLogout} title="Sign out" aria-label="Sign out">
              <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
                <path d="M6 14H3a1 1 0 01-1-1V3a1 1 0 011-1h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M11 11l3-3-3-3M14 8H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Sign Out
            </button>
          )}
        </div>
      </div>

      {/* ══ ROW 2: Filter dropdowns (map + export views) ══ */}
      {view === "map" && (
      <div className="hdr-row2">
        {matchingStatusOptions.length > 1 && (
          <FilterDropdown label="Matching Status" value={sf.matchingStatus} options={matchingStatusOptions} onChange={(v) => update("matchingStatus", v)} disabled={loading} icon={ICON_MATCHING} />
        )}
        <FilterDropdown label="Emirate"       value={sf.region}       options={regionOptions}       onChange={(v) => update("region", v)}       disabled={loading} icon={ICON_REGION} />
        <FilterDropdown label="Governorate"  value={sf.governorate}  options={governorateOptions}  onChange={(v) => update("governorate", v)}  disabled={loading} icon={ICON_GOV} />
        {districtOptions.length > 1 && (
          <FilterDropdown label="District"    value={sf.district}     options={districtOptions}     onChange={(v) => update("district", v)}     disabled={loading} icon={ICON_DISTRICT} />
        )}
        {channelOptions.length > 1 && (
          <FilterDropdown label="Channel"      value={sf.channel}      options={channelOptions}      onChange={(v) => update("channel", v)}      disabled={loading} icon={ICON_CHANNEL} />
        )}
        <FilterDropdown label="Outlet Type"  value={sf.outletType}   options={outletTypeOptions}   onChange={(v) => update("outletType", v)}   disabled={loading} icon={ICON_TYPE} />
        {segmentationOptions.length > 1 && (
          <FilterDropdown label="Segmentation" value={sf.segmentation} options={segmentationOptions} onChange={(v) => update("segmentation", v)} disabled={loading} icon={ICON_SEG} />
        )}

        <div className="pill-search-wrap">
          <svg viewBox="0 0 16 16" fill="none" width="13" height="13" className="pill-search-icon">
            <circle cx="7.5" cy="7.5" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M11 11l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <input
            className="pill-search"
            type="text"
            placeholder="Search outlets..."
            value={searchInput}
            onChange={(e) => onSearchInput(e.target.value)}
            disabled={loading}
          />
          {searchInput && (
            <button className="pill-search-clear" onClick={clearSearch} aria-label="Clear search">×</button>
          )}
        </div>

        {hasActive && (
          <button className="pill-reset" onClick={resetAll} disabled={loading} title="Reset all filters">
            <svg viewBox="0 0 14 14" fill="none" width="11" height="11">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
            Reset
          </button>
        )}
      </div>
      )}

      {/* ══ ROW 3: Active chips (map view only) ══ */}
      {view === "map" && hasActive && (
        <div className="hdr-row3">
          <span className="hdr-row3-label">Active:</span>
          {activeChips.map((chip) => (
            <ActiveChip key={chip.label} label={chip.label} onRemove={chip.onRemove} />
          ))}
        </div>
      )}
    </header>
  );
}
