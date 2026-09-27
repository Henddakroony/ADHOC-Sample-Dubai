import { useEffect, useMemo, useRef, useState } from "react";
import type { RawField } from "../hooks/useFeatureLayer";
import { downloadExcel, todayStr } from "../utils/exportExcel";

type SortDir = "asc" | "desc";

const PAGE_SIZES = [15, 30, 50, 100];

// Columns shown by default (matched by alias, case-insensitive). Everything
// else is available through the column picker.
const DEFAULT_ALIASES = new Set([
  "english region",
  "english outlet name",
  "arabic outlet name",
  "english outlet type",
  "new safi segmentation",
  "channel",
  "english outlet status",
  "photos link 2025",
  // Store profile / registration columns requested for the default view.
  "adhoc_code",
  "chain / independent store",
  "building number",
  "address",
  "phone number - mobile1",
  "contact person",
  "national address",
  "tax number",
  "store license",
  "commercial registration",
]);

// Field grouping for the column picker. Curated sections (Identity, Location,
// Contact, Status …) use explicit alias sets; the large body of brand-specific
// cooler/chiller/freezer equipment is split into product-category sections.
const SECTION_ORDER: { key: string; label: string }[] = [
  { key: "identity", label: "Identity" },
  { key: "location", label: "Location" },
  { key: "contact", label: "Contact" },
  { key: "status", label: "Status & Visits" },
  { key: "store_profile", label: "Store Profile" },
  { key: "store_sections", label: "Store Sections" },
  { key: "registration", label: "Registration & Coordinates" },
  { key: "csd", label: "CSD / Soft Drink Coolers" },
  { key: "juice", label: "Juice Coolers" },
  { key: "energy", label: "Energy Drink Coolers" },
  { key: "water", label: "Water Coolers" },
  { key: "dairy", label: "Dairy Coolers" },
  { key: "icecream", label: "Ice Cream Freezers" },
  { key: "chocolate", label: "Chocolate Chillers" },
  { key: "coffee", label: "Coffee Coolers" },
  { key: "cake", label: "Cake & Pastry Chillers" },
  { key: "poultry", label: "Poultry, Meat & Fish Chillers" },
  { key: "bagged_ice", label: "Bagged Ice Freezers" },
  { key: "trade", label: "Trade Coolers & Freezers" },
  { key: "other_equip", label: "Other Coolers & Chillers" },
  { key: "handling", label: "Product Handling" },
  { key: "diapers", label: "Diapers & Sanitary Pads" },
  { key: "blocks", label: "Planogram Blocks" },
  { key: "products", label: "Tracked Products" },
];

// Sections kept expanded by default; everything else starts collapsed.
const CORE_OPEN = new Set(["identity", "location", "contact", "status"]);

const IDENTITY_SET = new Set([
  "objectid", "adhoc_code", "arabic outlet name", "english outlet name",
  "arabic outlet type", "english outlet type", "adhoc segmentation", "channel",
  "store location", "chain / independent store", "photos link 2025",
]);
const LOCATION_SET = new Set([
  "arabic region", "english region", "arabic gov", "english gov",
  "zone_name", "building number", "address", "outlet area",
]);
const REGISTRATION_SET = new Set([
  "arabic dis", "english dis", "national address", "postal code",
  "store license", "tax number", "commercial registration", "longitude", "latitude",
]);
const STORE_PROFILE_SET = new Set(["number of cashiers", "number of doors"]);

const EQUIP_RE = /cooler|chiller|freezer|fountain|chest/;
const ENERGY_BRANDS = ["red bull", "powerhorse", "boom boom", "rockstar", "monster", "sting", "other ed"];
const JUICE_BRANDS = ["rani", "sun top", "tropicana", "ceaser", "alrai", "other juice", "original"];
const CHOCOLATE_BRANDS = ["mars", "cadbury", "kinder", "kitkat", "break", "godiva", "other chocolate"];
const DAIRY_BRANDS = ["almarai", "alsafi", "nadec", "nada", "alrabie", "saudia", "najdiyah", "alban alqariah", "puck", "arla", "lurpak", "rayan", "other dairy", "dariy"];
const CSD_BRANDS = ["coke", "pepsico", "lipton", "vitaene", "bcola", "bario", "barbican", "moussy", "stream", "hillsburg", "bison", "frutz", "code red", "vimto", "fifa", "holsten", "frutto", "c cola", "911", "rita", "kinza", "lotus", "other csd"];
const POULTRY_KEYS = ["poultry", "meat", "seafood", "fish", "deli"];

