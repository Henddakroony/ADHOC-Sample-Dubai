import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoutingLayer, ROUTING_COMPANIES } from "../hooks/useRoutingLayer";
import RoutingMap, { RouteSummary, RoutingFilterState, SourceSplit, buildWhereClause } from "./RoutingMap";
import { SymbologyMode, colorForVanDay } from "../utils/routingSymbology";
import { downloadExcel, todayStr } from "../utils/exportExcel";
import type { RoutingFields } from "../hooks/useRoutingLayer";

const DEFAULT_FILTERS: RoutingFilterState = { region: "All", gov: "All", vanCode: "All", vanDay: "All", source: "All" };

function isFiltered(f: RoutingFilterState) {
  return f.region !== "All" || f.gov !== "All" || f.vanCode !== "All" || f.vanDay !== "All";
}

const API_KEY = (import.meta.env.VITE_ARCGIS_API_KEY as string | undefined) ?? "";

async function fetchExportRows(url: string, where: string, outFields: string[]): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  const pageSize = 2000;
  while (true) {
    const sep = url.includes("?") ? "&" : "?";
    const q = `${url}/query?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(outFields.join(","))}&returnGeometry=true&outSR=4326&resultOffset=${offset}&resultRecordCount=${pageSize}&f=json${API_KEY ? `&token=${encodeURIComponent(API_KEY)}` : ""}`;
    const res = await fetch(q);
    const data = await res.json() as { features?: Array<{ attributes: Record<string, unknown>; geometry?: { x?: number; y?: number } }> };
    const feats = data.features ?? [];
    for (const f of feats) {
      const row: Record<string, unknown> = { ...f.attributes };
      if (f.geometry) { row.Longitude = f.geometry.x; row.Latitude = f.geometry.y; }
      all.push(row);
    }
    if (feats.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

function downloadCsv(rows: Record<string, unknown>[], columns: string[], fileName: string) {
  if (!rows.length) return;
  const esc = (v: unknown) => { const s = String(v ?? ""); return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))];
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${fileName}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Sel({ label, value, options, onChange, disabled }: {
  label: string; value: string; options: Array<{ v: string; t: string }>;
  onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <label className="rt-fld">
      <span className="rt-fld-lab">{label}</span>
      <select className="rt-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
      </select>
    </label>
  );
}

export default function RoutingView() {
  const [companyId, setCompanyId] = useState<string>(ROUTING_COMPANIES[0]?.id ?? "");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [mode, setMode] = useState<SymbologyMode>("vanCode");
  const [summary, setSummary] = useState<RouteSummary | null>(null);
  const [split, setSplit] = useState<SourceSplit | null>(null);

  const rt = useRoutingLayer(companyId);
  const { company, fields, loading, error, regions, govPairs, vanCodes, vanDays, vanCodePairs, vanDayPairs, total } = rt;

  const set = (patch: Partial<typeof DEFAULT_FILTERS>) => {
    setFilters((f) => {
      const next = { ...f, ...patch };
      if (patch.region !== undefined && patch.region !== f.region) {
        next.gov = "All"; next.vanCode = "All"; next.vanDay = "All";
      }
      if (patch.gov !== undefined && patch.gov !== f.gov) {
        next.vanCode = "All"; next.vanDay = "All";
      }
      if (patch.vanCode !== undefined && patch.vanCode !== f.vanCode) {
        next.vanDay = "All";
      }
      return next;
    });
  };

  const govOptions = useMemo(() => {
    const govs = govPairs
      .filter((p) => filters.region === "All" || p.region === filters.region)
      .map((p) => p.gov);
    return Array.from(new Set(govs)).sort();
  }, [govPairs, filters.region]);

  const vanCodeOptions = useMemo(() => {
    let pairs = vanCodePairs;
    if (filters.region !== "All") pairs = pairs.filter((p) => p.region === filters.region);
    if (filters.gov !== "All") pairs = pairs.filter((p) => p.gov === filters.gov);
    return Array.from(new Set(pairs.map((p) => p.vanCode))).sort((a, b) => a - b);
  }, [vanCodePairs, filters.region, filters.gov]);

  const vanDayOptions = useMemo(() => {
    let pairs = vanDayPairs;
    if (filters.region !== "All") pairs = pairs.filter((p) => p.region === filters.region);
    if (filters.gov !== "All") pairs = pairs.filter((p) => p.gov === filters.gov);
    if (filters.vanCode !== "All") pairs = pairs.filter((p) => p.vanCode === Number(filters.vanCode));
    return Array.from(new Set(pairs.map((p) => p.vanDay))).sort((a, b) => a - b);
  }, [vanDayPairs, filters.region, filters.gov, filters.vanCode]);

  const hasSource = !!fields?.masterCode;

  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [exportOpen]);

  const doExport = useCallback(async (scope: "all" | "filtered", format: "csv" | "xlsx") => {
    if (!company || !fields) return;
    setExporting(true);
    setExportOpen(false);
    try {
      const where = scope === "all" ? "1=1" : buildWhereClause(fields, filters);
      const outFields = [
        fields.vanCode, fields.vanDay, fields.sequence,
        ...(fields.region ? [fields.region] : []),
        ...(fields.gov ? [fields.gov] : []),
        ...(fields.name ? [fields.name] : []),
        ...(fields.masterCode ? [fields.masterCode] : []),
        ...(fields.totalDistance ? [fields.totalDistance] : []),
        ...(fields.totalTime ? [fields.totalTime] : []),
      ];
      const rows = await fetchExportRows(company.url, where, outFields);
      if (!rows.length) { alert("No data to export."); return; }
      const columns = [...outFields, "Longitude", "Latitude"];
      const scopeLabel = scope === "all" ? "All" : "Filtered";
      const name = `${company.label}_Routes_${scopeLabel}_${todayStr()}`;
      if (format === "csv") {
        downloadCsv(rows, columns, name);
      } else {
        downloadExcel(rows, columns, "Routes", name);
      }
    } catch (e) {
      alert(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }, [company, fields, filters]);

  return (
    <div className="routing-view">
      {/* filter bar */}
      <div className="rt-filters">
        {ROUTING_COMPANIES.length > 1 && (
          <Sel label="Company" value={companyId}
            options={ROUTING_COMPANIES.map((c) => ({ v: c.id, t: c.label }))}
            onChange={(v) => { setCompanyId(v); setFilters(DEFAULT_FILTERS); }} />
        )}
        <Sel label="Region" value={filters.region}
          options={[{ v: "All", t: "All regions" }, ...regions.map((r) => ({ v: r, t: r }))]}
          onChange={(v) => set({ region: v })} disabled={loading} />
        <Sel label="Gov" value={filters.gov}
          options={[{ v: "All", t: "All govs" }, ...govOptions.map((g) => ({ v: g, t: g }))]}
          onChange={(v) => set({ gov: v })} disabled={loading} />
        <Sel label="Van Code" value={filters.vanCode}
          options={[{ v: "All", t: "All vans" }, ...vanCodeOptions.map((c) => ({ v: String(c), t: `Van ${c}` }))]}
          onChange={(v) => set({ vanCode: v })} disabled={loading} />
        <Sel label="Van Day" value={filters.vanDay}
          options={[{ v: "All", t: "All days" }, ...vanDayOptions.map((d) => ({ v: String(d), t: `Day ${d}` }))]}
          onChange={(v) => set({ vanDay: v })} disabled={loading} />

        {isFiltered(filters) && (
          <button className="rt-clear" onClick={() => setFilters(DEFAULT_FILTERS)} title="Clear all filters">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10.5 3.5L3.5 10.5M3.5 3.5l7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            Clear
          </button>
        )}

        <div className="rt-spacer" />

        <div className="rt-seg">
          <span className={`rt-seg-opt${mode === "vanCode" ? " on" : ""}`} onClick={() => setMode("vanCode")}>Color: Van Code</span>
          <span className={`rt-seg-opt${mode === "vanDay" ? " on" : ""}`} onClick={() => setMode("vanDay")}>Van Day</span>
        </div>

        <div className="rt-export-wrap" ref={exportRef}>
          <button className="rt-export-btn" disabled={exporting || loading} onClick={() => setExportOpen((o) => !o)}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 1.5v8M4 6.5l3.5 3.5L11 6.5M2.5 11v2h10v-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {exporting ? "Exporting…" : "Export"}
          </button>
          {exportOpen && (
            <div className="rt-export-dd">
              <p className="rt-export-title">Export routes</p>
              <div className="rt-export-section">
                <span className="rt-export-lab">All routes</span>
                <div className="rt-export-row">
                  <button onClick={() => doExport("all", "csv")}>CSV</button>
                  <button onClick={() => doExport("all", "xlsx")}>Excel</button>
                </div>
              </div>
              {isFiltered(filters) && (
                <div className="rt-export-section">
                  <span className="rt-export-lab">Filtered only</span>
                  <div className="rt-export-row">
                    <button onClick={() => doExport("filtered", "csv")}>CSV</button>
                    <button onClick={() => doExport("filtered", "xlsx")}>Excel</button>
                  </div>
                </div>
              )}
              {!isFiltered(filters) && (
                <p className="rt-export-hint">Apply filters to export a subset.</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="rt-grid">
        {/* map */}
        <div className="rt-mapcard">
          {error ? (
            <div className="rt-error">
              <strong>Routing layer unavailable</strong>
              <p>{error}</p>
              <p className="rt-error-hint">The routing layer must be shared with the current ArcGIS key.</p>
            </div>
          ) : loading || !fields || !company ? (
            <div className="rt-loading"><div className="spinner" /> Loading routes…</div>
          ) : (
            <>
              <div className="rt-maphead">
                <span className="rt-chip">
                  {company.label}
                  {filters.region !== "All" && ` · ${filters.region}`}
                  {filters.vanCode !== "All" && ` · Van ${filters.vanCode}`}
                  {filters.vanDay !== "All" && ` · Day ${filters.vanDay}`}
                </span>
                {filters.vanDay !== "All" && <span className="rt-chip rt-chip--zoom">◎ Zoomed to Van Day {filters.vanDay}</span>}
              </div>
              <RoutingMap
                url={company.url}
                fields={fields}
                filters={filters}
                mode={mode}
                vanCodes={vanCodes}
                vanDays={vanDays}
                onSummary={setSummary}
                onSourceSplit={setSplit}
              />
            </>
          )}
        </div>

        {/* side rail */}
        <div className="rt-side">
          <div className="rt-card rt-spot">
            <h4>Company source</h4>
            {hasSource && split ? (() => {
              const tot = split.fine + split.adhoc;
              const finePct = tot ? (split.fine / tot) * 100 : 0;
              const adhocPct = tot ? (split.adhoc / tot) * 100 : 0;
              return (
                <>
                  <div className="rt-spot-single">
                    <span className="rt-spot-name" style={{ color: "#8f97ff" }}>ADHOC</span>
                    <span className="rt-spot-pct" style={{ color: "#8f97ff" }}>{adhocPct.toFixed(0)}%</span>
                  </div>
                  <div className="rt-pbar"><i style={{ width: `${adhocPct}%`, background: "#5a5fd6" }} /></div>
                  <div className="rt-spot-single">
                    <span className="rt-spot-name">Fine</span>
                    <span className="rt-spot-pct">{finePct.toFixed(0)}%</span>
                  </div>
                  <div className="rt-pbar"><i style={{ width: `${finePct}%`, background: "#5BBEE8" }} /></div>
                  <p className="rt-note">{split.adhoc.toLocaleString()} ADHOC · {split.fine.toLocaleString()} Fine · empty Master Code = ADHOC.</p>
                </>
              );
            })() : (
              <p className="rt-muted">Loading source split…</p>
            )}
          </div>

          <div className="rt-card">
            <h4>Filtered stats</h4>
            <div className="rt-mets">
              <div className="rt-met"><div className="n">{filters.region === "All" ? regions.length : 1}</div><div className="l">Regions</div></div>
              <div className="rt-met"><div className="n">{filters.gov === "All" ? govOptions.length : 1}</div><div className="l">Govs</div></div>
              <div className="rt-met"><div className="n">{filters.vanCode === "All" ? vanCodeOptions.length : 1}</div><div className="l">Vans</div></div>
              <div className="rt-met"><div className="n">{filters.vanDay === "All" ? vanDayOptions.length : 1}</div><div className="l">Days</div></div>
            </div>
          </div>

          <div className="rt-card">
            <h4>Route summary</h4>
            <div className="rt-mets">
              <div className="rt-met"><div className="n">{summary ? summary.stops.toLocaleString() : total.toLocaleString()}</div><div className="l">{summary ? "Stops" : "Total stops"}</div></div>
              <div className="rt-met"><div className="n">{vanCodeOptions.length}</div><div className="l">Vans</div></div>
            </div>
          </div>

          <div className="rt-card">
            <h4>Legend · {mode === "vanDay" ? "Van Day" : "Van Code"}</h4>
            {mode === "vanDay" ? (
              <div className="rt-leg">
                {vanDays.map((d) => (
                  <div key={d} className="rt-li">
                    <span className="rt-sw" style={{ background: colorForVanDay(d) }} />
                    Day {d}{filters.vanDay === String(d) ? " · selected" : ""}
                  </div>
                ))}
              </div>
            ) : (
              <p className="rt-muted">{vanCodes.length} vans, each colored individually. Filter to a Van Code to isolate one route.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
