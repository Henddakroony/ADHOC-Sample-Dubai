import { useMemo } from "react";
import { Outlet } from "../types";

interface StatsCardsProps {
  outlets: Outlet[];
  allOutlets: Outlet[];
}

function StatCard({
  icon, label, value, sub, accent,
}: {
  icon: React.ReactNode; label: string; value: string; sub: string; accent: string;
}) {
  return (
    <div className="stat-card">
      <span className="stat-card-icon" style={{ background: `${accent}22`, color: accent }}>
        {icon}
      </span>
      <div className="stat-card-body">
        <span className="stat-card-label">{label}</span>
        <span className="stat-card-value">{value}</span>
        <span className="stat-card-sub">{sub}</span>
      </div>
    </div>
  );
}

export default function StatsCards({ outlets, allOutlets }: StatsCardsProps) {
  const stats = useMemo(() => {
    const active = outlets.filter((o) => o.status === "Active").length;
    const total = outlets.length;
    const universe = allOutlets.length;
    const regions = new Set(outlets.map((o) => o.region).filter((r) => r !== "Unknown")).size;
    const districts = new Set(outlets.map((o) => o.district).filter((d) => d !== "Unknown")).size;
    return { active, total, universe, regions, districts };
  }, [outlets, allOutlets]);

  return (
    <div className="stats-cards-bar">
      <StatCard
        accent="#D4A853"
        label="TOTAL OUTLETS"
        value={stats.total.toLocaleString()}
        sub={`of ${stats.universe.toLocaleString()} in universe`}
        icon={
          <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
            <path d="M3 6.5V17h14V6.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
            <path d="M1.5 4h17l1 2.5a2.5 2.5 0 01-5 0 2.5 2.5 0 01-5 0 2.5 2.5 0 01-5 0L1.5 4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
            <rect x="7" y="11" width="6" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
        }
      />
      <StatCard
        accent="#14b8a6"
        label="ACTIVE"
        value={stats.active.toLocaleString()}
        sub={stats.total > 0 ? `${Math.round((stats.active / stats.total) * 100)}% of filtered` : "–"}
        icon={
          <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
            <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M6.5 10.5l2 2 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        }
      />
      <StatCard
        accent="#3b82f6"
        label="EMIRATES"
        value={String(stats.regions)}
        sub={`${stats.districts} districts`}
        icon={
          <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
            <path d="M10 2C7.5 2 5.5 4 5.5 6.5c0 3.5 4.5 9 4.5 9s4.5-5.5 4.5-9C14.5 4 12.5 2 10 2z" stroke="currentColor" strokeWidth="1.4"/>
            <circle cx="10" cy="6.5" r="1.5" fill="currentColor"/>
          </svg>
        }
      />
    </div>
  );
}