function classify(f: RawField): string {
  const a = f.alias.trim().toLowerCase();
  if (IDENTITY_SET.has(a)) return "identity";
  if (LOCATION_SET.has(a)) return "location";
  if (a.startsWith("phone number") || a === "contact person") return "contact";
  if (a.includes("status")) return "status";
  if (REGISTRATION_SET.has(a)) return "registration";
  if (STORE_PROFILE_SET.has(a)) return "store_profile";
  if (/\bsection\b/.test(a)) return "store_sections";
  if (a.endsWith("handling")) return "handling";
  // Baby diapers, adult diapers and sanitary pads brand columns — pulled out
  // of the catch-all "Tracked Products" bucket into their own picker group.
  if (/^(diapers|adult_diapers|sanitary_pads)_/.test(a)) return "diapers";
  if (a.includes("blocks count")) return "blocks";
  if (EQUIP_RE.test(a)) {
    if (a.includes("mwater")) return "water";
    if (a.includes("icecream")) return "icecream";
    if (POULTRY_KEYS.some((k) => a.includes(k))) return "poultry";
    if (ENERGY_BRANDS.some((k) => a.includes(k))) return "energy";
    if (JUICE_BRANDS.some((k) => a.includes(k))) return "juice";
    if (CHOCOLATE_BRANDS.some((k) => a.includes(k))) return "chocolate";
    if (a.includes("starbucks") || a.includes("coffe")) return "coffee";
    if (a.includes("cake") || a.includes("7 days")) return "cake";
    if (a.includes("bagged ice")) return "bagged_ice";
    if (DAIRY_BRANDS.some((k) => a.includes(k))) return "dairy";
    if (CSD_BRANDS.some((k) => a.includes(k))) return "csd";
    if (a.includes("trade")) return "trade";
    return "other_equip";
  }
  return "products";
}

interface Section {
  key: string;
  label: string;
  fields: RawField[];
}

function groupFields(fields: RawField[]): Section[] {
  const buckets = new Map<string, RawField[]>();
  for (const f of fields) {
    const key = classify(f);
    const arr = buckets.get(key);
    if (arr) arr.push(f);
    else buckets.set(key, [f]);
  }
  const out: Section[] = [];
  for (const def of SECTION_ORDER) {
    const fs = buckets.get(def.key);
    if (fs && fs.length) out.push({ key: def.key, label: def.label, fields: fs });
  }
  return out;
}

function defaultNames(fields: RawField[]): Set<string> {
  const matched = fields.filter((f) => DEFAULT_ALIASES.has(f.alias.toLowerCase())).map((f) => f.name);
  return new Set(matched.length > 0 ? matched : fields.slice(0, 8).map((f) => f.name));
}

function cellValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const s = String(v);
  if (s === "" || s === "null" || s === "undefined") return "—";
  return s;
}

