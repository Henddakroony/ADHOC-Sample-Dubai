import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Reader for a company's van-routing feature layer (points; one per stop).
 *
 * Companies are configured by env var — a Routing tab appears when at least one
 * is set, and a company picker appears at two or more:
 *   VITE_ROUTING_FINE_URL, VITE_ROUTING_GYM_URL, VITE_ROUTING_FROZEN_URL,
 *   VITE_ROUTING_AMERICANA_URL, VITE_ROUTING_AFI_URL
 *
 * The hook resolves the routing fields from the layer schema and loads the
 * filter option lists (regions, governorates, van codes, van days). The map
 * component renders the points/labels/route-lines from the same layer + fields.
 */

const API_KEY = (import.meta.env.VITE_ARCGIS_API_KEY as string | undefined) ?? "";

export interface RoutingCompany {
  id: string;
  label: string;
  url: string;
}

function mk(id: string, label: string, url: string | undefined): RoutingCompany | null {
  const u = url?.trim();
  return u ? { id, label, url: u } : null;
}

// Literal env access — Vite statically replaces these at build time; a dynamic
// import.meta.env[key] lookup would be undefined in the production bundle.
export const ROUTING_COMPANIES: RoutingCompany[] = [
  mk("fine", "Fine", import.meta.env.VITE_ROUTING_FINE_URL as string | undefined),
  mk("gym", "GYM", import.meta.env.VITE_ROUTING_GYM_URL as string | undefined),
  mk("frozen", "Frozen", import.meta.env.VITE_ROUTING_FROZEN_URL as string | undefined),
  mk("americana", "Americana", import.meta.env.VITE_ROUTING_AMERICANA_URL as string | undefined),
  mk("afi", "AFI", import.meta.env.VITE_ROUTING_AFI_URL as string | undefined),
].filter((c): c is RoutingCompany => c !== null);

export const ROUTING_ENABLED = ROUTING_COMPANIES.length > 0;

export interface RoutingFields {
  oid: string;
  vanCode: string;
  vanDay: string;
  sequence: string;
  region?: string;
  gov?: string;
  name?: string;
  totalDistance?: string;
  totalTime?: string;
  /** Master code — non-empty means the stop is a Fine record, empty means ADHOC. */
  masterCode?: string;
}

export interface VanCodePair { vanCode: number; region: string; gov: string; }
export interface VanDayPair { vanDay: number; region: string; gov: string; vanCode: number; }

export interface RoutingLayerState {
  company: RoutingCompany | null;
  fields: RoutingFields | null;
  loading: boolean;
  error: string | null;
  regions: string[];
  govPairs: Array<{ region: string; gov: string }>;
  vanCodes: number[];
  vanDays: number[];
  vanCodePairs: VanCodePair[];
  vanDayPairs: VanDayPair[];
  total: number;
  reload: () => void;
}

function pick(fieldNames: string[], candidates: string[]): string | undefined {
  for (const c of candidates) {
    const hit = fieldNames.find((f) => f.toLowerCase() === c.toLowerCase());
    if (hit) return hit;
  }
  return fieldNames.find((f) => candidates.some((c) => f.toLowerCase().includes(c.toLowerCase())));
}

async function agGet(url: string): Promise<Record<string, unknown>> {
  const sep = url.includes("?") ? "&" : "?";
  const full = API_KEY ? `${url}${sep}token=${encodeURIComponent(API_KEY)}` : url;
  const res = await fetch(full);
  const data = (await res.json()) as Record<string, unknown>;
  const err = (data as { error?: { message?: string; code?: number } }).error;
  if (err) throw new Error(err.message || `ArcGIS error ${err.code ?? "?"}`);
  return data;
}

async function distinct(url: string, field: string, extra = ""): Promise<Array<Record<string, unknown>>> {
  const q =
    `${url}/query?where=1%3D1&outFields=${encodeURIComponent(field + (extra ? "," + extra : ""))}` +
    `&returnDistinctValues=true&returnGeometry=false&f=json`;
  const d = (await agGet(q)) as { features?: Array<{ attributes: Record<string, unknown> }> };
  return (d.features ?? []).map((f) => f.attributes);
}

