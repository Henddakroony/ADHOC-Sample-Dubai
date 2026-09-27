import { useCallback, useEffect, useState } from "react";

/**
 * Standalone reader for the "Matching Results" ArcGIS feature layer.
 *
 * This layer is separate from the main outlet service (VITE_OUTLET_LAYER_URL)
 * and may live behind a different API key, so it gets its own env vars:
 *
 *   VITE_MATCHING_RESULTS_URL      – REST endpoint, e.g. …/FeatureServer/7
 *   VITE_MATCHING_RESULTS_API_KEY  – optional; falls back to VITE_ARCGIS_API_KEY
 *
 * The hook lazily discovers the status field from the layer schema, then pulls
 * a grouped count per status value in a single statistics query (with a paged
 * client-side tally as a fallback for layers that don't support statistics).
 */

const RAW_URL = (import.meta.env.VITE_MATCHING_RESULTS_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
const OWN_KEY = (import.meta.env.VITE_MATCHING_RESULTS_API_KEY as string | undefined) ?? "";
const FALLBACK_KEY = (import.meta.env.VITE_ARCGIS_API_KEY as string | undefined) ?? "";
const API_KEY = OWN_KEY || FALLBACK_KEY;

const TIMEOUT_MS = 30_000;

export interface MatchingGroup {
  name: string;
  count: number;
}

/** Per-project (Data_Source) rollup with its status breakdown. */
export interface ProjectSummary {
  name: string;
  total: number;
  statuses: MatchingGroup[];
  comments: MatchingGroup[];
}

export interface MatchingResultsState {
  configured: boolean;
  layerUrl: string;
  loading: boolean;
  error: string | null;
  /** True when the failure looks like a token / permission problem. */
  authError: boolean;
  statusField: string | null;
  commentField: string | null;
  /** Field the "By project" cards group on (usually Data_Source); null if absent. */
  projectField: string | null;
  total: number;
  groups: MatchingGroup[];
  commentGroups: MatchingGroup[];
  /** One entry per project (Data_Source value) with its status breakdown. */
  projects: ProjectSummary[];
  fetchedAt: number | null;
  reload: () => void;
  /**
   * Pulls records from the layer (all fields, paged) for Excel export.
   * Pass a `where` clause to scope the export (e.g. one project); it
   * defaults to every record. `onProgress` fires after each page.
   */
  fetchAllRows: (
    onProgress?: (loaded: number, total: number) => void,
    where?: string,
  ) => Promise<{ rows: Record<string, unknown>[]; fieldOrder: string[] }>;
}

interface ArcgisError {
  code?: number;
  message?: string;
  details?: string[];
}

async function fetchJson(url: string, timeoutMs = TIMEOUT_MS): Promise<Record<string, unknown>> {
  const sep = url.includes("?") ? "&" : "?";
  const fullUrl = API_KEY ? `${url}${sep}token=${encodeURIComponent(API_KEY)}` : url;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(fullUrl, { signal: controller.signal });
  } catch (err) {
    throw new Error(`Network error: ${String(err)}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new Error(`Non-JSON response (HTTP ${res.status})`);
  }

  const errObj = (data as { error?: ArcgisError }).error;
  if (errObj) {
    const parts = [errObj.message, ...(errObj.details ?? [])].filter(
      (p): p is string => typeof p === "string" && p.trim() !== "",
    );
    const text = parts.join(" — ") || `ArcGIS error ${errObj.code ?? "?"}`;
    const e = new Error(text) as Error & { arcgisCode?: number };
    e.arcgisCode = errObj.code;
    throw e;
  }
  return data;
}

function isAuthProblem(err: unknown): boolean {
  const code = (err as { arcgisCode?: number })?.arcgisCode;
  if (code === 403 || code === 499 || code === 498) return true;
  const msg = String((err as Error)?.message ?? "").toLowerCase();
  return msg.includes("token") || msg.includes("permission") || msg.includes("not authorized");
}

/* ── Field detection ────────────────────────────────────────────────────────── */

const STATUS_EXACT = [
  "Matching_Status", "Match_Status", "MatchStatus", "Matching_Result",
  "Match_Result", "MatchResult", "Matching_State", "Status", "Result",
  // Master-data / dedup layers (e.g. K-Group's) have no status column; the
  // meaningful grouping is the source system each record was matched from.
  "Data_Source", "DataSource", "Source", "Data_Src",
];
const COMMENT_EXACT = [
  "Matching_Comment", "Match_Comment", "MatchComment", "Matching_Note",
  "Matching_Notes", "Comment", "Comments", "Notes", "Remark", "Remarks", "Reason",
];
// The "project" each record belongs to. On K-Group's master-data layer this is
// the source system / brand (Fine, Americana, Rabei, Imtenan, …).
const PROJECT_EXACT = [
  "Data_Source", "DataSource", "Source", "Data_Src", "Project", "Project_Name",
  "ProjectName", "Brand",
];

function pickField(fieldNames: string[], exact: string[], fuzzy: (lower: string) => boolean): string | null {
  for (const cand of exact) {
    const hit = fieldNames.find((f) => f.toLowerCase() === cand.toLowerCase());
    if (hit) return hit;
  }
  const fuzzyHit = fieldNames.find((f) => fuzzy(f.toLowerCase()));
  return fuzzyHit ?? null;
}

/* ── Hook ───────────────────────────────────────────────────────────────────── */

export function useMatchingResults(): MatchingResultsState {
  const configured = RAW_URL.trim() !== "";

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const [state, setState] = useState<Omit<MatchingResultsState, "configured" | "layerUrl" | "reload" | "fetchAllRows">>({
    loading: configured,
    error: configured ? null : "VITE_MATCHING_RESULTS_URL is not set",
    authError: false,
    statusField: null,
    commentField: null,
    projectField: null,
    total: 0,
    groups: [],
    commentGroups: [],
    projects: [],
    fetchedAt: null,
  });

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;

    setState((s) => ({ ...s, loading: true, error: null, authError: false }));

    async function load() {
      try {
        /* 1 — schema: find the status + comment fields and the OID field */
        const meta = (await fetchJson(`${RAW_URL}?f=json`)) as {
          fields?: Array<{ name: string; type: string }>;
          objectIdField?: string;
          maxRecordCount?: number;
        };
        if (cancelled) return;

        const fieldNames = (meta.fields ?? []).map((f) => f.name);
        if (fieldNames.length === 0) throw new Error("Layer returned no fields");

        const statusField = pickField(
          fieldNames, STATUS_EXACT,
          (l) => (l.includes("match") && l.includes("status")) || l.endsWith("_status") || l.includes("matchstatus"),
        ) ?? pickField(fieldNames, [], (l) => l.includes("status") || l.includes("match") || l.includes("result"));

        if (!statusField) throw new Error("No matching-status field found on this layer");

        const commentField = pickField(
          fieldNames, COMMENT_EXACT,
          (l) => l.includes("comment") || l.includes("reason") || l.includes("note"),
        );

        // Project field must differ from the status field (so a source-only layer,
        // where statusField already fell back to Data_Source, doesn't group by itself).
        const projectField = pickField(
          fieldNames.filter((f) => f !== statusField), PROJECT_EXACT,
          (l) => l.includes("source") || l.includes("project") || l.includes("brand"),
        );

        const oidField = meta.objectIdField ?? fieldNames.find((f) => /objectid|^fid$|^oid$/i.test(f)) ?? "OBJECTID";
        const pageSize = Math.min(meta.maxRecordCount ?? 1000, 2000);

        const totalRes = (await fetchJson(
          `${RAW_URL}/query?where=1%3D1&returnCountOnly=true&f=json`,
        )) as { count?: number };
        if (cancelled) return;
        if (typeof totalRes.count !== "number" || !Number.isFinite(totalRes.count)) {
          throw new Error("Layer did not return a valid customer count");
        }
        const total = totalRes.count;

        /* 2 — grouped count per status value, single query */
        let groups: MatchingGroup[] | null = null;
        try {
          const stats = encodeURIComponent(JSON.stringify([
            { statisticType: "count", onStatisticField: oidField, outStatisticFieldName: "cnt" },
          ]));
          const gUrl =
            `${RAW_URL}/query?where=1%3D1&groupByFieldsForStatistics=${encodeURIComponent(statusField)}` +
            `&outStatistics=${stats}&f=json`;
          const gRes = (await fetchJson(gUrl)) as {
            features?: Array<{ attributes: Record<string, unknown> }>;
          };
          if (cancelled) return;
          if (Array.isArray(gRes.features)) {
            groups = gRes.features.map((ft) => ({
              name: cleanLabel(ft.attributes[statusField]),
              count: Number(ft.attributes.cnt ?? ft.attributes.CNT ?? 0),
            }));
          }
        } catch (statErr) {
          if (isAuthProblem(statErr)) throw statErr; // don't mask a permission failure
          console.warn("[useMatchingResults] statistics query failed, falling back to paging", statErr);
        }

        /* 2b — fallback: page through just the status field and tally locally */
        if (!groups) {
          const countRes = (await fetchJson(
            `${RAW_URL}/query?where=1%3D1&returnCountOnly=true&f=json`,
          )) as { count?: number };
          if (cancelled) return;
          const totalCount = countRes.count ?? 0;
          const pages = totalCount > 0 ? Math.ceil(totalCount / pageSize) : 1;
          const tally: Record<string, number> = {};
          for (let p = 0; p < pages; p++) {
            if (cancelled) return;
            const pageRes = (await fetchJson(
              `${RAW_URL}/query?where=1%3D1&outFields=${encodeURIComponent(statusField)}` +
              `&returnGeometry=false&resultOffset=${p * pageSize}&resultRecordCount=${pageSize}&f=json`,
            )) as { features?: Array<{ attributes: Record<string, unknown> }> };
            for (const ft of pageRes.features ?? []) {
              const key = cleanLabel(ft.attributes[statusField]);
              tally[key] = (tally[key] ?? 0) + 1;
            }
          }
          groups = Object.entries(tally).map(([name, count]) => ({ name, count }));
        }

        const cleaned = groups
          .filter((g) => g.name !== "" && g.name.toLowerCase() !== "null" && g.name.toLowerCase() !== "undefined")
          .sort((a, b) => b.count - a.count);

        /* 2c — grouped counts per matching comment. */
        let commentGroups: MatchingGroup[] = [];
        if (commentField) {
          try {
            const stats = encodeURIComponent(JSON.stringify([
              { statisticType: "count", onStatisticField: oidField, outStatisticFieldName: "cnt" },
            ]));
            const cUrl =
              `${RAW_URL}/query?where=1%3D1&groupByFieldsForStatistics=${encodeURIComponent(commentField)}` +
              `&outStatistics=${stats}&f=json`;
            const cRes = (await fetchJson(cUrl)) as {
              features?: Array<{ attributes: Record<string, unknown> }>;
              exceededTransferLimit?: boolean;
            };
            if (cancelled) return;
            if (cRes.exceededTransferLimit || !Array.isArray(cRes.features)) {
              throw new Error("Comment statistics were incomplete");
            }
            commentGroups = cRes.features.map((ft) => ({
              name: cleanLabel(ft.attributes[commentField]),
              count: Number(ft.attributes.cnt ?? ft.attributes.CNT ?? 0),
            }));
          } catch (commentErr) {
            if (isAuthProblem(commentErr)) throw commentErr;
            console.warn("[useMatchingResults] comment statistics query failed, falling back to paging", commentErr);
            const pages = total > 0 ? Math.ceil(total / pageSize) : 1;
            const tally: Record<string, number> = {};
            for (let p = 0; p < pages; p++) {
              if (cancelled) return;
              const pageRes = (await fetchJson(
                `${RAW_URL}/query?where=1%3D1&outFields=${encodeURIComponent(commentField)}` +
                `&returnGeometry=false&resultOffset=${p * pageSize}&resultRecordCount=${pageSize}&f=json`,
              )) as { features?: Array<{ attributes: Record<string, unknown> }> };
              for (const ft of pageRes.features ?? []) {
                const key = cleanLabel(ft.attributes[commentField]);
                tally[key] = (tally[key] ?? 0) + 1;
              }
            }
            commentGroups = Object.entries(tally).map(([name, count]) => ({ name, count }));
          }
          commentGroups = commentGroups
            .filter((g) => g.name !== "" && g.name.toLowerCase() !== "null" && g.name.toLowerCase() !== "undefined")
            .sort((a, b) => b.count - a.count);
        }

        /* 3 — per-project × status cross-tab, single query. Drives the
           "By project" cards and the client-side drill-in filter. */
        let projects: ProjectSummary[] = [];
        if (projectField) {
          try {
            const stats = encodeURIComponent(JSON.stringify([
              { statisticType: "count", onStatisticField: oidField, outStatisticFieldName: "cnt" },
            ]));
            const groupBy = encodeURIComponent(`${projectField},${statusField}`);
            const xUrl =
              `${RAW_URL}/query?where=1%3D1&groupByFieldsForStatistics=${groupBy}` +
              `&outStatistics=${stats}&f=json`;
            const xRes = (await fetchJson(xUrl)) as {
              features?: Array<{ attributes: Record<string, unknown> }>;
            };
            if (cancelled) return;
            const byProject = new Map<string, MatchingGroup[]>();
            for (const ft of xRes.features ?? []) {
              const proj = cleanLabel(ft.attributes[projectField]);
              const status = cleanLabel(ft.attributes[statusField]);
              const cnt = Number(ft.attributes.cnt ?? ft.attributes.CNT ?? 0);
              if (proj === "" || proj.toLowerCase() === "null" || proj.toLowerCase() === "undefined") continue;
              const list = byProject.get(proj) ?? [];
              list.push({ name: status, count: cnt });
              byProject.set(proj, list);
            }
            projects = Array.from(byProject.entries())
              .map(([name, statuses]) => ({
                name,
                total: statuses.reduce((s, g) => s + g.count, 0),
                statuses: statuses.sort((a, b) => b.count - a.count),
                comments: [],
              }))
              .sort((a, b) => b.total - a.total);
          } catch (xErr) {
            if (isAuthProblem(xErr)) throw xErr;
            console.warn("[useMatchingResults] project cross-tab failed", xErr);
          }

          if (commentField && projects.length > 0) {
            try {
              const stats = encodeURIComponent(JSON.stringify([
                { statisticType: "count", onStatisticField: oidField, outStatisticFieldName: "cnt" },
              ]));
              const groupBy = encodeURIComponent(`${projectField},${commentField}`);
              const pcUrl =
                `${RAW_URL}/query?where=1%3D1&groupByFieldsForStatistics=${groupBy}` +
                `&outStatistics=${stats}&f=json`;
              const pcRes = (await fetchJson(pcUrl)) as {
                features?: Array<{ attributes: Record<string, unknown> }>;
                exceededTransferLimit?: boolean;
              };
              if (cancelled) return;
              if (pcRes.exceededTransferLimit || !Array.isArray(pcRes.features)) {
                throw new Error("Project comment statistics were incomplete");
              }
              const commentsByProject = new Map<string, MatchingGroup[]>();
              for (const ft of pcRes.features ?? []) {
                const project = cleanLabel(ft.attributes[projectField]);
                const comment = cleanLabel(ft.attributes[commentField]);
                const count = Number(ft.attributes.cnt ?? ft.attributes.CNT ?? 0);
                if (!project || project.toLowerCase() === "null" || project.toLowerCase() === "undefined") continue;
                const list = commentsByProject.get(project) ?? [];
                list.push({ name: comment, count });
                commentsByProject.set(project, list);
              }
              projects = projects.map((project) => ({
                ...project,
                comments: (commentsByProject.get(project.name) ?? [])
                  .filter((g) => g.name !== "" && g.name.toLowerCase() !== "null" && g.name.toLowerCase() !== "undefined")
                  .sort((a, b) => b.count - a.count),
              }));
            } catch (pcErr) {
              if (isAuthProblem(pcErr)) throw pcErr;
              console.warn("[useMatchingResults] project comment statistics query failed, falling back to paging", pcErr);
              const pages = total > 0 ? Math.ceil(total / pageSize) : 1;
              const tally = new Map<string, Map<string, number>>();
              for (let p = 0; p < pages; p++) {
                if (cancelled) return;
                const pageRes = (await fetchJson(
                  `${RAW_URL}/query?where=1%3D1&outFields=${encodeURIComponent(`${projectField},${commentField}`)}` +
                  `&returnGeometry=false&resultOffset=${p * pageSize}&resultRecordCount=${pageSize}&f=json`,
                )) as { features?: Array<{ attributes: Record<string, unknown> }> };
                for (const ft of pageRes.features ?? []) {
                  const projectName = cleanLabel(ft.attributes[projectField]);
                  const comment = cleanLabel(ft.attributes[commentField]);
                  if (!projectName || projectName.toLowerCase() === "null" || projectName.toLowerCase() === "undefined" ||
                      !comment || comment.toLowerCase() === "null" || comment.toLowerCase() === "undefined") continue;
                  const projectCounts = tally.get(projectName) ?? new Map<string, number>();
                  projectCounts.set(comment, (projectCounts.get(comment) ?? 0) + 1);
                  tally.set(projectName, projectCounts);
                }
              }
              projects = projects.map((project) => ({
                ...project,
                comments: Array.from(tally.get(project.name) ?? [])
                  .map(([name, count]) => ({ name, count }))
                  .sort((a, b) => b.count - a.count),
              }));
            }
          }
        }

        if (cancelled) return;
        setState({
          loading: false,
          error: cleaned.length === 0 ? "No matching-status values returned for this layer" : null,
          authError: false,
          statusField,
          commentField,
          projectField,
          total,
          groups: cleaned,
          commentGroups,
          projects,
          fetchedAt: Date.now(),
        });
      } catch (err) {
        console.error("[useMatchingResults] load failed", err);
        if (cancelled) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: String((err as Error)?.message ?? err),
          authError: isAuthProblem(err),
        }));
      }
    }

    load();
    return () => { cancelled = true; };
  }, [configured, reloadKey]);

  const fetchAllRows = useCallback(async (
    onProgress?: (loaded: number, total: number) => void,
    where = "1=1",
  ): Promise<{ rows: Record<string, unknown>[]; fieldOrder: string[] }> => {
    if (!configured) return { rows: [], fieldOrder: [] };
    const whereEnc = encodeURIComponent(where);

    const meta = (await fetchJson(`${RAW_URL}?f=json`)) as {
      fields?: Array<{ name: string }>;
      maxRecordCount?: number;
    };
    const fieldOrder = (meta.fields ?? []).map((f) => f.name);
    const pageSize = Math.min(meta.maxRecordCount ?? 1000, 2000);

    const countRes = (await fetchJson(
      `${RAW_URL}/query?where=${whereEnc}&returnCountOnly=true&f=json`,
    )) as { count?: number };
    const totalCount = countRes.count ?? 0;
    const pageCount = totalCount > 0 ? Math.ceil(totalCount / pageSize) : 1;
    const offsets = Array.from({ length: pageCount }, (_, i) => i * pageSize);

    const rows: Record<string, unknown>[] = [];
    let next = 0;
    const worker = async () => {
      while (true) {
        const i = next++;
        if (i >= offsets.length) break;
        const res = (await fetchJson(
          `${RAW_URL}/query?where=${whereEnc}&outFields=*&returnGeometry=false` +
          `&resultOffset=${offsets[i]}&resultRecordCount=${pageSize}&f=json`,
        )) as { features?: Array<{ attributes: Record<string, unknown> }> };
        for (const ft of res.features ?? []) rows.push(ft.attributes);
        onProgress?.(rows.length, totalCount);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(5, offsets.length) }, worker),
    );

    return { rows, fieldOrder };
  }, [configured]);

  return { ...state, configured, layerUrl: RAW_URL, reload, fetchAllRows };
}

function cleanLabel(v: unknown): string {
  const s = String(v ?? "").trim();
  return s;
}
