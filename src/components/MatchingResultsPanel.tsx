import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useMatchingResults } from "../hooks/useMatchingResults";
import { downloadExcel, todayStr } from "../utils/exportExcel";

/* Status → colour. Semantic first (matched = green, unmatched = red,
   review/pending = amber, new = blue), then a rotating palette. */
const PALETTE = ["#3b82f6", "#a855f7", "#14b8a6", "#ec4899", "#8b5cf6", "#f97316", "#0ea5e9", "#eab308"];

const MATCHED_RE = /\b(match|matched|linked|confirm|confirmed|resolved|auto|exact|found|success|ok|valid)\b/i;
const NEGATIVE_RE = /\b(no|not|non|un|unmatch|unmatched|fail|failed|pending|review|manual|missing|error|invalid|duplicate|dup)\b/i;
const REVIEW_RE = /\b(review|pending|manual|check|hold|queue)\b/i;
const NEW_RE = /\b(new|added|created|fresh)\b/i;
const FINISHED_STATUSES = new Set(["finished", "completed", "done"]);

function isMatched(name: string): boolean {
  return MATCHED_RE.test(name) && !NEGATIVE_RE.test(name);
}

function isFinished(name: string): boolean {
  return FINISHED_STATUSES.has(name.trim().toLowerCase());
}

function colourFor(name: string, idx: number): string {
  const n = name.toLowerCase();
  if (isMatched(name)) return "#22c55e";
  if (REVIEW_RE.test(n)) return "#f59e0b";
  if (NEGATIVE_RE.test(n)) return "#ef4444";
  if (NEW_RE.test(n)) return "#3b82f6";
  return PALETTE[idx % PALETTE.length];
}

/* Count-up animation for the KPI numbers. */
function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (target - from) * eased);
      setValue(next);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

/* ── Match-rate gauge ─────────────────────────────────────────────────────── */

function Gauge({ pct }: { pct: number }) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const [dash, setDash] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDash((pct / 100) * C));
    return () => cancelAnimationFrame(id);
  }, [pct, C]);
  const shown = useCountUp(Math.round(pct * 10)) / 10;

  return (
    <div className="mr-gauge">
      <svg viewBox="0 0 128 128" width="128" height="128">
        <defs>
          <linearGradient id="mr-gauge-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--brand)" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>
        <circle cx="64" cy="64" r={R} className="mr-gauge-track" />
        <circle
          cx="64" cy="64" r={R}
          className="mr-gauge-fill"
          stroke="url(#mr-gauge-grad)"
          strokeDasharray={C}
          strokeDashoffset={C - dash}
          transform="rotate(-90 64 64)"
        />
      </svg>
      <div className="mr-gauge-center">
        <span className="mr-gauge-value">{shown.toFixed(1)}<i>%</i></span>
        <span className="mr-gauge-label">Match rate</span>
      </div>
    </div>
  );
}

/* ── KPI card ─────────────────────────────────────────────────────────────── */

function KpiCard({ name, count, total, colour, delayMs }: {
  name: string; count: number; total: number; colour: string; delayMs: number;
}) {
  const shown = useCountUp(count);
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="mr-kpi" style={{ animationDelay: `${delayMs}ms`, "--kpi": colour } as React.CSSProperties}>
      <span className="mr-kpi-top">
        <span className="mr-kpi-dot" style={{ background: colour }} />
        <span className="mr-kpi-name" title={name}>{name}</span>
      </span>
      <span className="mr-kpi-value">{shown.toLocaleString()}</span>
      <span className="mr-kpi-foot">
        <span className="mr-kpi-pct">{pct.toFixed(1)}%</span>
        <span className="mr-kpi-spark"><span style={{ width: `${pct}%`, background: colour }} /></span>
      </span>
    </div>
  );
}

/* ── Project card ─────────────────────────────────────────────────────────── */

