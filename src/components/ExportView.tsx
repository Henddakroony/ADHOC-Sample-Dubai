import { useState, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";
import type { RawField } from "../hooks/useFeatureLayer";

interface ExportViewProps {
  allFields: RawField[];
  rawRows: Record<string, unknown>[];
  filteredIds: Set<string>;
  objectIdField: string;
  loading: boolean;
  loadedFieldNames?: string[];
  fieldsError?: string | null;
  onNeedFields?: (names: string[]) => void;
}

const PAGE_SIZES = [25, 50, 100, 250];

function cellValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s === "null" || s === "undefined") return "";
  return s;
}

const STATUS_ALIASES = new Set(["english outlet status", "outlet status", "status"]);

function statusColor(val: string): string | null {
  if (!val) return null;
  const low = val.toLowerCase();
  if (low.includes("inact") || low.includes("غير نشط") || low === "0" || low === "no") return "#ef4444";
  if (low.includes("pend") || low.includes("review") || low.includes("معلق")) return "#f59e0b";
  if (low.includes("act") || low.includes("نشط") || low === "1" || low === "yes") return "#22c55e";
  return "#f59e0b";
}

function downloadCSV(rows: Record<string, unknown>[], fields: RawField[]) {
  const header = fields.map((f) => `"${f.alias.replace(/"/g, '""')}"`).join(",");
  const body = rows.map((r) =>
    fields.map((f) => `"${cellValue(r[f.name]).replace(/"/g, '""')}"`).join(",")
  );
  const csv = [header, ...body].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "unicharm_outlets.csv"; a.click();
  URL.revokeObjectURL(url);
}

