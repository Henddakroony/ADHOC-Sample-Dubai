import { useEffect, useMemo, useState, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, Cell, LabelList,
} from "recharts";
import type { RawField } from "../hooks/useFeatureLayer";
import { downloadExcel, todayStr } from "../utils/exportExcel";
import { isSuccessfulVisit } from "../utils/outletStatus";

// ── Cold-equipment brand groups (ADHOC_DB_KGroup) ─────────────────────────────
//
// K-Group is a multi-brand distributor (Fine, Americana, Rabei, Imtenan, …), not
// a single-brand manufacturer. The layer is a cold-equipment audit: for each
// beverage / dairy / ice-cream / chocolate / water / poultry category it records
// how many coolers, chillers or freezers of each competing brand stand in the
// outlet. So "brand" here means "whose equipment is placed in the store", and
// every field below is a numeric count (a few are stored as strings — the
// helpers coerce them). Where K-Group distributes a brand that IS named on the
// layer (Americana, in poultry/meat freezers) that group carries a share KPI.

interface BrandDef {
  /** One or more count fields that roll up to this brand in the group. */
  fields: string[];
  label: string;
}

interface GroupDef {
  id: string;
  label: string;
  accentColor: string;
  brands: BrandDef[];
}

const BRAND_GROUPS: GroupDef[] = [
  {
    id: "csd-coolers",
    label: "CSD / Beverage Coolers",
    accentColor: "#2E6BE8",
    brands: [
      { label: "Pepsico",   fields: ["Pepsico_Cooler_1_Door_Count", "Pepsico_Cooler_2_Doors_Count", "Pepsico_Cooler_3_Doors_Count", "Pepsico_Chest_Cooler_Count"] },
      { label: "Coca-Cola", fields: ["Coke_Cooler_1_Door_Count", "Coke_Cooler_2_Doors_Count", "Coke_Cooler_3_Doors_Count", "Coke_Chest_Cooler_Count"] },
      { label: "Schweppes", fields: ["Schweppes_Cooler_1_Door_Count", "Schweppes_Cooler_2_Doors_Count", "Schweppes_Cooler_3_Doors_Count", "Schweppes_Chest_Cooler_Count"] },
      { label: "Ahram / Fayrouz / Pirell", fields: ["Ahram___Fayrouz___Pirell_Cooler_Count"] },
      { label: "Green Cola", fields: ["Green_Cola_Cooler_Count"] },
      { label: "V7",        fields: ["V7_Cooler_Count"] },
      { label: "Big Cola",  fields: ["Big_Cola_Cooler_Count"] },
      { label: "Frutto",    fields: ["Frutto_Cooler_Count"] },
      { label: "Barbican",  fields: ["Barbican_Cooler_Count"] },
      { label: "Crush",     fields: ["Crush_Cooler_Count"] },
      { label: "Moussy",    fields: ["Moussy_Cooler_Count"] },
      { label: "Other",     fields: ["Other_CSD_Cooler_Count"] },
    ],
  },
  {
    id: "energy-coolers",
    label: "Energy Drink Coolers",
    accentColor: "#E8871E",
    brands: [
      { label: "Redbull",    fields: ["Redbull_Cooler_Count"] },
      { label: "Powerhorse", fields: ["Powerhorse_Cooler_Count"] },
      { label: "Fury",       fields: ["Fury_Cooler_Count"] },
      { label: "Monster",    fields: ["Monster_Cooler_Count"] },
      { label: "Hype",       fields: ["Hype_Cooler_Count"] },
      { label: "Sting",      fields: ["Sting_Cooler_Count"] },
      { label: "Volt",       fields: ["Volt_Cooler_Count"] },
      { label: "Boom Boom",  fields: ["Boom_Boom_Cooler_Count"] },
      { label: "Other",      fields: ["Other_ED_Cooler_Count"] },
    ],
  },
  {
    id: "juice-dairy-coolers",
    label: "Juice & Dairy Coolers",
    accentColor: "#14A38B",
    brands: [
      { label: "Rani",        fields: ["Rani_Cooler_Count"] },
      { label: "Almarai",     fields: ["Almarai_Cooler_Count"] },
      { label: "Juhayna",     fields: ["Juhayna_Mix_Cooler_Count"] },
      { label: "Obour Land",  fields: ["Obour_Land_Cooler_Count"] },
      { label: "Danone",      fields: ["Danone_Cooler_Count"] },
      { label: "Nestle",      fields: ["Nestle_Cooler_Count"] },
      { label: "Lamar",       fields: ["Lamar_Cooler_Count"] },
      { label: "Dina Farms",  fields: ["Dina_Farms_Cooler_Count"] },
      { label: "Labanita",    fields: ["Labanita_Cooler_Count"] },
      { label: "Lactel",      fields: ["Lactel_Cooler_Count"] },
      { label: "Other Juice", fields: ["Other_Juice_Cooler_Count"] },
      { label: "Other Dairy", fields: ["Other_Dairy_Coolers_Count"] },
    ],
  },
  {
    id: "water-coolers",
    label: "Mineral Water Coolers",
    accentColor: "#3AA0FF",
    brands: [
      { label: "Nestle",   fields: ["Nestle_MWater_Cooler_Count"] },
      { label: "Baraka",   fields: ["Baraka_MWater_Cooler_Count"] },
      { label: "Aquafina", fields: ["Aquafina_MWater_Cooler_Count"] },
      { label: "Dasani",   fields: ["Dasani_MWater_Cooler_Count"] },
      { label: "Hayat",    fields: ["Hayat_MWater_Cooler_Count"] },
      { label: "Safi",     fields: ["Safi_MWater_Cooler_Count"] },
      { label: "Other",    fields: ["Other_MWater_Cooler_Count"] },
    ],
  },
  {
    id: "chocolate-chillers",
    label: "Chocolate Chillers",
    accentColor: "#8B5E3C",
    brands: [
      { label: "Mars",    fields: ["Mars_Chiller_Count"] },
      { label: "Cadbury", fields: ["Cadbury_Chiller_Count"] },
      { label: "KitKat",  fields: ["KitKat_Chiller_Count"] },
      { label: "Kinder",  fields: ["Kinder_Chiller_Count"] },
      { label: "Corona",  fields: ["Corona_Chiller_Count"] },
      { label: "Other",   fields: ["Other_Chocolate_Chillers_Count"] },
    ],
  },
  {
    id: "icecream-freezers",
    label: "Ice Cream Freezers",
    accentColor: "#C0399F",
    brands: [
      { label: "Nestle",     fields: ["Nestle_Icecream_Vertical_Freezer_Count", "Nestle_Icecream_Chest_Freezer_Count"] },
      { label: "Dolce",      fields: ["Dolce_Icecream_Vertical_Freezer_Count", "Dolce_Icecream_Chest_Freezer_Count"] },
      { label: "Mars",       fields: ["Mars_Icecream_Vertical_Freezer_Count", "Mars_Icecream_Chest_Freezer_Count"] },
      { label: "Cold Stone", fields: ["Cold_Stone_Icecream_Vertical_Freezer_Count", "Cold_Stone_Icecream_Chest_Freezer_Count"] },
      { label: "Friday",     fields: ["Friday_Icecream_Vertical_Freezer_Count", "Friday_Icecream_Chest_Freezer_Count"] },
      { label: "Gersey",     fields: ["Gersey_Icecream_Vertical_Freezer_Count", "Gersey_Icecream_Chest_Freezer_Count"] },
      { label: "Iceman",     fields: ["Iceman_Icecream_Vertical_Freezer_Count", "Iceman_Icecream_Chest_Freezer_Count"] },
      { label: "Elmasrawy",  fields: ["Elmasrawy_Icecream_Vertical_Freezer_Count", "Elmasrawy_Icecream_Chest_Freezer_Count"] },
      { label: "Fregento",   fields: ["Fregento_Icecream_Vertical_Freezer_Count", "Fregento_Icecream_Chest_Freezer_Count"] },
      { label: "Other",      fields: ["Other_Icecream_Vertical_Freezer_Count", "Other_Icecream_Chest_Freezer_Count"] },
    ],
  },
  {
    id: "poultry-freezers",
    label: "Poultry / Meat Freezers",
    accentColor: "#D64545",
    brands: [
      { label: "Americana",   fields: ["Americana_Poultry___meat_Chest_Freezer"] },
      { label: "Halwani",     fields: ["Halwani_Poultry___meat_Chest_Freezer"] },
      { label: "Atyab",       fields: ["Atyab_Poultry___meat_Chest_Freezer"] },
      { label: "Shahd",       fields: ["Shahd_Poultry___meat_Chest_Freezer"] },
      { label: "Koki",        fields: ["Koki_Poultry___meat_Chest_Freezer"] },
      { label: "Three Chefs", fields: ["Three_Chefs_Poultry___meat_Chest_Freezer"] },
      { label: "Chicketita",  fields: ["Chicketita_Poultry___meat_Chest_Freezer"] },
      { label: "Other",       fields: ["Other_Poultry___meat_Chest_Freezer"] },
    ],
  },
];