export function useRoutingLayer(companyId: string | null): RoutingLayerState {
  const company = useMemo(
    () => ROUTING_COMPANIES.find((c) => c.id === companyId) ?? ROUTING_COMPANIES[0] ?? null,
    [companyId],
  );

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const [state, setState] = useState<Omit<RoutingLayerState, "company" | "reload">>({
    fields: null, loading: !!company, error: null,
    regions: [], govPairs: [], vanCodes: [], vanDays: [],
    vanCodePairs: [], vanDayPairs: [], total: 0,
  });

  useEffect(() => {
    if (!company) { setState((s) => ({ ...s, loading: false })); return; }
    if (!API_KEY) { setState((s) => ({ ...s, loading: false, error: "VITE_ARCGIS_API_KEY is not set" })); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    async function load() {
      try {
        const meta = (await agGet(`${company!.url}?f=json`)) as {
          fields?: Array<{ name: string }>;
          objectIdField?: string;
        };
        if (cancelled) return;
        const names = (meta.fields ?? []).map((f) => f.name);
        if (names.length === 0) throw new Error("Routing layer returned no fields");

        const fields: RoutingFields = {
          oid: meta.objectIdField ?? pick(names, ["OBJECTID", "FID", "OID"]) ?? "OBJECTID",
          vanCode: pick(names, ["Adhoc_Van_Code", "ADHOC_Van_Code", "Van_Code", "VanCode"]) ?? "Adhoc_Van_Code",
          vanDay: pick(names, ["Van_Day", "VanDay", "Day"]) ?? "Van_Day",
          sequence: pick(names, ["Sequence", "Seq", "Stop_Sequence", "Order"]) ?? "Sequence",
          region: pick(names, ["Region"]),
          gov: pick(names, ["Gov", "Governorate", "English_Gov"]),
          name: pick(names, ["Outlet_Name", "CustomerNameE", "Master_Name", "Name"]),
          totalDistance: pick(names, ["Total_Distance"]),
          totalTime: pick(names, ["Total_Time"]),
          masterCode: pick(names, ["Master_Code", "MasterCode"]),
        };

        const vcExtra = [fields.region, fields.gov].filter(Boolean).join(",");
        const vdExtra = [fields.region, fields.gov, fields.vanCode].filter(Boolean).join(",");

        const [regionRows, govRows, vanCodeRows, vanDayRows, countData] = await Promise.all([
          fields.region ? distinct(company!.url, fields.region) : Promise.resolve([]),
          fields.region && fields.gov ? distinct(company!.url, fields.gov, fields.region) : (fields.gov ? distinct(company!.url, fields.gov) : Promise.resolve([])),
          distinct(company!.url, fields.vanCode, vcExtra),
          distinct(company!.url, fields.vanDay, vdExtra),
          agGet(`${company!.url}/query?where=1%3D1&returnCountOnly=true&f=json`),
        ]);
        if (cancelled) return;

        const clean = (v: unknown) => v != null && String(v).trim() !== "";
        const regions = regionRows.map((r) => String(r[fields.region!])).filter(clean).sort();
        const govPairs = govRows
          .map((r) => ({ region: fields.region ? String(r[fields.region] ?? "") : "", gov: String(r[fields.gov!] ?? "") }))
          .filter((p) => clean(p.gov));
        const vanCodes = Array.from(new Set(vanCodeRows.map((r) => Number(r[fields.vanCode])).filter((n) => Number.isFinite(n)))).sort((a, b) => a - b);
        const vanDays = Array.from(new Set(vanDayRows.map((r) => Number(r[fields.vanDay])).filter((n) => Number.isFinite(n)))).sort((a, b) => a - b);

        const vanCodePairs: VanCodePair[] = vanCodeRows
          .filter((r) => Number.isFinite(Number(r[fields.vanCode])))
          .map((r) => ({
            vanCode: Number(r[fields.vanCode]),
            region: fields.region ? String(r[fields.region] ?? "") : "",
            gov: fields.gov ? String(r[fields.gov] ?? "") : "",
          }));
        const vanDayPairs: VanDayPair[] = vanDayRows
          .filter((r) => Number.isFinite(Number(r[fields.vanDay])))
          .map((r) => ({
            vanDay: Number(r[fields.vanDay]),
            region: fields.region ? String(r[fields.region] ?? "") : "",
            gov: fields.gov ? String(r[fields.gov] ?? "") : "",
            vanCode: Number(r[fields.vanCode] ?? 0),
          }));

        const total = ((countData as { count?: number }).count) ?? 0;

        setState({ fields, loading: false, error: null, regions, govPairs, vanCodes, vanDays, vanCodePairs, vanDayPairs, total });
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({ ...s, loading: false, error: String((err as Error)?.message ?? err) }));
      }
    }

    load();
    return () => { cancelled = true; };
  }, [company, reloadKey]);

  return { ...state, company, reload };
}