function csvCell(value: string): string {
  const v = value === "—" ? "" : value;
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

// Returns an http(s) URL if the cell value is a single link, else null.
function asUrl(value: string): string | null {
  if (value === "—") return null;
  const v = value.trim();
  if (/^https?:\/\/\S+$/i.test(v) && !/\s/.test(v)) return v;
  return null;
}

function isStatusField(alias: string): boolean {
  return alias.toLowerCase().includes("status");
}

function statusClass(val: string): string {
  const low = val.toLowerCase();
  if (low.includes("inact") || low.includes("غير نشط") || low === "0" || low === "no") return "ot-status--inactive";
  if (low.includes("pend") || low.includes("review") || low.includes("معلق")) return "ot-status--pending";
  if (low.includes("act") || low.includes("نشط") || low === "1" || low === "yes") return "ot-status--active";
  return "";
}

export default function OutletTable({
  allFields,
  rows,
  filteredIds,
  objectIdField,
  loading,
  loadedFieldNames,
  onNeedFields,
  fieldFetchProgress = 0,
  fieldFetchTotal = 0,
  defaultAllColumns = false,
  title = "Outlet Data",
  exportBaseName = "Outlet_Data",
  dealingFields,
  inlineActions = false,
}: {
  allFields: RawField[];
  rows: Record<string, unknown>[];
  filteredIds: Set<string>;
  objectIdField: string;
  loading: boolean;
  // Names of fields actually merged into `rows` so far — lets exports wait
  // for any selected column still being fetched in the background instead
  // of shipping blanks for it.
  loadedFieldNames?: string[];
  onNeedFields?: (names: string[]) => void;
  // Progress of the background fetch for columns the user just enabled, in
  // pages. `fieldFetchTotal === 0` means the count isn't known yet — the bar
  // renders indeterminate in that case.
  fieldFetchProgress?: number;
  fieldFetchTotal?: number;
  // When true, every provided field is shown by default instead of the
  // curated DEFAULT_ALIASES set. Used by focused tables (e.g. the Diapers &
  // Pads tab) whose field list is already pre-filtered to what matters.
  defaultAllColumns?: boolean;
  // Heading shown in the toolbar and used as the export file / sheet name.
  title?: string;
  exportBaseName?: string;
  // Brand-flag columns (value 1 = the store carries that brand). When set, a
  // "Dealing / All" toggle appears; "Dealing" keeps only rows with a 1 in at
  // least one of these columns.
  dealingFields?: string[];
  // When true, the search box + export buttons render inside the title group
  // (right after the "N fields available" label) instead of the right rail.
  inlineActions?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [dealingOnly, setDealingOnly] = useState(true);
  const [sortName, setSortName] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [pageSize, setPageSize] = useState(15);
  const [page, setPage] = useState(1);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [colsOpen, setColsOpen] = useState(false);
  const [fieldQuery, setFieldQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const colsRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const collapseInit = useRef(false);

  const sections = useMemo(() => groupFields(allFields), [allFields]);

  // Pick default columns once, when the field list first becomes available.
  // A separate flag (not enabled.size) lets a deliberate "None" survive refreshes.
  useEffect(() => {
    if (allFields.length === 0 || initialized.current) return;
    initialized.current = true;
    setEnabled(defaultAllColumns ? new Set(allFields.map((f) => f.name)) : defaultNames(allFields));
  }, [allFields, defaultAllColumns]);

  // Start with only the core sections expanded; collapse the long equipment lists.
  useEffect(() => {
    if (sections.length === 0 || collapseInit.current) return;
    collapseInit.current = true;
    setCollapsed(new Set(sections.map((s) => s.key).filter((k) => !CORE_OPEN.has(k))));
  }, [sections]);

  useEffect(() => {
    if (!colsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (colsRef.current && !colsRef.current.contains(e.target as Node)) setColsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [colsOpen]);

  const activeCols = useMemo(
    () => allFields.filter((f) => enabled.has(f.name)),
    [allFields, enabled]
  );

  // Which of the currently visible columns haven't actually been fetched into
  // `rows` yet. Selecting a column outside the lean initial set kicks off a
  // background fetch (onNeedFields → ensureFields) that streams over every
  // row; until it finishes, that column reads as blank for most outlets. An
  // export taken mid-fetch used to silently ship those blanks — this is what
  // "CSV doesn't have all the fields" turned out to be, so both export
  // buttons now wait for pendingCols to clear.
  const loadedFieldSet = useMemo(() => new Set(loadedFieldNames ?? []), [loadedFieldNames]);
  const pendingCols = useMemo(
    () => activeCols.filter((c) => !loadedFieldSet.has(c.name)),
    [activeCols, loadedFieldSet]
  );
  const fieldsReady = pendingCols.length === 0;

  // Ask the data layer to fetch (on demand) any columns the user enables that
  // weren't part of the lean initial load.
  const neededKey = useMemo(() => activeCols.map((c) => c.name).join(","), [activeCols]);
  useEffect(() => {
    if (!onNeedFields || !neededKey) return;
    onNeedFields(neededKey.split(","));
  }, [neededKey, onNeedFields]);

  const displaySections = useMemo(() => {
    const q = fieldQuery.trim().toLowerCase();
    return sections
      .map((s) => ({
        ...s,
        shown: q
          ? s.fields.filter((f) => f.alias.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
          : s.fields,
      }))
      .filter((s) => s.shown.length > 0);
  }, [sections, fieldQuery]);

  const filteredRows = useMemo(() => {
    if (filteredIds.size === 0) return rows;
    return rows.filter((r) => filteredIds.has(String(r[objectIdField] ?? "")));
  }, [rows, filteredIds, objectIdField]);

  const hasDealing = !!dealingFields && dealingFields.length > 0;

  // "Dealing" = the store carries at least one of the brand-flag columns.
  const dealingRows = useMemo(() => {
    if (!hasDealing || !dealingOnly) return filteredRows;
    const fields = dealingFields as string[];
    return filteredRows.filter((r) =>
      fields.some((fn) => {
        const v = r[fn];
        return v === 1 || v === "1" || v === true;
      })
    );
  }, [filteredRows, hasDealing, dealingOnly, dealingFields]);

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || activeCols.length === 0) return dealingRows;
    return dealingRows.filter((r) =>
      activeCols.some((f) => String(r[f.name] ?? "").toLowerCase().includes(q))
    );
  }, [dealingRows, search, activeCols]);

  const sorted = useMemo(() => {
    if (!sortName) return searched;
    const arr = [...searched];
    arr.sort((a, b) => {
      const av = String(a[sortName] ?? "");
      const bv = String(b[sortName] ?? "");
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [searched, sortName, sortDir]);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const startIdx = (currentPage - 1) * pageSize;
  const pageRows = sorted.slice(startIdx, startIdx + pageSize);

  const toggleSort = (name: string) => {
    if (name === sortName) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortName(name);
      setSortDir("asc");
    }
    setPage(1);
  };

  const toggleColumn = (name: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const setSectionEnabled = (fields: RawField[], on: boolean) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      for (const f of fields) {
        if (on) next.add(f.name);
        else next.delete(f.name);
      }
      return next;
    });
  };

  const showAll = () => setEnabled(new Set(allFields.map((f) => f.name)));
  const showNone = () => setEnabled(new Set());
  const resetDefault = () => setEnabled(defaultAllColumns ? new Set(allFields.map((f) => f.name)) : defaultNames(allFields));

  const toggleSection = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Busy flag for whichever export is running. Building the file (tens of
  // thousands of rows, up to 609 columns) is synchronous work that can take
  // a few seconds \u2014 without this the button gave zero feedback while it ran,
  // which read as "Excel export doesn't work" even when it eventually landed.
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportCsv = () => {
    if (exporting || !fieldsReady) return;
    setExportError(null);
    setExporting("csv");
    // Defer so the "Exporting\u2026" state actually paints before the (blocking)
    // string-building work below starts.
    setTimeout(() => {
      try {
        const header = ["#", ...activeCols.map((c) => c.alias)];
        const lines = [header.map(csvCell).join(",")];
        sorted.forEach((r, i) => {
          const row = [String(i + 1), ...activeCols.map((c) => cellValue(r[c.name]))];
          lines.push(row.map(csvCell).join(","));
        });
        const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${exportBaseName}_${todayStr()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("[OutletTable] CSV export failed:", err);
        setExportError("CSV export failed. Try selecting fewer columns and export again.");
      } finally {
        setExporting(null);
      }
    }, 30);
  };

  const exportXlsx = () => {
    if (exporting || !fieldsReady) return;
    setExportError(null);
    setExporting("xlsx");
    setTimeout(() => {
      try {
        // Sheets are keyed by header text, so two columns sharing an alias
        // would silently overwrite each other — suffix any duplicate.
        const seen = new Map<string, number>();
        const headers = activeCols.map((c) => {
          const n = (seen.get(c.alias) ?? 0) + 1;
          seen.set(c.alias, n);
          return n === 1 ? c.alias : `${c.alias} (${n})`;
        });
        const columnOrder = ["#", ...headers];

        const rows = sorted.map((r, i) => {
          const out: Record<string, unknown> = { "#": i + 1 };
          activeCols.forEach((c, ci) => {
            const raw = r[c.name];
            // Keep real numbers numeric so Excel can sum and sort them; the
            // placeholder dash becomes a blank cell rather than literal "—".
            out[headers[ci]] = typeof raw === "number" ? raw
              : cellValue(raw) === "—" ? ""
              : cellValue(raw);
          });
          return out;
        });

        downloadExcel(rows, columnOrder, title, `${exportBaseName}_${todayStr()}`);
      } catch (err) {
        console.error("[OutletTable] Excel export failed:", err);
        setExportError("Excel export failed. Try selecting fewer columns and export again.");
      } finally {
        setExporting(null);
      }
    }, 30);
  };

  const isLoading = loading || (rows.length === 0 && allFields.length === 0);

  const dealingToggleEl = hasDealing ? (
    <div className="ot-seg" role="group" aria-label="Dealing filter">
      <button
        className={`ot-seg-btn${dealingOnly ? " is-active" : ""}`}
        onClick={() => { setDealingOnly(true); setPage(1); }}
        title="Only stores carrying at least one diapers / pads brand"
      >
        Dealing
      </button>
      <button
        className={`ot-seg-btn${!dealingOnly ? " is-active" : ""}`}
        onClick={() => { setDealingOnly(false); setPage(1); }}
        title="Show all stores"
      >
        All
      </button>
    </div>
  ) : null;

  const searchEl = (
    <div className="ot-search">
      <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        placeholder="Search outlets…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
    </div>
  );

  const exportEls = (
    <>
      <button
        className="ot-csv"
        onClick={exportCsv}
        disabled={total === 0 || activeCols.length === 0 || !fieldsReady || exporting !== null}
        title={
          !fieldsReady
            ? `Waiting for ${pendingCols.length} more column${pendingCols.length === 1 ? "" : "s"} to finish loading…`
            : "Export the filtered rows and visible columns to CSV"
        }
      >
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
          <path d="M8 2v8m0 0L5 7m3 3l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 12v2h10v-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        {exporting === "csv" ? "Exporting…" : "CSV"}
      </button>
      <button
        className="ot-csv ot-xlsx"
        onClick={exportXlsx}
        disabled={total === 0 || activeCols.length === 0 || !fieldsReady || exporting !== null}
        title={
          !fieldsReady
            ? `Waiting for ${pendingCols.length} more column${pendingCols.length === 1 ? "" : "s"} to finish loading…`
            : "Export the filtered rows and visible columns to Excel"
        }
      >
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
          <path d="M8 2v8m0 0L5 7m3 3l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 12v2h10v-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        {exporting === "xlsx" ? "Exporting…" : "Excel"}
      </button>
    </>
  );

  return (
    <div className="ot-panel">
      <div className="ot-bar">
        <div className={`ot-title-group${inlineActions ? " ot-title-group--rich" : ""}`}>
          <span className="ot-title">{title}</span>
          <span className="ot-count">{isLoading ? "…" : `${total.toLocaleString()} outlets`}</span>
          {allFields.length > 0 && (
            <span className="ot-fields">{allFields.length} fields available</span>
          )}
          {pendingCols.length > 0 && (() => {
            const pct = fieldFetchTotal > 0
              ? Math.min(100, Math.round((fieldFetchProgress / fieldFetchTotal) * 100))
              : null;
            return (
              <span
                className="ot-progress"
                role="progressbar"
                aria-label="Loading selected columns"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct ?? undefined}
                title="Selected columns are still being fetched from the server before export can include them"
              >
                <span className="ot-progress-label">
                  Loading {pendingCols.length} column{pendingCols.length === 1 ? "" : "s"}
                  {pct !== null ? ` — ${pct}%` : "…"}
                </span>
                <span className={`ot-progress-track${pct === null ? " is-indeterminate" : ""}`}>
                  <span
                    className="ot-progress-fill"
                    style={pct !== null ? { width: `${pct}%` } : undefined}
                  />
                </span>
              </span>
            );
          })()}
          {exportError && (
            <span className="ot-fields ot-fields-error" role="alert">{exportError}</span>
          )}
          {inlineActions && (
            <>
              {dealingToggleEl}
              {searchEl}
              <div className="ot-inline-exports">{exportEls}</div>
            </>
          )}
        </div>
        <div className="ot-actions">
          {!inlineActions && dealingToggleEl}
          {!inlineActions && searchEl}
          <div className="ot-cols" ref={colsRef}>
            <button
              className="ot-cols-btn"
              onClick={() => setColsOpen((o) => !o)}
              aria-expanded={colsOpen}
            >
              <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
                <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M6.5 2.5v11M10 2.5v11" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              Columns ({enabled.size}/{allFields.length})
            </button>
            {colsOpen && (
              <div className="ot-cols-menu">
                <input
                  className="ot-cols-search"
                  type="text"
                  placeholder={`Search ${allFields.length} fields…`}
                  value={fieldQuery}
                  onChange={(e) => setFieldQuery(e.target.value)}
                />
                <div className="ot-cols-quick">
                  <span className="ot-cols-quick-label">Visible</span>
                  <div className="ot-cols-quick-btns">
                    <button onClick={showAll}>All</button>
                    <button onClick={resetDefault}>Default</button>
                    <button onClick={showNone}>None</button>
                  </div>
                </div>
                <div className="ot-cols-list">
                  {displaySections.map((sec) => {
                    const visibleInSec = sec.fields.filter((f) => enabled.has(f.name)).length;
                    const isCollapsed = collapsed.has(sec.key) && !fieldQuery.trim();
                    return (
                      <div className="ot-sec" key={sec.key}>
                        <div className="ot-sec-head">
                          <button className="ot-sec-toggle" onClick={() => toggleSection(sec.key)}>
                            <svg
                              className={`ot-sec-chev${isCollapsed ? " is-collapsed" : ""}`}
                              viewBox="0 0 12 12" width="11" height="11" fill="none"
                            >
                              <path d="M3 4.5L6 7.5l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span className="ot-sec-name">{sec.label}</span>
                            <span className="ot-sec-count">{visibleInSec}/{sec.fields.length}</span>
                          </button>
                          <div className="ot-sec-actions">
                            <button onClick={() => setSectionEnabled(sec.fields, true)}>Add all</button>
                            <button onClick={() => setSectionEnabled(sec.fields, false)}>Clear</button>
                          </div>
                        </div>
                        {!isCollapsed && (
                          <div className="ot-sec-fields">
                            {sec.shown.map((f) => (
                              <label key={f.name} className="ot-cols-item" title={f.name}>
                                <input
                                  type="checkbox"
                                  checked={enabled.has(f.name)}
                                  onChange={() => toggleColumn(f.name)}
                                />
                                <span className="ot-cols-alias">{f.alias}</span>
                                {f.alias.toLowerCase() !== f.name.toLowerCase() && (
                                  <span className="ot-cols-raw">{f.name}</span>
                                )}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {displaySections.length === 0 && <div className="ot-cols-none">No matching fields</div>}
                </div>
                <div className="ot-cols-foot">
                  <span>{enabled.size} of {allFields.length} visible</span>
                  <button onClick={resetDefault}>Reset to default</button>
                </div>
              </div>
            )}
          </div>
          <select
            className="ot-pagesize"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            aria-label="Rows per page"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>{s} / page</option>
            ))}
          </select>
          {!inlineActions && exportEls}
        </div>
      </div>

      <div className="ot-table-wrap">
        <table className="ot-table">
          <thead>
            <tr>
              <th className="ot-num">#</th>
              {activeCols.map((c) => (
                <th
                  key={c.name}
                  className={`ot-sortable${sortName === c.name ? " ot-sorted" : ""}`}
                  onClick={() => toggleSort(c.name)}
                >
                  <span>{c.alias}</span>
                  <span className="ot-arrow">
                    {sortName === c.name ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeCols.length === 0 ? (
              <tr>
                <td className="ot-empty" colSpan={1}>
                  No columns selected. Use “Columns” to choose fields to display.
                </td>
              </tr>
            ) : pageRows.length === 0 ? (
              <tr>
                <td className="ot-empty" colSpan={activeCols.length + 1}>
                  {isLoading ? "Loading outlets…" : "No outlets match the current filters."}
                </td>
              </tr>
            ) : (
              pageRows.map((r, i) => (
                <tr key={String(r[objectIdField] ?? startIdx + i)}>
                  <td className="ot-num">{startIdx + i + 1}</td>
                  {activeCols.map((c) => {
                    const val = cellValue(r[c.name]);
                    const isStatus = isStatusField(c.alias);
                    const url = asUrl(val);
                    return (
                      <td key={c.name} className={isStatus ? `ot-status ${statusClass(val)}` : undefined}>
                        {url ? (
                          <a
                            className="ot-link"
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Open link
                          </a>
                        ) : (
                          val
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="ot-footer">
        <span className="ot-showing">
          {total === 0
            ? "Showing 0 outlets"
            : `Showing ${startIdx + 1}–${Math.min(startIdx + pageSize, total)} of ${total.toLocaleString()} outlets`}
        </span>
        <div className="ot-pager">
          <button onClick={() => setPage(1)} disabled={currentPage === 1} aria-label="First page">«</button>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} aria-label="Previous page">‹</button>
          <span className="ot-page-current">{currentPage}</span>
          <span className="ot-page-of">/ {pageCount}</span>
          <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={currentPage === pageCount} aria-label="Next page">›</button>
          <button onClick={() => setPage(pageCount)} disabled={currentPage === pageCount} aria-label="Last page">»</button>
        </div>
      </div>
    </div>
  );
}