interface ProjectCardData {
  name: string;
  total: number;
  matched: number;
  unmatched: number;
  rate: number;
  statuses: Array<{ name: string; count: number; colour: string }>;
}

interface BreakdownGroup {
  name: string;
  count: number;
  colour: string;
}

function BreakdownTable({ title, label, groups, total }: {
  title: string;
  label: string;
  groups: BreakdownGroup[];
  total: number;
}) {
  const [showAllValues, setShowAllValues] = useState(false);
  const { rows, hiddenCount } = useMemo(() => {
    const underOnePercent = total > 0
      ? groups.filter((group) => (group.count / total) * 100 < 1)
      : [];
    const hiddenNames = new Set(underOnePercent.map((group) => group.name));
    const hiddenCount = underOnePercent.length;

    if (showAllValues || hiddenCount === 0) {
      return { rows: groups, hiddenCount };
    }

    const other: BreakdownGroup & { isOther: true } = {
      name: "Other",
      count: underOnePercent.reduce((sum, group) => sum + group.count, 0),
      colour: "#64748b",
      isOther: true,
    };
    const visible = groups.filter((group) => !hiddenNames.has(group.name));
    return {
      rows: [...visible, other].sort((a, b) => b.count - a.count),
      hiddenCount,
    };
  }, [groups, total, showAllValues]);

  const maxCount = groups[0]?.count ?? 0;

  return (
    <div className="an-card mr-table-card">
      <div className="mr-breakdown-heading">
        <h3 className="an-card-title">{title}</h3>
        {showAllValues && hiddenCount > 0 && (
          <button
            type="button"
            className="mr-breakdown-toggle"
            onClick={() => setShowAllValues(false)}
          >
            Show fewer
          </button>
        )}
      </div>
      <div className="mr-table-wrap">
        <table className="mr-table">
          <thead>
            <tr>
              <th>#</th><th>{label}</th><th>Records</th><th>Share</th><th className="mr-bar-col" />
            </tr>
          </thead>
          <tbody>
            {rows.map((group, index) => {
              const isOther = "isOther" in group && group.isOther;
              const pct = total > 0 ? (group.count / total) * 100 : 0;
              const barW = maxCount > 0 ? Math.min((group.count / maxCount) * 100, 100) : 0;
              return (
                <tr key={isOther ? "__other__" : group.name}>
                  <td className="mr-rank">{index + 1}</td>
                  <td className="mr-cell-name">
                    {isOther ? (
                      <button
                        type="button"
                        className="mr-other-toggle"
                        onClick={() => setShowAllValues(true)}
                        aria-expanded={showAllValues}
                        title={`Show all ${hiddenCount} values below 1%`}
                      >
                        <span className="mr-legend-dot" style={{ background: group.colour }} />
                        <span>Other</span>
                        <span className="mr-other-hint">{hiddenCount} values · view all</span>
                      </button>
                    ) : (
                      <>
                        <span className="mr-legend-dot" style={{ background: group.colour }} />
                        <span className="mr-breakdown-value" title={group.name}>{group.name}</span>
                      </>
                    )}
                  </td>
                  <td className="mr-num">{group.count.toLocaleString()}</td>
                  <td className="mr-num mr-muted">{pct.toFixed(pct < 1 ? 2 : 1)}%</td>
                  <td className="mr-bar-col">
                    <span className="mr-bar-track">
                      <span className="mr-bar-fill" style={{ width: `${barW}%`, background: group.colour }} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProjectCard({ project, selected, showRate, delayMs, onClick }: {
  project: ProjectCardData; selected: boolean; showRate: boolean; delayMs: number; onClick: () => void;
}) {
  const shown = useCountUp(project.total);
  const rate = useCountUp(Math.round(project.rate * 10)) / 10;
  return (
    <button
      type="button"
      className={`mr-proj${selected ? " is-selected" : ""}`}
      style={{ animationDelay: `${delayMs}ms` }}
      onClick={onClick}
      aria-pressed={selected}
      title={`${project.name} — ${project.total.toLocaleString()} records`}
    >
      <span className="mr-proj-name" title={project.name}>{project.name}</span>
      <span className="mr-proj-total">{shown.toLocaleString()}<i>records</i></span>

      {showRate && (
        <>
          <span className="mr-proj-rate">
            <span className="mr-proj-rate-bar"><span style={{ width: `${project.rate}%` }} /></span>
            <span className="mr-proj-rate-val">{rate.toFixed(1)}%</span>
          </span>
          <span className="mr-proj-counts">
            <span className="mr-proj-ok">{project.matched.toLocaleString()} matched</span>
            <span className="mr-proj-no">{project.unmatched.toLocaleString()} other</span>
          </span>
        </>
      )}

      {/* Mini status distribution strip */}
      <span className="mr-proj-strip" aria-hidden>
        {project.statuses.map((s) => {
          const w = project.total > 0 ? (s.count / project.total) * 100 : 0;
          return <span key={s.name} style={{ width: `${w}%`, background: s.colour }} title={`${s.name} · ${s.count.toLocaleString()}`} />;
        })}
      </span>
    </button>
  );
}

/* ── Panel ────────────────────────────────────────────────────────────────── */

export default function MatchingResultsPanel() {
  const {
    configured, loading, error, authError,
    statusField, commentField, projectField, total, groups, commentGroups, projects, fetchedAt, reload, fetchAllRows,
  } = useMatchingResults();

  const [exporting, setExporting] = useState(false);
  const [exportPct, setExportPct] = useState(0);
  const [exportErr, setExportErr] = useState<string | null>(null);

  // Drill-in: when a project card is selected the whole panel below reflects
  // just that project's records (derived client-side from the cross-tab).
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const activeProject = useMemo(
    () => (selectedProject ? projects.find((p) => p.name === selectedProject) ?? null : null),
    [selectedProject, projects],
  );

  const activeGroups = activeProject
    ? [...activeProject.statuses].sort((a, b) => b.count - a.count)
    : groups;
  const activeCommentGroups = activeProject
    ? [...activeProject.comments].sort((a, b) => b.count - a.count)
    : commentGroups;
  const activeTotal = activeProject ? activeProject.total : total;

  const enriched = useMemo(
    () => activeGroups.map((g, i) => ({ ...g, colour: colourFor(g.name, i), matched: isMatched(g.name) })),
    [activeGroups],
  );
  const enrichedComments = useMemo(
    () => activeCommentGroups.map((g, i) => ({ ...g, colour: colourFor(g.name, i) })),
    [activeCommentGroups],
  );

  const matchedTotal = useMemo(
    () => enriched.filter((g) => g.matched).reduce((s, g) => s + g.count, 0),
    [enriched],
  );
  const finishedTotal = useMemo(
    () => {
      if (projects.length === 0) {
        return groups.filter((g) => isFinished(g.name)).reduce((sum, g) => sum + g.count, 0);
      }

      return projects.reduce((sum, project) => {
        const projectName = project.name.trim().toLowerCase().replace(/^project\s+/, "");
        if (projectName === "fine") return sum + project.total;

        const finishedStatuses = project.statuses.filter((status) => {
          const statusName = status.name.trim().toLowerCase();
          if (projectName === "americana" || projectName === "afi") {
            return statusName === "done";
          }
          return isFinished(status.name);
        });
        return sum + finishedStatuses.reduce((count, status) => count + status.count, 0);
      }, 0);
    },
    [projects, groups],
  );

  // When no group reads as a match/unmatch state (e.g. a source breakdown like
  // FINE / AFI / Americana), the "match rate" framing is meaningless — fall back
  // to a neutral distribution view.
  const hasMatchSemantics = matchedTotal > 0;

  const matchRate = activeTotal === 0 ? 0 : (matchedTotal / activeTotal) * 100;

  const topCount = enriched[0]?.count ?? 0;

  // Enrich project cards with matched/unmatched + a match rate, reusing the
  // same status-name semantics as the status breakdown.
  const projectCards = useMemo(
    () => projects.map((p) => {
      const matched = p.statuses.filter((s) => isMatched(s.name)).reduce((sum, s) => sum + s.count, 0);
      return {
        name: p.name,
        total: p.total,
        matched,
        unmatched: p.total - matched,
        rate: p.total > 0 ? (matched / p.total) * 100 : 0,
        statuses: p.statuses.map((s, i) => ({ ...s, colour: colourFor(s.name, i) })),
      };
    }),
    [projects],
  );
  const projectsHaveMatchSemantics = projectCards.some((p) => p.matched > 0);

  // Export matching records (all fields). When `projectName` is given and the
  // layer has a project field, the export is scoped to that project; otherwise
  // it ships every record. `key` distinguishes which button shows progress.
  const [exportKey, setExportKey] = useState<"scope" | null>(null);
  const runExport = useCallback(async (projectName: string | null, key: "scope") => {
    if (exporting) return;
    setExporting(true);
    setExportKey(key);
    setExportPct(0);
    setExportErr(null);
    try {
      const scoped = projectName && projectField;
      const where = scoped
        ? `${projectField} = '${projectName!.replace(/'/g, "''")}'`
        : "1=1";
      const { rows, fieldOrder } = await fetchAllRows(
        (loaded, tot) => setExportPct(tot > 0 ? Math.round((loaded / tot) * 100) : 0),
        where,
      );
      if (rows.length === 0) {
        setExportErr("No records returned to export.");
        return;
      }
      // Matching Status / Comment first, then the rest of the layer's fields.
      const priority = [statusField, commentField].filter((f): f is string => !!f);
      const rest = fieldOrder.filter((f) => !priority.includes(f));
      const known = new Set(fieldOrder);
      for (const k of Object.keys(rows[0])) {
        if (!known.has(k) && !priority.includes(k)) rest.push(k);
      }
      const safe = scoped ? `_${projectName!.replace(/[^\w-]+/g, "_")}` : "";
      downloadExcel(rows, [...priority, ...rest], "Matching Data", `Matching_Results${safe}_${todayStr()}`);
    } catch (err) {
      console.error("[MatchingResultsPanel] export failed", err);
      setExportErr(String((err as Error)?.message ?? err));
    } finally {
      setExporting(false);
      setExportKey(null);
    }
  }, [exporting, fetchAllRows, projectField, statusField, commentField]);

  // Toolbar button follows the current view: selected project, else all.
  const handleExport = useCallback(
    () => runExport(selectedProject, "scope"),
    [runExport, selectedProject],
  );

  /* ── States ── */

  if (!configured) {
    return (
      <div className="analytics-view mr-view">
        <div className="mr-empty">
          <MsgIcon />
          <h3>Matching Results not configured</h3>
          <p>Set <code>VITE_MATCHING_RESULTS_URL</code> to the ArcGIS feature-layer REST endpoint, then reload.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="analytics-view mr-view">
      {/* Toolbar */}
      <div className="an-bar mr-bar">
        <div className="mr-bar-lead">
          <span className="an-bar-count">
            {loading ? "Syncing matching results…" : `${activeTotal.toLocaleString()} records${statusField ? ` · by ${statusField.replace(/_/g, " ")}` : ""}`}
          </span>
          {activeProject && (
            <button className="mr-proj-chip" onClick={() => setSelectedProject(null)} title="Clear project filter">
              {activeProject.name}
              <svg viewBox="0 0 12 12" width="11" height="11" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          )}
          {fetchedAt && !loading && (
            <span className="mr-stamp">
              <span className="mr-stamp-dot" /> updated {timeAgo(fetchedAt)}
            </span>
          )}
          {exportErr && (
            <span className="mr-export-err" role="alert">{exportErr}</span>
          )}
        </div>
        <div className="mr-bar-actions">
          <button className="mr-refresh" onClick={reload} disabled={loading || exporting} title="Refresh">
            <svg viewBox="0 0 16 16" fill="none" width="12" height="12" className={loading ? "mr-spin" : ""}>
              <path d="M13.5 8a5.5 5.5 0 11-1.6-3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M11.5 1.5v3h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Refresh
          </button>
          <button
            className="panel-export-btn"
            onClick={handleExport}
            disabled={loading || exporting || activeTotal === 0}
            title={activeProject ? `Export ${activeProject.name} records to Excel` : "Export every matching record to Excel"}
          >
            {exporting && exportKey === "scope" ? (
              <div className="spinner" style={{ width: 11, height: 11, borderWidth: 2, display: "inline-block" }} />
            ) : (
              <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
                <path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M1 10v1a2 2 0 002 2h8a2 2 0 002-2v-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            )}
            {exporting && exportKey === "scope"
              ? `Exporting… ${exportPct}%`
              : activeProject ? `Export ${activeProject.name}` : "Export Excel"}
          </button>
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="mr-skeleton">
          <div className="mr-sk-hero" />
          <div className="mr-sk-kpis">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="mr-sk-card" />)}
          </div>
          <div className="mr-sk-rail" />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className={`mr-error${authError ? " is-auth" : ""}`}>
          <svg viewBox="0 0 16 16" fill="none" width="18" height="18">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 4.5v4.5M8 11v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <div>
            <strong>{authError ? "Layer access denied" : "Couldn't load matching results"}</strong>
            <p>{error}</p>
            {authError && (
              <p className="mr-error-hint">
                The current ArcGIS key was rejected for this layer. Share the layer with that key,
                or set <code>VITE_MATCHING_RESULTS_API_KEY</code> to a key that can read it.
              </p>
            )}
            <button className="mr-refresh" onClick={reload}>Try again</button>
          </div>
        </div>
      )}

      {/* Data */}
      {!loading && !error && enriched.length > 0 && (
        <>
          {/* By project (Data_Source): one intelligent card per project. */}
          {projectCards.length > 0 && (
            <div className="an-card mr-proj-card">
              <div className="mr-proj-head">
                <h3 className="an-card-title">
                  By project {projectField ? <span className="mr-proj-sub">· {projectField.replace(/_/g, " ")}</span> : null}
                </h3>
                <span className="mr-proj-hint">
                  {activeProject ? "Showing one project — select All customers to clear" : "Select a project to filter"}
                </span>
              </div>
              <div className="mr-proj-grid">
                {/* All customers card resets the project filter; export stays in the toolbar. */}
                <button
                  type="button"
                  className={`mr-proj mr-proj-all${!activeProject ? " is-selected" : ""}`}
                  onClick={() => setSelectedProject(null)}
                  disabled={exporting || total === 0}
                  aria-pressed={!activeProject}
                  title="Show all customers across every project"
                >
                  <span className="mr-proj-all-icon">
                    <svg viewBox="0 0 16 16" fill="none" width="16" height="16">
                      <rect x="2" y="2" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                      <rect x="9.5" y="2" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                      <rect x="2" y="9.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                      <rect x="9.5" y="9.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                    </svg>
                  </span>
                  <span className="mr-proj-name">All customers</span>
                  <span className="mr-proj-total">{total.toLocaleString()}<i>customers</i></span>
                  <span className="mr-proj-all-cta">{finishedTotal.toLocaleString()} finished</span>
                </button>

                {projectCards.map((p, i) => (
                  <ProjectCard
                    key={p.name}
                    project={p}
                    selected={selectedProject === p.name}
                    showRate={projectsHaveMatchSemantics}
                    delayMs={(i + 1) * 50}
                    onClick={() => setSelectedProject((cur) => (cur === p.name ? null : p.name))}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Hero: match-rate gauge when the values are match/unmatch states,
              otherwise a neutral distribution view (e.g. records by source). */}
          <div className="mr-hero">
            {hasMatchSemantics ? (
              <>
                <Gauge pct={matchRate} />
                <div className="mr-hero-stats">
                  <div className="mr-hero-stat">
                    <span className="mr-hero-num">{activeTotal.toLocaleString()}</span>
                    <span className="mr-hero-cap">Total records</span>
                  </div>
                  <div className="mr-hero-stat">
                    <span className="mr-hero-num" style={{ color: "#22c55e" }}>
                      {matchedTotal.toLocaleString()}
                    </span>
                    <span className="mr-hero-cap">Matched</span>
                  </div>
                  <div className="mr-hero-stat">
                    <span className="mr-hero-num" style={{ color: "#ef4444" }}>
                      {(activeTotal - matchedTotal).toLocaleString()}
                    </span>
                    <span className="mr-hero-cap">Unmatched / other</span>
                  </div>
                  <div className="mr-hero-stat">
                    <span className="mr-hero-num">{enriched.length}</span>
                    <span className="mr-hero-cap">Status values</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="mr-hero-stats">
                <div className="mr-hero-stat">
                  <span className="mr-hero-num">{activeTotal.toLocaleString()}</span>
                  <span className="mr-hero-cap">Total records</span>
                </div>
                <div className="mr-hero-stat">
                  <span className="mr-hero-num">{enriched.length}</span>
                  <span className="mr-hero-cap">{statusField === "Data_Source" ? "Sources" : "Groups"}</span>
                </div>
                <div className="mr-hero-stat">
                  <span className="mr-hero-num" style={{ color: "var(--brand)" }}>{enriched[0]?.name ?? "—"}</span>
                  <span className="mr-hero-cap">Largest</span>
                </div>
                <div className="mr-hero-stat">
                  <span className="mr-hero-num">
                    {activeTotal > 0 ? ((topCount / activeTotal) * 100).toFixed(1) : "0"}<i style={{ fontStyle: "normal", fontSize: "0.6em" }}>%</i>
                  </span>
                  <span className="mr-hero-cap">Top share</span>
                </div>
              </div>
            )}
          </div>

          {/* Distribution rail */}
          <div className="mr-rail-wrap">
            <div className="mr-rail" role="img" aria-label="Matching status distribution">
              {enriched.map((g) => {
                const pct = activeTotal > 0 ? (g.count / activeTotal) * 100 : 0;
                return (
                  <span
                    key={g.name}
                    className="mr-rail-seg"
                    style={{ width: `${pct}%`, background: g.colour }}
                    title={`${g.name} · ${g.count.toLocaleString()} (${pct.toFixed(1)}%)`}
                  />
                );
              })}
            </div>
            <div className="mr-rail-legend">
              {enriched.map((g) => (
                <span key={g.name} className="mr-legend-item">
                  <span className="mr-legend-dot" style={{ background: g.colour }} />
                  {g.name}
                </span>
              ))}
            </div>
          </div>

          {/* KPI cards */}
          <div className="mr-kpi-grid">
            {enriched.map((g, i) => (
              <KpiCard key={g.name} name={g.name} count={g.count} total={activeTotal} colour={g.colour} delayMs={i * 60} />
            ))}
          </div>

          <div className={`mr-breakdown-grid${commentField && enrichedComments.length > 0 ? " has-comments" : ""}`}>
            <BreakdownTable
              title={`Breakdown by ${statusField ?? "status"}`}
              label="Status"
              groups={enriched}
              total={activeTotal}
            />
            {commentField && enrichedComments.length > 0 && (
              <BreakdownTable
                title={`Breakdown by ${commentField}`}
                label="Comment"
                groups={enrichedComments}
                total={activeTotal}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MsgIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="34" height="34">
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 1.6v3.2M12 19.2v3.2M1.6 12h3.2M19.2 12h3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
