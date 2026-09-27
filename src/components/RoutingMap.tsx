import { useEffect, useRef, useState } from "react";
import type EsriMapView from "@arcgis/core/views/MapView";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import type { RoutingFields } from "../hooks/useRoutingLayer";
import { SymbologyMode, colorFor } from "../utils/routingSymbology";

export interface RoutingFilterState {
  region: string;
  gov: string;
  vanCode: string; // "All" or a number as string
  vanDay: string;
  source: "All" | "ADHOC" | "Fine";
}

export interface RouteSummary {
  stops: number;
  vans: number;
  totalDistance: string | null;
  totalTime: string | null;
}

export interface SourceSplit { fine: number; adhoc: number; }

const ROUTE_LINES_URL = (import.meta.env.VITE_ROUTE_LINES_URL as string | undefined)?.trim() || "";
const ROUTE_DEPOT_URL = (import.meta.env.VITE_ROUTE_DEPOT_URL as string | undefined)?.trim() || "";

interface RoutingMapProps {
  url: string;
  fields: RoutingFields;
  filters: RoutingFilterState;
  mode: SymbologyMode;
  vanCodes: number[];
  vanDays: number[];
  onSummary?: (s: RouteSummary | null) => void;
  onSourceSplit?: (s: SourceSplit | null) => void;
}