// ── Category handling penetration ─────────────────────────────────────────────
// 1/0 flags on the layer: does the outlet deal in this category at all? These
// give K-Group a read on where its distributed brands' categories are present.
interface HandlingDef { field: string; label: string; }
const HANDLING_FIELDS: HandlingDef[] = [
  { field: "Chilled_Fresh_Poultry___Meat_Handling", label: "Chilled Fresh Poultry / Meat" },
  { field: "Frozen_Processed_Meats_Handling",        label: "Frozen Processed Meats" },
  { field: "Dairy_Handling",                         label: "Dairy" },
  { field: "Yogurt_Handling",                        label: "Yogurt" },
  { field: "Canned_Juice_Handling",                  label: "Canned Juice" },
  { field: "ED_Handling",                            label: "Energy Drinks" },
  { field: "Snacks_Handling",                        label: "Snacks" },
  { field: "Chocolate_Handling",                     label: "Chocolate" },
  { field: "Tea___Herbal_Infusions_Handling",        label: "Tea & Herbal Infusions" },
  { field: "Diapers___Feminine_Care_Handling",       label: "Diapers & Feminine Care" },
];

const ALL_BRAND_FIELDS = Array.from(new Set([
  ...BRAND_GROUPS.flatMap((g) => g.brands.flatMap((b) => b.fields)),
  ...HANDLING_FIELDS.map((h) => h.field),
]));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true when a raw field value means "present/stocked". */
function isPresent(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === "number") return val > 0;
  const s = String(val).trim().toLowerCase();
  return s !== "" && s !== "0" && s !== "no" && s !== "n" && s !== "false" && s !== "null";
}