function downloadExcel(rows: Record<string, unknown>[], fields: RawField[]) {
  const data = rows.map((r) => {
    const row: Record<string, string> = {};
    for (const f of fields) row[f.alias] = cellValue(r[f.name]);
    return row;
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Outlets");
  XLSX.writeFile(wb, "unicharm_outlets.xlsx");
}

// Default selected columns (matched by alias, case-insensitive)
const DEFAULT_ALIASES = new Set([
  "english region",
  "arabic outlet name",
  "english outlet name",
  "english outlet type",
  "adhoc segmentation",
  "channel",
  "building number",
  "address",
  "contact person",
  "english outlet status",
]);

export default function ExportView({ allFields, rawRows, filteredIds, objectIdField, loading, loadedFieldNames = [], fieldsError, onNeedFields }: ExportViewProps) {
  const [enabledNames, setEnabledNames] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [tableSearch, setTableSearch] = useState("");
  const [colPanelOpen, setColPanelOpen] = useState(false);
  const [exporting, setExporting] = useState<"csv" | "excel" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // When fields load, select the defaults (or all if none match)
  useEffect(() => {
    if (allFields.length === 0) return;
    const matched = new Set(
      allFields
        .filter((f) => DEFAULT_ALIASES.has(f.alias.toLowerCase()))
        .map((f) => f.name)
    );
    setEnabledNames(matched.size > 0 ? matched : new Set(allFields.map((f) => f.name)));
  }, [allFields]);

  const activeCols = useMemo(() => allFields.filter((f) => enabledNames.has(f.name)), [allFields, enabledNames]);

  const loadedFieldSet = useMemo(() => new Set(loadedFieldNames ?? []), [loadedFieldNames]);
  const pendingCols = useMemo(
    () => activeCols.filter((c) => !loadedFieldSet.has(c.name)),
    [activeCols, loadedFieldSet]
  );
  const fieldsReady = pendingCols.length === 0;

  // Fetch (on demand) any selected columns that weren't in the lean load.
  // Selecting "all" here triggers the full ~580-field fetch — an explicit,
  // user-initiated bulk export action.
  const neededKey = useMemo(() => activeCols.map((c) => c.name).join(","), [activeCols]);
  useEffect(() => {
    if (!onNeedFields || !neededKey) return;
    onNeedFields(neededKey.split(","));
  }, [neededKey, onNeedFields]);

  // Filter rawRows to only those matching filtered outlets
  const filteredRows = useMemo(() => {
    if (filteredIds.size === 0) return rawRows;
    return rawRows.filter((r) => filteredIds.has(String(r[objectIdField] ?? "")));
  }, [rawRows, filteredIds, objectIdField]);

  // Table search across all active column values
  const searchedRows = useMemo(() => {
    if (!tableSearch.trim()) return filteredRows;
    const q = tableSearch.toLowerCase();
    return filteredRows.filter((r) =>
      activeCols.some((f) => cellValue(r[f.name]).toLowerCase().includes(q))
    );
  }, [filteredRows, tableSearch, activeCols]);

  const totalPages = Math.max(1, Math.ceil(searchedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = searchedRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  function toggleCol(name: string) {
    setEnabledNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) { if (next.size > 1) next.delete(name); }
      else next.add(name);
      return next;
    });
  }

  function toggleAll(on: boolean) {
    setEnabledNames(on ? new Set(allFields.map((f) => f.name)) : new Set(allFields.length ? [allFields[0].name] : []));
  }

  const allOn = enabledNames.size === allFields.length;

  function handleExport(fmt: "csv" | "excel") {
    if (exporting || !fieldsReady) return;
    setExportError(null);
    setExporting(fmt);
    setTimeout(() => {
      try {
        const rows = filteredRows;
        if (fmt === "csv") downloadCSV(rows, activeCols);
        else downloadExcel(rows, activeCols);
      } catch {
        const label = fmt === "csv" ? "CSV" : "Excel";
        setExportError(`${label} export failed. Try selecting fewer columns and export again.`);
      } finally {
        setExporting(null);
      }
    }, 30);
  }

  return (
    <div className="export-view">

      {/* ── Toolbar ── */}
      <div className="export-toolbar">
        <div className="export-toolbar-left">
          <span className="export-title">
            <svg viewBox="0 0 16 16" fill="none" width="15" height="15">
              <path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M5 6h6M5 8.5h6M5 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Outlet Data
          </span>
          <span className="export-count">
            {loading ? "Loading…" : `${searchedRows.length.toLocaleString()} outlets`}
          </span>
          {allFields.length > 0 && (
            <span className="export-count">{allFields.length} fields available</span>
          )}
        </div>

        <div className="export-toolbar-right">
          {/* Table search */}
          <div className="export-search-wrap">
            <svg viewBox="0 0 16 16" fill="none" width="13" height="13" className="export-search-icon">
              <circle cx="7.5" cy="7.5" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M11 11l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <input
              className="export-search"
              type="text"
              placeholder="Search table..."
              value={tableSearch}
              onChange={(e) => { setTableSearch(e.target.value); setPage(1); }}
            />
            {tableSearch && (
              <button className="export-search-clear" onClick={() => setTableSearch("")}>×</button>
            )}
          </div>

          {/* Column picker */}
          <div className="export-col-picker-wrap">
            <button
              className={`export-col-btn${colPanelOpen ? " is-open" : ""}`}
              onClick={() => setColPanelOpen((v) => !v)}
            >
              <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
                <rect x="1" y="1" width="4" height="12" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
                <rect x="6" y="1" width="4" height="12" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
                <rect x="11" y="1" width="2.5" height="12" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
              Columns ({enabledNames.size}/{allFields.length})
            </button>

            {colPanelOpen && (
              <div className="export-col-panel">
                <div className="export-col-panel-header">
                  <span>Select Columns</span>
                  <button className="export-col-toggle-all" onClick={() => toggleAll(!allOn)}>
                    {allOn ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div className="export-col-panel-scroll">
                  {allFields.map((f) => (
                    <label key={f.name} className="export-col-row" title={f.name}>
                      <input
                        type="checkbox"
                        checked={enabledNames.has(f.name)}
                        onChange={() => toggleCol(f.name)}
                      />
                      <span className="export-col-alias">{f.alias}</span>
                      {f.alias !== f.name && (
                        <span className="export-col-name">{f.name}</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Page size */}
          <select
            className="export-page-size"
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
          >
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / page</option>)}
          </select>

          {/* Field loading status */}
          {fieldsError && pendingCols.length > 0 ? (
            <span className="export-status-text" role="alert" style={{ color: "var(--danger)", fontSize: "12px" }}>
              Couldn't load {pendingCols.length} column{pendingCols.length === 1 ? "" : "s"} — {fieldsError}
              <button
                onClick={() => onNeedFields?.(pendingCols.map((c) => c.name))}
                style={{ marginLeft: "6px", padding: "2px 6px", fontSize: "11px", cursor: "pointer" }}
              >
                Retry
              </button>
            </span>
          ) : pendingCols.length > 0 ? (
            <span className="export-status-text" style={{ fontSize: "12px", opacity: 0.7 }}>
              Loading {pendingCols.length} column{pendingCols.length === 1 ? "" : "s"}…
            </span>
          ) : null}

          {/* Export buttons */}
          <button
            className="export-btn export-btn--csv"
            onClick={() => handleExport("csv")}
            disabled={loading || filteredRows.length === 0 || !fieldsReady || exporting !== null}
            title={!fieldsReady ? `Waiting for ${pendingCols.length} more column(s) to finish loading…` : "Export to CSV"}
          >
            <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
              <path d="M7 2v7M7 9l-2.5-2.5M7 9l2.5-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 11h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            {exporting === "csv" ? "Exporting…" : "CSV"}
          </button>
          <button
            className="export-btn export-btn--excel"
            onClick={() => handleExport("excel")}
            disabled={loading || filteredRows.length === 0 || !fieldsReady || exporting !== null}
            title={!fieldsReady ? `Waiting for ${pendingCols.length} more column(s) to finish loading…` : "Export to Excel"}
          >
            <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
              <path d="M7 2v7M7 9l-2.5-2.5M7 9l2.5-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 11h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            {exporting === "excel" ? "Exporting…" : "Excel"}
          </button>
        </div>
      </div>
      {exportError && <div className="export-status-text" role="alert" style={{ color: "var(--danger)" }}>{exportError}</div>}

      {/* ── Table ── */}
      <div className="export-table-wrap">
        {loading ? (
          <div className="export-empty">Loading data…</div>
        ) : filteredRows.length === 0 ? (
          <div className="export-empty">No outlets match the current filters.</div>
        ) : activeCols.length === 0 ? (
          <div className="export-empty">Select at least one column to display.</div>
        ) : (
          <table className="export-table">
            <thead>
              <tr>
                <th className="export-th export-th--num">#</th>
                {activeCols.map((f) => (
                  <th key={f.name} className="export-th" title={f.name}>{f.alias}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, i) => (
                <tr key={String(row[objectIdField] ?? i)} className="export-tr">
                  <td className="export-td export-td--num">
                    {(safePage - 1) * pageSize + i + 1}
                  </td>
                  {activeCols.map((f) => {
                    const val = cellValue(row[f.name]);
                    const isStatus = STATUS_ALIASES.has(f.alias.toLowerCase());
                    const color = isStatus && val ? statusColor(val) : null;
                    return (
                      <td key={f.name} className="export-td">
                        {color ? (
                          <span className="export-status-badge" style={{ color, background: `${color}18` }}>
                            <span className="export-status-dot" style={{ background: color }} />
                            {val}
                          </span>
                        ) : (val || "—")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ── */}
      {!loading && searchedRows.length > 0 && (
        <div className="export-pagination">
          <span className="export-pag-info">
            Showing {((safePage - 1) * pageSize + 1).toLocaleString()}–{Math.min(safePage * pageSize, searchedRows.length).toLocaleString()} of {searchedRows.length.toLocaleString()}
          </span>
          <div className="export-pag-btns">
            <button className="export-pag-btn" onClick={() => setPage(1)} disabled={safePage === 1}>«</button>
            <button className="export-pag-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>‹</button>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let p: number;
              if (totalPages <= 7) p = i + 1;
              else if (safePage <= 4) p = i + 1;
              else if (safePage >= totalPages - 3) p = totalPages - 6 + i;
              else p = safePage - 3 + i;
              return (
                <button key={p} className={`export-pag-btn${safePage === p ? " is-active" : ""}`} onClick={() => setPage(p)}>{p}</button>
              );
            })}
            <button className="export-pag-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>›</button>
            <button className="export-pag-btn" onClick={() => setPage(totalPages)} disabled={safePage === totalPages}>»</button>
          </div>
        </div>
      )}
    </div>
  );
}