function esc(v: string) { return v.replace(/'/g, "''"); }

/** SQL for "this stop is a Fine record" (Master_Code populated) vs ADHOC (empty). */
function fineClause(mc: string) { return `${mc} IS NOT NULL AND ${mc} <> ''`; }
function adhocClause(mc: string) { return `(${mc} IS NULL OR ${mc} = '')`; }

export function buildWhereClause(fields: RoutingFields, f: RoutingFilterState, includeSource = true): string {
  const c: string[] = [];
  if (fields.region && f.region !== "All") c.push(`${fields.region} = '${esc(f.region)}'`);
  if (fields.gov && f.gov !== "All") c.push(`${fields.gov} = '${esc(f.gov)}'`);
  if (f.vanCode !== "All") c.push(`${fields.vanCode} = ${Number(f.vanCode)}`);
  if (f.vanDay !== "All") c.push(`${fields.vanDay} = ${Number(f.vanDay)}`);
  if (includeSource && fields.masterCode && f.source !== "All") {
    c.push(f.source === "Fine" ? fineClause(fields.masterCode) : adhocClause(fields.masterCode));
  }
  return c.length ? c.join(" AND ") : "1=1";
}

function buildLineWhere(f: RoutingFilterState): string {
  if (f.vanDay === "All") return "1=0";
  const c: string[] = [];
  if (f.region !== "All") c.push(`Region = '${esc(f.region)}'`);
  if (f.gov !== "All") c.push(`Gov = '${esc(f.gov)}'`);
  if (f.vanCode !== "All") c.push(`Van_Code = ${Number(f.vanCode)}`);
  c.push(`Van_Day = ${Number(f.vanDay)}`);
  return c.join(" AND ");
}

function buildDepotWhere(f: RoutingFilterState): string {
  const c: string[] = [];
  if (f.region !== "All") c.push(`Region = '${esc(f.region)}'`);
  if (f.gov !== "All") c.push(`Gov = '${esc(f.gov)}'`);
  return c.length ? c.join(" AND ") : "1=1";
}

function markerFor(color: string) {
  return {
    type: "simple-marker",
    style: "circle",
    color,
    size: "9px",
    outline: { color: "rgba(255,255,255,0.9)", width: 1.2 },
  };
}

function buildRenderer(fields: RoutingFields, mode: SymbologyMode, vanCodes: number[], vanDays: number[]) {
  const field = mode === "vanDay" ? fields.vanDay : fields.vanCode;
  const values = mode === "vanDay" ? vanDays : vanCodes;
  return {
    type: "unique-value",
    field,
    defaultSymbol: markerFor("#64748b"),
    uniqueValueInfos: values.flatMap((v) => [
      { value: v, symbol: markerFor(colorFor(mode, v)) },
      { value: String(v), symbol: markerFor(colorFor(mode, v)) },
    ]),
  };
}

function labelInfo(fields: RoutingFields) {
  return [{
    labelExpressionInfo: { expression: `$feature.${fields.sequence}` },
    symbol: {
      type: "text",
      color: "#ffffff",
      backgroundColor: [42, 44, 114, 0.85],
      borderLineColor: [91, 190, 232, 0.5],
      borderLineSize: 0.8,
      haloColor: [42, 44, 114, 0.6],
      haloSize: "1.5px",
      font: { size: "11px", weight: "bold", family: "Inter, sans-serif" },
      xoffset: 0,
      yoffset: 10,
    },
    labelPlacement: "above-center",
    minScale: 600000,
    maxScale: 0,
  }];
}

const BASEMAPS = [
  { id: "streets-navigation-vector", label: "Streets" },
  { id: "satellite",                 label: "Satellite" },
  { id: "hybrid",                    label: "Hybrid" },
  { id: "dark-gray-vector",          label: "Dark" },
  { id: "gray-vector",               label: "Light Gray" },
  { id: "topo-vector",               label: "Topo" },
] as const;

export default function RoutingMap({ url, fields, filters, mode, vanCodes, vanDays, onSummary, onSourceSplit }: RoutingMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EsriMapView | null>(null);
  const mapObjRef = useRef<{ basemap: string } | null>(null);
  const [basemap, setBasemap] = useState("streets-navigation-vector");
  const layerRef = useRef<FeatureLayer | null>(null);
  const linesLayerRef = useRef<FeatureLayer | null>(null);
  const depotLayerRef = useRef<FeatureLayer | null>(null);
  const initRef = useRef(false);
  const propsRef = useRef({ fields, filters, mode, vanCodes, vanDays, onSummary, onSourceSplit });
  propsRef.current = { fields, filters, mode, vanCodes, vanDays, onSummary, onSourceSplit };

  // ADHOC vs Fine split for the current geo/van/day filter (ignores the source
  // toggle so both parts always show). Master_Code populated = Fine, empty = ADHOC.
  async function updateSourceSplit() {
    const layer = layerRef.current;
    const p = propsRef.current;
    if (!layer) return;
    const mc = p.fields.masterCode;
    if (!mc) { p.onSourceSplit?.(null); return; }
    const base = buildWhereClause(p.fields, p.filters, false);
    const and = base === "1=1" ? "" : `${base} AND `;
    try {
      const [fine, adhoc] = await Promise.all([
        layer.queryFeatureCount({ where: `${and}${fineClause(mc)}` } as never),
        layer.queryFeatureCount({ where: `${and}${adhocClause(mc)}` } as never),
      ]);
      p.onSourceSplit?.({ fine, adhoc });
    } catch { /* ignore */ }
  }

  // ── init once ──
  useEffect(() => {
    if (initRef.current || !url) return;
    initRef.current = true;
    let cancelled = false;

    (async () => {
      const [Map, MapView, FeatureLayer, config] = await Promise.all([
        import("@arcgis/core/Map"),
        import("@arcgis/core/views/MapView"),
        import("@arcgis/core/layers/FeatureLayer"),
        import("@arcgis/core/config"),
      ]);
      if (cancelled || !mapRef.current) return;

      config.default.apiKey = import.meta.env.VITE_ARCGIS_API_KEY ?? "";

      const p = propsRef.current;
      const layer = new FeatureLayer.default({
        url,
        outFields: ["*"],
        renderer: buildRenderer(p.fields, p.mode, p.vanCodes, p.vanDays) as never,
        definitionExpression: buildWhereClause(p.fields, p.filters),
        labelingInfo: labelInfo(p.fields) as never,
        labelsVisible: p.filters.vanDay !== "All",
        popupTemplate: {
          title: p.fields.name ? `{${p.fields.name}}` : "Stop",
          content: `Van {${p.fields.vanCode}} · Day {${p.fields.vanDay}} · Stop {${p.fields.sequence}}`,
        } as never,
      } as never);
      layerRef.current = layer;

      const extraLayers: unknown[] = [];

      if (ROUTE_LINES_URL) {
        const linesOpts: Record<string, unknown> = {
          url: ROUTE_LINES_URL,
          outFields: ["Van_Code", "Van_Day", "Region", "Gov", "Route_Name", "Total_Dist_Text", "Total_Time_Text", "Stops_Count"],
          definitionExpression: buildLineWhere(p.filters),
          renderer: {
            type: "simple",
            symbol: {
              type: "simple-line",
              color: [0, 230, 169, 0.85],
              width: 3.5,
              cap: "round",
              join: "round",
              style: "solid",
              marker: {
                type: "line-marker",
                style: "arrow",
                placement: "end-of-segments",
                color: [0, 180, 130, 1],
              },
            },
          },
          popupTemplate: {
            title: "Route {Route_Name}",
            content: "Van {Van_Code} · Day {Van_Day}<br/>Distance: {Total_Dist_Text}<br/>Time: {Total_Time_Text}<br/>Stops: {Stops_Count}",
          },
        };
        const linesLayer = new FeatureLayer.default(linesOpts as never);
        linesLayerRef.current = linesLayer;
        extraLayers.push(linesLayer);
      }

      if (ROUTE_DEPOT_URL) {
        const depotOpts: Record<string, unknown> = {
          url: ROUTE_DEPOT_URL,
          outFields: ["Depot_Name", "Region", "Gov"],
          definitionExpression: buildDepotWhere(p.filters),
          renderer: {
            type: "simple",
            symbol: { type: "picture-marker", url: `${window.location.origin}/depot-icon.png`, width: "32px", height: "32px" },
          },
          labelingInfo: [{
            labelExpressionInfo: { expression: "$feature.Depot_Name" },
            symbol: {
              type: "text", color: "#fff",
              backgroundColor: [42, 44, 114, 0.9], borderLineColor: [0, 230, 169, 0.5], borderLineSize: 0.8,
              haloColor: [0, 0, 0, 0.5], haloSize: "1px",
              font: { size: "10px", weight: "bold", family: "Inter, sans-serif" }, yoffset: 22,
            },
            labelPlacement: "above-center",
          }],
          labelsVisible: true,
          popupTemplate: { title: "{Depot_Name}", content: "Region: {Region}<br/>Gov: {Gov}" },
        };
        const depotLayer = new FeatureLayer.default(depotOpts as never);
        depotLayerRef.current = depotLayer;
        extraLayers.push(depotLayer);
      }

      const map = new Map.default({ basemap: basemap, layers: [...extraLayers, layer] as never });
      mapObjRef.current = map as unknown as { basemap: string };
      const view = new MapView.default({
        container: mapRef.current!,
        map,
        center: [30.5, 31.0],
        zoom: 8,
        ui: { components: ["zoom", "compass"] },
      });
      viewRef.current = view;

      layer.when(() => {
        rebuild();
        updateSourceSplit();
      });
    })();

    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
      layerRef.current = null;
      linesLayerRef.current = null;
      depotLayerRef.current = null;
      initRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // ── react to basemap change ──
  useEffect(() => {
    const m = mapObjRef.current;
    if (m) m.basemap = basemap as never;
  }, [basemap]);

  // ── react to filter / mode changes ──
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.renderer = buildRenderer(fields, mode, vanCodes, vanDays) as never;
    layer.definitionExpression = buildWhereClause(fields, filters);
    layer.labelsVisible = filters.vanDay !== "All";

    if (linesLayerRef.current) {
      linesLayerRef.current.definitionExpression = buildLineWhere(filters);
    }
    if (depotLayerRef.current) {
      depotLayerRef.current.definitionExpression = buildDepotWhere(filters);
    }

    rebuild();
    updateSourceSplit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, filters, mode, vanCodes, vanDays]);

  // Build route summary and zoom to extent.
  async function rebuild() {
    const layer = layerRef.current;
    const view = viewRef.current;
    const p = propsRef.current;
    if (!layer || !view) return;

    const singleDay = p.filters.vanDay !== "All";

    if (!singleDay) {
      p.onSummary?.(null);
      try {
        const r = await layer.queryExtent();
        if (r?.extent) view.goTo(r.extent.expand(1.15)).catch(() => {});
      } catch { /* ignore */ }
      return;
    }

    try {
      const where = buildWhereClause(p.fields, p.filters);
      const q = layer.createQuery();
      q.where = where;
      q.outFields = [p.fields.vanCode, p.fields.vanDay, p.fields.sequence,
        ...(p.fields.totalDistance ? [p.fields.totalDistance] : []),
        ...(p.fields.totalTime ? [p.fields.totalTime] : [])];
      q.returnGeometry = false;
      q.num = 4000;
      const res = await layer.queryFeatures(q);
      const feats = res.features ?? [];

      const vanSet = new Set<number>();
      let totalDistance: string | null = null;
      let totalTime: string | null = null;
      for (const f of feats) {
        const a = f.attributes as Record<string, unknown>;
        vanSet.add(Number(a[p.fields.vanCode]));
        if (totalDistance == null && p.fields.totalDistance) totalDistance = String(a[p.fields.totalDistance] ?? "") || null;
        if (totalTime == null && p.fields.totalTime) totalTime = String(a[p.fields.totalTime] ?? "") || null;
      }

      p.onSummary?.({ stops: feats.length, vans: vanSet.size, totalDistance, totalTime });

      const r = await layer.queryExtent();
      if (r?.extent) view.goTo(r.extent.expand(1.25)).catch(() => {});
    } catch { /* ignore */ }
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={mapRef} className="routing-map" />
      <div className="rt-basemap-sw">
        {BASEMAPS.map((b) => (
          <button
            key={b.id}
            className={basemap === b.id ? "active" : ""}
            onClick={() => setBasemap(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