/** Numeric value of a field (for sum-based counts). */
function numericValue(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val > 0 ? val : 0;
  const n = parseFloat(String(val));
  return isNaN(n) || n < 0 ? 0 : n;
}

/** Sum a brand's constituent fields on one row. */
function brandUnits(row: Record<string, unknown>, fields: string[]): number {
  let sum = 0;
  for (const f of fields) sum += numericValue(row[f]);
  return sum;
}

/** Does the row carry at least one unit across a brand's fields? */
function brandPresent(row: Record<string, unknown>, fields: string[]): boolean {
  return fields.some((f) => isPresent(row[f]));
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface BrandTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: { label: string } }>;
  totalOutlets: number;
}

function BrandTooltip({ active, payload, totalOutlets }: BrandTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  const pct = totalOutlets > 0 ? ((d.value / totalOutlets) * 100).toFixed(1) : "0";
  return (
    <div className="an-tooltip">
      <span className="an-tooltip-name">{d.payload.label}</span>
      <span className="an-tooltip-val">
        {d.value.toLocaleString()} units · {pct}% of visited outlets
      </span>
    </div>
  );
}

interface GroupCardProps {
  group: GroupDef;
  filteredRows: Record<string, unknown>[];
  fieldsLoaded: boolean;
}

function GroupCard({ group, filteredRows, fieldsLoaded }: GroupCardProps) {
  const totalOutlets = filteredRows.length;

  const data = useMemo(() => {
    return group.brands
      .map((b) => ({
        label: b.label,
        value: filteredRows.reduce((sum, r) => sum + brandUnits(r, b.fields), 0),
      }))
      .sort((a, b) => b.value - a.value);
  }, [group.brands, filteredRows]);

  const coveredOutlets = useMemo(
    () => filteredRows.filter((r) => group.brands.some((b) => brandPresent(r, b.fields))).length,
    [filteredRows, group.brands],
  );

  const coveragePct = totalOutlets > 0 ? ((coveredOutlets / totalOutlets) * 100).toFixed(1) : "0";
  const chartH = Math.max(180, data.length * 34 + 40);

  if (!fieldsLoaded) {
    return (
      <div className="an-card ba-group-card">
        <div className="ba-group-header">
          <span className="ba-group-dot" style={{ background: group.accentColor }} />
          <h3 className="an-card-title" style={{ margin: 0 }}>{group.label}</h3>
        </div>
        <div className="an-empty ba-loading">
          <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
          Loading equipment data…
        </div>
      </div>
    );
  }

  return (
    <div className="an-card ba-group-card">
      <div className="ba-group-header">
        <span className="ba-group-dot" style={{ background: group.accentColor }} />
        <h3 className="an-card-title" style={{ margin: 0 }}>{group.label}</h3>
        <span className="ba-group-meta">
          {coveredOutlets.toLocaleString()} outlets&nbsp;
          <span className="ba-group-pct">({coveragePct}% coverage)</span>
        </span>
      </div>

      {data.every((d) => d.value === 0) ? (
        <div className="an-empty">No equipment recorded for selected filters</div>
      ) : (
        <ResponsiveContainer width="100%" height={chartH}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 4, bottom: 4 }}>
            <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.05)" />
            <XAxis type="number" stroke="#4a5568" tick={{ fill: "#8fa3b1", fontSize: 11 }} />
            <YAxis
              type="category"
              dataKey="label"
              width={130}
              stroke="#4a5568"
              tick={{ fill: "#c2d0db", fontSize: 11 }}
            />
            <Tooltip
              content={<BrandTooltip totalOutlets={totalOutlets} />}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Bar dataKey="value" radius={[0, 5, 5, 0]} maxBarSize={24}>
              {data.map((_, i) => (
                <Cell key={i} fill={group.accentColor} opacity={Math.max(0.35, 0.9 - i * 0.05)} />
              ))}
              <LabelList
                dataKey="value"
                position="right"
                fill="#f0f4f8"
                fontSize={11}
                formatter={(v: unknown) => Number(v).toLocaleString()}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface BrandAnalysisProps {
  allFields: RawField[];
  rawRows: Record<string, unknown>[];
  filteredIds: Set<string>;
  objectIdField: string;
  statusField?: string;
  loading: boolean;
  onNeedFields?: (names: string[]) => void;
}

export default function BrandAnalysis({
  allFields,
  rawRows,
  filteredIds,
  objectIdField,
  statusField,
  loading,
  onNeedFields,
}: BrandAnalysisProps) {
  useEffect(() => {
    if (onNeedFields) onNeedFields(ALL_BRAND_FIELDS);
  }, [onNeedFields]);

  const fieldsLoaded = useMemo(() => {
    if (rawRows.length === 0) return false;
    const sample = rawRows[0];
    return ALL_BRAND_FIELDS.some((f) => f in sample);
  }, [rawRows]);

  const availableFieldNames = useMemo(
    () => new Set(allFields.map((f) => f.name.toLowerCase())),
    [allFields],
  );

  const [exporting, setExporting] = useState(false);
  const filteredCount = filteredIds.size;

  const filteredRows = useMemo(
    () => rawRows.filter((r) => filteredIds.has(String(r[objectIdField]))),
    [rawRows, filteredIds, objectIdField],
  );

  // Competitive presence is only meaningful for surveyed outlets. Fall back to
  // all filtered rows until the status field is available, so cards aren't blank.
  const successRows = useMemo(() => {
    if (!statusField) return filteredRows;
    const visited = filteredRows.filter((r) => isSuccessfulVisit(r[statusField]));
    return visited.length > 0 ? visited : filteredRows;
  }, [filteredRows, statusField]);

  // Category handling penetration across surveyed outlets.
  const handlingStats = useMemo(() => {
    if (!fieldsLoaded || successRows.length === 0) return null;
    return HANDLING_FIELDS
      .filter((h) => availableFieldNames.size === 0 || availableFieldNames.has(h.field.toLowerCase()))
      .map((h) => {
        const dealing = successRows.filter((r) => isPresent(r[h.field])).length;
        return {
          field: h.field,
          label: h.label,
          dealing,
          total: successRows.length,
          pct: successRows.length > 0 ? (dealing / successRows.length) * 100 : 0,
        };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [fieldsLoaded, successRows, availableFieldNames]);

  const handleExport = useCallback(() => {
    const rows = rawRows.filter((r) => filteredIds.has(String(r[objectIdField])));
    if (!rows.length) return;
    setExporting(true);
    setTimeout(() => {
      try {
        const allKeys = Object.keys(rows[0]);
        const brandKeys = ALL_BRAND_FIELDS.filter((f) => allKeys.includes(f));
        const basicKeys = allKeys.filter((k) => !ALL_BRAND_FIELDS.includes(k));
        const colOrder = [...basicKeys, ...brandKeys];
        downloadExcel(rows, colOrder, "Cold Equipment", `K_Group_Cold_Equipment_${todayStr()}`);
      } finally {
        setExporting(false);
      }
    }, 0);
  }, [rawRows, filteredIds, objectIdField]);

  return (
    <div className="analytics-view ba-view">
      {/* ── toolbar ── */}
      <div className="an-bar">
        <span className="an-bar-count">
          {loading
            ? "Loading data…"
            : `${filteredCount.toLocaleString()} outlets · cooler & equipment landscape`}
        </span>
        {!fieldsLoaded && !loading && (
          <span className="ba-fetching">
            <div className="spinner" style={{ width: 12, height: 12, borderWidth: 2, display: "inline-block" }} />
            Fetching equipment fields…
          </span>
        )}
        <button
          className="panel-export-btn"
          onClick={handleExport}
          disabled={exporting || !fieldsLoaded || filteredCount === 0}
          title="Export to Excel"
        >
          {exporting ? (
            <div className="spinner" style={{ width: 11, height: 11, borderWidth: 2, display: "inline-block" }} />
          ) : (
            <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
              <path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M1 10v1a2 2 0 002 2h8a2 2 0 002-2v-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          )}
          {exporting ? "Exporting…" : "Export Excel"}
        </button>
      </div>

      {/* ── Category handling penetration ── */}
      {handlingStats && handlingStats.length > 0 && (
        <div className="ba-dealing-section">
          <div className="ba-dealing-head">
            <h3 className="ba-dealing-title">Category Handling Penetration</h3>
            <span className="ba-dealing-note">
              Share of successfully-visited outlets dealing in each category
              {successRows.length > 0 && <> · base {successRows.length.toLocaleString()}</>}
            </span>
          </div>
          <div className="ba-kpi-row">
            {handlingStats.map((h) => (
              <div key={h.field} className="ba-kpi-card">
                <span className="ba-kpi-dot" style={{ background: "#14A38B" }} />
                <span className="ba-kpi-label">{h.label}</span>
                <span className="ba-kpi-pct" style={{ color: "#14A38B" }}>{h.pct.toFixed(1)}%</span>
                <span className="ba-kpi-sub">
                  {h.dealing.toLocaleString()} of {h.total.toLocaleString()} outlets
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Per-group equipment bar charts ── */}
      <div className="ba-groups">
        {BRAND_GROUPS.map((group) => {
          const anyFieldExists = group.brands.some((b) =>
            b.fields.some((f) => availableFieldNames.has(f.toLowerCase())),
          );
          return (
            <GroupCard
              key={group.id}
              group={group}
              filteredRows={successRows}
              fieldsLoaded={fieldsLoaded && (anyFieldExists || allFields.length === 0)}
            />
          );
        })}
      </div>
    </div>
  );
}
