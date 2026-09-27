import { useMemo } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList,
} from "recharts";
import { Outlet } from "../types";

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    name: string;
    payload: { fill?: string; name?: string };
  }>;
  total: number;
}

interface AnalyticsProps {
  outlets: Outlet[];
  loading: boolean;
  onRefresh: () => void;
  compact?: boolean;
}

const SLICE_COLORS = [
  "#D4A853", "#14b8a6", "#3b82f6", "#a855f7", "#ec4899",
  "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#10b981",
  "#f97316", "#6366f1", "#d946ef", "#84cc16", "#eab308",
];

const STATUS_COLORS: Record<string, string> = {
  Active: "#22c55e",
  Inactive: "#ef4444",
  Pending: "#f59e0b",
};

const CHART_HEIGHT = 240;
const SEG_HEIGHT = 360;

function countBy(outlets: Outlet[], key: keyof Outlet): { name: string; value: number }[] {
  const map: Record<string, number> = {};
  for (const o of outlets) {
    const raw = String(o[key] ?? "").trim();
    if (!raw || raw === "Unknown" || raw === "null" || raw === "undefined") continue;
    map[raw] = (map[raw] || 0) + 1;
  }
  return Object.entries(map)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function PieTooltip({ active, payload, total }: ChartTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0];
  const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
  return (
    <div className="an-tooltip">
      <span className="an-tooltip-name" style={{ color: d.payload.fill }}>{d.name}</span>
      <span className="an-tooltip-val">{d.value.toLocaleString()} outlets · {pct}%</span>
    </div>
  );
}

function BarTooltip({ active, payload, total }: ChartTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0];
  const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
  return (
    <div className="an-tooltip">
      <span className="an-tooltip-name">{d.payload.name}</span>
      <span className="an-tooltip-val">{d.value.toLocaleString()} outlets · {pct}%</span>
    </div>
  );
}

