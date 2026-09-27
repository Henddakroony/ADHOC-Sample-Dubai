import { useState, useMemo, useCallback, lazy, Suspense } from "react";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import MapView from "./components/MapView";
import LoginScreen from "./components/LoginScreen";
import LoadingScreen from "./components/LoadingScreen";
import { Outlet, FilterState } from "./types";
import { useFeatureLayer } from "./hooks/useFeatureLayer";
import { FilterOption } from "./components/FilterDropdown";
import { loadSession, clearSession } from "./hooks/useAuth";
import { useLoadingState } from "./hooks/useLoadingState";

const Analytics   = lazy(() => import("./components/Analytics"));
const OutletTable = lazy(() => import("./components/OutletTable"));

function ViewFallback({ label }: { label: string }) {
  return (
    <div className="view-loading">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}

const DEFAULT_FILTERS: FilterState = {
  district: "All", region: "All", governorate: "All", channel: "All",
  outletType: "All", segmentation: "All", matchingStatus: "All", searchQuery: "",
};

function countBy(arr: Outlet[], key: keyof Outlet): Record<string, number> {
  const map: Record<string, number> = {};
  for (const o of arr) {
    const k = String(o[key] ?? "");
    if (k) map[k] = (map[k] || 0) + 1;
  }
  return map;
}

function toOptions(strList: string[], counts: Record<string, number>, totalAll: number): FilterOption[] {
  return strList.map((v) =>
    v === "All"
      ? { value: "All", count: totalAll }
      : { value: v, count: counts[v] ?? 0 }
  );
}

export default function App() {
  const [session, setSession] = useState(() => loadSession());

  if (!session) {
    return <LoginScreen onLogin={(u) => setSession({ username: u, expiresAt: Date.now() + 8 * 3600_000 })} />;
  }

  return <AppShell username={session.username} onLogout={() => { clearSession(); setSession(null); }} />;
}

function AppShell({ username, onLogout }: { username: string; onLogout: () => void }) {
  const {
    outlets, loading, loadingProgress, loadingTotal,
    error, districts, regions, governorates, channels, outletTypes, segmentations,

    allFields, fullRows, fullLoading, fullLoaded, loadedFieldNames, objectIdField,
    fieldFetchProgress, fieldFetchTotal,
    fieldMap, layerUrl,
    ensureFields, refetch,
  } = useFeatureLayer();

  const splashLoading = loading && loadingProgress === 0;
  const loadingState = useLoadingState(splashLoading, loadingProgress, loadingTotal);

  const [analyticsOpen, setAnalyticsOpen] = useState(true);
  const [filters, setFiltersState] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedOutlet, setSelectedOutlet] = useState<Outlet | null>(null);
  const [filterVersion, setFilterVersion] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  const setFilters = useCallback((newFilters: FilterState) => {
    const next = { ...newFilters };
    if (newFilters.region !== filters.region) { next.governorate = "All"; next.district = "All"; }
    if (newFilters.governorate !== filters.governorate) next.district = "All";
    if (newFilters.channel !== filters.channel) next.outletType = "All";
    setFiltersState(next);
    setFilterVersion((v) => v + 1);
  }, [filters.region, filters.governorate, filters.channel]);

  const toggleAnalytics = useCallback(() => {
    setAnalyticsOpen((o) => !o);
  }, []);

  const baseFilter = useCallback((o: Outlet, skip: keyof FilterState) => {
    if (skip !== "district"       && filters.district       !== "All" && o.district       !== filters.district)       return false;
    if (skip !== "region"         && filters.region         !== "All" && o.region         !== filters.region)         return false;
    if (skip !== "governorate"    && filters.governorate    !== "All" && o.governorate    !== filters.governorate)    return false;
    if (skip !== "channel"        && filters.channel        !== "All" && o.channel        !== filters.channel)        return false;
    if (skip !== "outletType"     && filters.outletType     !== "All" && o.outletType     !== filters.outletType)     return false;
    if (skip !== "segmentation"   && filters.segmentation   !== "All" && o.segmentation   !== filters.segmentation)   return false;
    if (skip !== "matchingStatus" && filters.matchingStatus !== "All" && (o.matchingStatus ?? "") !== filters.matchingStatus) return false;
    if (filters.searchQuery && !o.name.toLowerCase().includes(filters.searchQuery.toLowerCase())) return false;
    return true;
  }, [filters]);

  const forDistrict       = useMemo(() => outlets.filter((o) => baseFilter(o, "district")),       [outlets, baseFilter]);
  const forRegion         = useMemo(() => outlets.filter((o) => baseFilter(o, "region")),         [outlets, baseFilter]);
  const forGovernorate    = useMemo(() => outlets.filter((o) => baseFilter(o, "governorate")),    [outlets, baseFilter]);
  const forChannel        = useMemo(() => outlets.filter((o) => baseFilter(o, "channel")),        [outlets, baseFilter]);
  const forOutletType     = useMemo(() => outlets.filter((o) => baseFilter(o, "outletType")),     [outlets, baseFilter]);
  const forSegmentation   = useMemo(() => outlets.filter((o) => baseFilter(o, "segmentation")),   [outlets, baseFilter]);

  const districtCounts       = useMemo(() => countBy(forDistrict,       "district"),       [forDistrict]);
  const regionCounts         = useMemo(() => countBy(forRegion,         "region"),         [forRegion]);
  const governorateCounts    = useMemo(() => countBy(forGovernorate,    "governorate"),    [forGovernorate]);
  const channelCounts        = useMemo(() => countBy(forChannel,        "channel"),        [forChannel]);
  const outletTypeCounts     = useMemo(() => countBy(forOutletType,     "outletType"),     [forOutletType]);
  const segmentationCounts   = useMemo(() => countBy(forSegmentation,   "segmentation"),   [forSegmentation]);

  const availableRegions = regions;

  const availableGovernorates = useMemo(() => {
    if (filters.region === "All") return governorates;
    const govSet = new Set(
      outlets
        .filter((o) => o.region === filters.region)
        .map((o) => o.governorate)
        .filter((g) => g && g !== "Unknown" && g !== "null" && g !== "undefined")
    );
    return ["All", ...Array.from(govSet).sort()];
  }, [outlets, governorates, filters.region]);

  const availableDistricts = useMemo(() => {
    if (filters.region === "All" && filters.governorate === "All") return districts;
    const distSet = new Set(
      outlets
        .filter((o) => {
          if (filters.region      !== "All" && o.region      !== filters.region)      return false;
          if (filters.governorate !== "All" && o.governorate !== filters.governorate) return false;
          return true;
        })
        .map((o) => o.district)
        .filter((d) => d && d !== "Unknown" && d !== "null" && d !== "undefined")
    );
    return ["All", ...Array.from(distSet).sort()];
  }, [outlets, districts, filters.region, filters.governorate]);

  const availableOutletTypes = useMemo(() => {
    if (filters.channel === "All") return outletTypes;
    const typeSet = new Set(
      outlets
        .filter((o) => o.channel === filters.channel)
        .map((o) => o.outletType)
        .filter((t) => t && t !== "Unknown" && t !== "null" && t !== "undefined")
    );
    return ["All", ...Array.from(typeSet).sort()];
  }, [outlets, outletTypes, filters.channel]);

  const availableSegmentations = useMemo(() => {
    if (segmentations.length === 0) return [];
    const clean = (s: string) => s && s !== "Unknown" && s !== "null" && s !== "undefined";
    const segsInContext = new Set(
      forSegmentation.map((o) => o.segmentation).filter(clean)
    );
    if (segsInContext.size === 0) return segmentations;
    return ["All", ...Array.from(segsInContext).sort()];
  }, [segmentations, forSegmentation]);

  const districtOptions        = useMemo(() => toOptions(availableDistricts,     districtCounts,        forDistrict.length),        [availableDistricts,     districtCounts,        forDistrict.length]);
  const regionOptions          = useMemo(() => toOptions(availableRegions,       regionCounts,          forRegion.length),          [availableRegions,       regionCounts,          forRegion.length]);
  const governorateOptions     = useMemo(() => toOptions(availableGovernorates,  governorateCounts,     forGovernorate.length),     [availableGovernorates,  governorateCounts,     forGovernorate.length]);
  const channelOptions         = useMemo(() => toOptions(channels,               channelCounts,         forChannel.length),         [channels,               channelCounts,         forChannel.length]);
  const outletTypeOptions      = useMemo(() => toOptions(availableOutletTypes,   outletTypeCounts,      forOutletType.length),      [availableOutletTypes,   outletTypeCounts,      forOutletType.length]);
  const segmentationOptions    = useMemo(() => toOptions(availableSegmentations, segmentationCounts,    forSegmentation.length),    [availableSegmentations, segmentationCounts,    forSegmentation.length]);

  const filteredOutlets = useMemo(() => {
    return outlets.filter((outlet) => {
      if (filters.district       !== "All" && outlet.district       !== filters.district)       return false;
      if (filters.region         !== "All" && outlet.region         !== filters.region)         return false;
      if (filters.governorate    !== "All" && outlet.governorate    !== filters.governorate)    return false;
      if (filters.channel        !== "All" && outlet.channel        !== filters.channel)        return false;
      if (filters.outletType     !== "All" && outlet.outletType     !== filters.outletType)     return false;
      if (filters.segmentation   !== "All" && outlet.segmentation   !== filters.segmentation)   return false;
      if (filters.searchQuery && !outlet.name.toLowerCase().includes(filters.searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [outlets, filters]);

  const filteredIds = useMemo(
    () => new Set(filteredOutlets.map((o) => o.id)),
    [filteredOutlets]
  );

  const activeCount  = useMemo(() => outlets.filter((o) => o.status === "Active").length, [outlets]);
  const regionCount  = useMemo(() => new Set(outlets.map((o) => o.region).filter((r) => r !== "Unknown")).size, [outlets]);

  return (
    <div className="app-shell">
      <LoadingScreen state={loadingState} />
      {error && !loading && (
        <div className="data-error-banner">
          <svg viewBox="0 0 16 16" fill="none" width="15" height="15" style={{ flexShrink: 0 }}>
            <circle cx="8" cy="8" r="7" stroke="#ef4444" strokeWidth="1.4"/>
            <path d="M8 4.5v4M8 10.5v1" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span><strong>Data failed to load:</strong> {error}</span>
          <button className="data-error-retry" onClick={refetch}>Retry</button>
        </div>
      )}
      <Header
        totalOutlets={outlets.length}
        filteredCount={filteredOutlets.length}
        activeOutlets={activeCount}
        regionCount={regionCount}
        loading={loading}
        selectedRegion={filters.region}
        selectedGovernorate={filters.governorate}
        filters={filters}
        setFilters={setFilters}
        districtOptions={districtOptions}
        regionOptions={regionOptions}
        governorateOptions={governorateOptions}
        channelOptions={channelOptions}
        outletTypeOptions={outletTypeOptions}
        segmentationOptions={segmentationOptions}
        matchingStatusOptions={[]}
        view={"map"}
        onViewChange={() => {}}
        analyticsOpen={analyticsOpen}
        onToggleAnalytics={toggleAnalytics}
        brandsEnabled={false}
        brandsOpen={false}
        onToggleBrands={() => {}}
        matchingResultsConfigured={false}
        matchingResultsOpen={false}
        onToggleMatchingResults={() => {}}
        username={username}
        onLogout={onLogout}
        onRefresh={refetch}
      />
      <>
        {sidebarCollapsed && (
          <div className="outlet-toggle-bar">
            <button
              className="sidebar-expand-btn"
              onClick={() => setSidebarCollapsed(false)}
              title="Show outlet list"
              aria-label="Show outlet list"
            >
              <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
                <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span>Outlets</span>
              {!loading && !error && (
                <span className="sidebar-expand-count">{filteredOutlets.length.toLocaleString()}</span>
              )}
              <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
                <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}
        <div className="map-scroll">
        {analyticsOpen && (
          <div className="analytics-panel">
            <div className="analytics-panel-bar">
              <span className="analytics-panel-title">
                <svg viewBox="0 0 14 14" fill="none" width="13" height="13">
                  <path d="M2 12V2M2 12h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  <rect x="4" y="7" width="2" height="3" fill="currentColor"/>
                  <rect x="7.5" y="4.5" width="2" height="5.5" fill="currentColor"/>
                  <rect x="11" y="6" width="2" height="4" fill="currentColor"/>
                </svg>
                Analytics
              </span>
              <button
                className="analytics-panel-collapse"
                onClick={() => setAnalyticsOpen(false)}
                title="Collapse analytics"
                aria-label="Collapse analytics"
              >
                <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
                  <path d="M3 10l5-5 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Collapse
              </button>
            </div>
            <div className="analytics-panel-body">
              <Suspense fallback={<ViewFallback label="Loading analytics…" />}>
                <Analytics outlets={filteredOutlets} loading={loading} onRefresh={refetch} compact />
              </Suspense>
            </div>
          </div>
        )}
        <div className="main-content">
          <MapView
            outlets={filteredOutlets}
            allOutlets={outlets}
            selectedOutlet={selectedOutlet}
            onSelectOutlet={setSelectedOutlet}
            filterVersion={filterVersion}
            loading={loading}
            layerUrl={layerUrl}
            fieldMap={fieldMap}
            outletTypes={outletTypes}
            filters={filters}
          />
          <Sidebar
            outlets={filteredOutlets}
            selectedOutlet={selectedOutlet}
            onSelectOutlet={setSelectedOutlet}
            loading={loading}
            loadingProgress={loadingProgress}
            loadingTotal={loadingTotal}
            error={error}
            collapsed={sidebarCollapsed}
            onSetCollapsed={setSidebarCollapsed}
          />
        </div>
        <Suspense fallback={<ViewFallback label="Loading outlet data…" />}>
          <OutletTable
            allFields={allFields}
            rows={fullRows}
            filteredIds={filteredIds}
            objectIdField={objectIdField}
            loading={loading || (fullLoading && !fullLoaded)}
            loadedFieldNames={loadedFieldNames}
            onNeedFields={ensureFields}
            fieldFetchProgress={fieldFetchProgress}
            fieldFetchTotal={fieldFetchTotal}
          />
        </Suspense>
        </div>
      </>
    </div>
  );
}