function DonutCard({
  title, data, total,
}: { title: string; data: { name: string; value: number }[]; total: number }) {
  return (
    <div className="an-card an-chart-card">
      <h3 className="an-card-title">{title}</h3>
      {data.length === 0 ? (
        <div className="an-empty">No data available</div>
      ) : (
        <div className="an-donut-wrap">
          <div className="an-donut-chart">
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={86}
                  paddingAngle={1.5}
                  stroke="var(--surface)"
                  strokeWidth={2}
                >
                  {data.map((_, i) => (
                    <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip total={total} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="an-legend" style={{ maxHeight: CHART_HEIGHT }}>
            {data.map((d, i) => {
              const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
              return (
                <li key={d.name} className="an-legend-item">
                  <span className="an-legend-dot" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                  <span className="an-legend-name" title={d.name}>{d.name}</span>
                  <span className="an-legend-val">{d.value.toLocaleString()}</span>
                  <span className="an-legend-pct">{pct}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, color, icon }: {
  label: string; value: string; sub: string; color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="an-kpi-card">
      <div className="an-kpi-icon" style={{ background: `${color}18`, color }}>
        {icon}
      </div>
      <div className="an-kpi-value" style={{ color }}>{value}</div>
      <div className="an-kpi-label">{label}</div>
      <div className="an-kpi-sub">{sub}</div>
    </div>
  );
}

export default function Analytics({ outlets, loading, onRefresh, compact = false }: AnalyticsProps) {
  const total = outlets.length;

  const bySegmentation = useMemo(() => countBy(outlets, "segmentation"), [outlets]);
  const byOutletType = useMemo(() => countBy(outlets, "outletType"), [outlets]);
  const byDistrict = useMemo(() => countBy(outlets, "district"), [outlets]);
  const byRegion = useMemo(() => countBy(outlets, "region"), [outlets]);

  const statusData = useMemo(() => {
    const active = outlets.filter((o) => o.status === "Active").length;
    const inactive = outlets.filter((o) => o.status === "Inactive").length;
    const pending = outlets.filter((o) => o.status === "Pending").length;
    return [
      { name: "Active", value: active, color: "#22c55e" },
      { name: "Inactive", value: inactive, color: "#ef4444" },
      { name: "Pending", value: pending, color: "#f59e0b" },
    ].filter((d) => d.value > 0);
  }, [outlets]);

  const kpis = useMemo(() => {
    const active = outlets.filter((o) => o.status === "Active").length;
    const inactive = outlets.filter((o) => o.status === "Inactive").length;
    const regions = new Set(outlets.map((o) => o.region).filter((r) => r !== "Unknown")).size;
    const districts = new Set(outlets.map((o) => o.district).filter((d) => d !== "Unknown")).size;
    const types = new Set(outlets.map((o) => o.outletType).filter((t) => t !== "Unknown")).size;
    const segs = new Set(outlets.map((o) => o.segmentation).filter((s) => s !== "Unknown")).size;
    const activePct = total > 0 ? Math.round((active / total) * 100) : 0;
    return { active, inactive, regions, districts, types, segs, activePct };
  }, [outlets, total]);

  const districtHeight = Math.max(SEG_HEIGHT, byDistrict.length * 32 + 50);

  return (
    <div className="analytics-view">
      <div className="an-bar">
        <span className="an-bar-count">
          {loading ? "Loading data…" : `${total.toLocaleString()} outlets analyzed`}
        </span>
        <button className="an-refresh-btn" onClick={onRefresh} disabled={loading}>
          <svg viewBox="0 0 16 16" fill="none" width="13" height="13" className={loading ? "an-spin" : ""}>
            <path d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2v3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* KPI Row */}
      <div className="an-kpi-row">
        <KpiCard
          label="Total Outlets" value={total.toLocaleString()} sub="in current view"
          color="#D4A853"
          icon={<svg viewBox="0 0 16 16" fill="none" width="18" height="18"><path d="M3 5.5V13h10V5.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M1.5 3.5h13l.7 2a2 2 0 01-3.8.5 2 2 0 01-3.8 0 2 2 0 01-3.8 0L1.5 3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>}
        />
        <KpiCard
          label="Successfully Surveyed" value={kpis.active.toLocaleString()} sub={`${kpis.activePct}% survey rate`}
          color="#22c55e"
          icon={<svg viewBox="0 0 16 16" fill="none" width="18" height="18"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5.5 8.5l1.5 1.5 3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        />
        <KpiCard
          label="Emirates" value={String(kpis.regions)} sub={`${kpis.districts} districts`}
          color="#3b82f6"
          icon={<svg viewBox="0 0 16 16" fill="none" width="18" height="18"><path d="M8 1.5C6 1.5 4.5 3 4.5 5c0 2.5 3.5 7 3.5 7s3.5-4.5 3.5-7C11.5 3 10 1.5 8 1.5z" stroke="currentColor" strokeWidth="1.3"/><circle cx="8" cy="5" r="1.2" fill="currentColor"/></svg>}
        />
        <KpiCard
          label="Outlet Types" value={String(kpis.types)} sub={`${kpis.segs} segments`}
          color="#a855f7"
          icon={<svg viewBox="0 0 16 16" fill="none" width="18" height="18"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>}
        />
      </div>

      {/* Donut Charts */}
      <div className="an-grid an-grid--donuts">
        <DonutCard title="Store Segmentation" data={bySegmentation} total={total} />
        <DonutCard title="By Outlet Type" data={byOutletType} total={total} />
      </div>

      {/* Status Donut + Region breakdown */}
      {!compact && (
        <>
          <div className="an-grid an-grid--donuts">
            <div className="an-card an-chart-card">
              <h3 className="an-card-title">Status Breakdown</h3>
              {statusData.length === 0 ? (
                <div className="an-empty">No data available</div>
              ) : (
                <div className="an-donut-wrap">
                  <div className="an-donut-chart">
                    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                      <PieChart>
                        <Pie
                          data={statusData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={52}
                          outerRadius={86}
                          paddingAngle={2}
                          stroke="var(--surface)"
                          strokeWidth={2}
                        >
                          {statusData.map((d) => (
                            <Cell key={d.name} fill={STATUS_COLORS[d.name] ?? "#64748b"} />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip total={total} />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="an-legend" style={{ maxHeight: CHART_HEIGHT }}>
                    {statusData.map((d) => {
                      const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
                      return (
                        <li key={d.name} className="an-legend-item">
                          <span className="an-legend-dot" style={{ background: d.color }} />
                          <span className="an-legend-name">{d.name}</span>
                          <span className="an-legend-val">{d.value.toLocaleString()}</span>
                          <span className="an-legend-pct">{pct}%</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
            <DonutCard title="By Emirate" data={byRegion} total={total} />
          </div>

          {/* District bar chart */}
          <div className="an-card an-seg-card">
            <h3 className="an-card-title">By District</h3>
            {byDistrict.length === 0 ? (
              <div className="an-empty">No data available</div>
            ) : (
              <ResponsiveContainer width="100%" height={districtHeight}>
                <BarChart
                  data={byDistrict}
                  layout="vertical"
                  margin={{ top: 4, right: 56, left: 4, bottom: 4 }}
                >
                  <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" stroke="#4a5568" tick={{ fill: "#8fa3b1", fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={170}
                    stroke="#4a5568"
                    tick={{ fill: "#c2d0db", fontSize: 11 }}
                  />
                  <Tooltip content={<BarTooltip total={total} />} cursor={{ fill: "rgba(212,168,83,0.08)" }} />
                  <Bar dataKey="value" radius={[0, 5, 5, 0]} maxBarSize={26}>
                    {byDistrict.map((_, i) => (
                      <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
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
        </>
      )}
    </div>
  );
}
