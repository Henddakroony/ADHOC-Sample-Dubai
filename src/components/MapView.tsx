import { useEffect, useRef, useState, useMemo, lazy, Suspense } from "react";
import type EsriMapView from "@arcgis/core/views/MapView";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import type GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import { Outlet, FilterState, OutletFieldMap } from "../types";
import StatsCards from "./StatsCards";
import { getOutletTypeColor, buildTypeLegend } from "../utils/outletTypeColor";
import { RETAIL_TIERS, getRetailTier, tierPictureSymbol, svgDataUri } from "../utils/outletTypeSymbol";
import { coerceStatus } from "../utils/outletStatus";

const LeafletMap = lazy(() => import("./LeafletMap"));

interface MapViewProps {
  outlets: Outlet[];
  allOutlets: Outlet[];
  selectedOutlet: Outlet | null;
  onSelectOutlet: (o: Outlet | null) => void;
  filterVersion: number;
  loading: boolean;
  layerUrl: string;
  fieldMap: OutletFieldMap;
  outletTypes: string[];
  filters: FilterState;
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

const STATUS_COLORS: Record<string, string> = {
  Active: "#22c55e", Inactive: "#ef4444", Pending: "#f59e0b",
};

function ok(v?: string) {
  return v && v !== "undefined" && v !== "null" && v !== "Unknown" && v !== "";
}

interface PopupAttrs {
  status?: string;
  outletType?: string;
  address?: string;
  phone?: string;
  photoLink?: string;
}

function buildPopupContent(a: PopupAttrs): string {
  const status = String(a.status ?? "");
  const color = STATUS_COLORS[status] ?? "#475569";
  const photo = ok(a.photoLink)
    ? `<a href="${a.photoLink}" target="_blank" rel="noopener noreferrer"
         style="display:flex;align-items:center;gap:7px;margin-bottom:10px;padding:8px 10px;
           background:rgba(79,84,176,0.12);border:1px solid rgba(79,84,176,0.30);border-radius:8px;
           font-size:12px;font-weight:600;color:#9598CE;text-decoration:none;cursor:pointer">
         <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
           <polyline points="7 10 12 15 17 10"/>
           <line x1="12" y1="15" x2="12" y2="3"/>
         </svg>
         View Photo (2025)
       </a>`
    : "";
  const rows = [
    ok(a.outletType)
      ? `<div style="font-size:12px;color:#94a3b8;margin-bottom:10px">${a.outletType}</div>` : "",
    `<div style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;
        background:${color}22;color:${color};border-radius:20px;padding:3px 10px;margin-bottom:10px">
       <span style="width:6px;height:6px;background:${color};border-radius:50%;display:inline-block"></span>
       ${status}
     </div>`,
    ok(a.address)
      ? `<div style="display:flex;gap:7px;align-items:flex-start;font-size:12px;color:#94a3b8;margin-bottom:6px">
           <span>📍</span><span>${a.address}</span></div>` : "",
    ok(a.phone)
      ? `<div style="display:flex;gap:7px;align-items:center;font-size:12px;color:#94a3b8">
           <span>📞</span><span>${a.phone}</span></div>` : "",
  ].filter(Boolean).join("");
  return `<div style="font-family:Inter,system-ui,sans-serif;padding:10px 14px 12px">${photo}${rows}</div>`;
}

function dotSymbol(color: string) {
  return {
    type: "simple-marker",
    style: "circle",
    color,
    size: "9px",
    outline: { color: "rgba(255,255,255,0.85)", width: 1 },
  };
}

function highlightSymbol(outletType: string) {
  const tier = getRetailTier(outletType);
  if (tier) {
    // Match the glyph being highlighted, one size up so it reads as selected.
    return {
      type: "picture-marker",
      url: svgDataUri(tier.svg(tier.color)),
      width: `${Math.round(tier.size * 1.5)}px`,
      height: `${Math.round(tier.size * 1.5)}px`,
    };
  }
  return {
    type: "simple-marker",
    style: "circle",
    color: getOutletTypeColor(outletType),
    size: "20px",
    outline: { color: "#ffffff", width: 3 },
  };
}

// Unique-value renderer keyed on the real outlet-type field, so the server-side
// clusters are colored by their predominant outlet type. The three retail tiers
// (Mini / Super / Hyper) render as sized store glyphs instead of dots; every
// other type keeps the plain dot.
function buildServerRenderer(types: string[], field: string) {
  const seen = new Set(types.filter((t) => t && t !== "All"));
  // Include the tiers even if they have not streamed into `types` yet, so the
  // glyphs appear on the first paint rather than after the full load.
  for (const t of RETAIL_TIERS) seen.add(t.type);

  const uniqueValueInfos = Array.from(seen).map((t) => {
    const tier = getRetailTier(t);
    return {
      value: t,
      symbol: tier ? tierPictureSymbol(tier) : dotSymbol(getOutletTypeColor(t)),
    };
  });

  return {
    type: "unique-value",
    field,
    defaultSymbol: dotSymbol("#64748b"),
    uniqueValueInfos,
  };
}

function buildFeatureReduction() {
  return {
    type: "cluster",
    clusterRadius: "70px",
    clusterMinSize: "26px",
    clusterMaxSize: "54px",
    popupEnabled: false,
    labelingInfo: [
      {
        deconflictionStrategy: "none",
        labelExpressionInfo: { expression: "Text($feature.cluster_count, '#,###')" },
        symbol: {
          type: "text",
          color: "#ffffff",
          font: { weight: "bold", size: "11px", family: "Inter, sans-serif" },
          haloColor: "rgba(0,0,0,0.35)",
          haloSize: "1px",
        },
        labelPlacement: "center-center",
      },
    ],
  };
}

function esc(v: string): string {
  return v.replace(/'/g, "''");
}

// Translate the in-app filters into a SQL definitionExpression the server
// applies, so the map clusters reflect the active filters without the client
// loading every outlet.
function buildWhere(filters: FilterState, fm: OutletFieldMap): string {
  const clauses: string[] = [];
  if (fm.district && filters.district !== "All") clauses.push(`${fm.district} = '${esc(filters.district)}'`);
  if (fm.region && filters.region !== "All") clauses.push(`${fm.region} = '${esc(filters.region)}'`);
  if (fm.gov && filters.governorate !== "All") clauses.push(`${fm.gov} = '${esc(filters.governorate)}'`);
  if (fm.channel && filters.channel !== "All") clauses.push(`${fm.channel} = '${esc(filters.channel)}'`);
  if (fm.outletType && filters.outletType !== "All") clauses.push(`${fm.outletType} = '${esc(filters.outletType)}'`);
  if (fm.segmentation && filters.segmentation !== "All") clauses.push(`${fm.segmentation} = '${esc(filters.segmentation)}'`);
  if (fm.matchingStatus && filters.matchingStatus !== "All") clauses.push(`${fm.matchingStatus} = '${esc(filters.matchingStatus)}'`);
  const q = filters.searchQuery.trim();
  if (fm.name && q) clauses.push(`UPPER(${fm.name}) LIKE UPPER('%${esc(q)}%')`);
  return clauses.length ? clauses.join(" AND ") : "1=1";
}

function outFieldsFromMap(fm: OutletFieldMap): string[] {
  const set = new Set<string>();
  for (const f of [
    fm.oid, fm.name, fm.district, fm.region, fm.gov, fm.channel, fm.outletType,
    fm.segmentation, fm.status, fm.address, fm.phone, fm.photoLink,
  ]) {
    if (f) set.add(f);
  }
  return Array.from(set);
}

function featureToOutlet(
  attr: Record<string, unknown>,
  lng: number,
  lat: number,
  fm: OutletFieldMap,
): Outlet {
  const get = (f?: string) => (f ? attr[f] : undefined);
  return {
    id: String(get(fm.oid) ?? ""),
    name: String(get(fm.name) ?? ""),
    district: String(get(fm.district) ?? "Unknown"),
    region: String(get(fm.region) ?? "Unknown"),
    governorate: String(get(fm.gov) ?? "Unknown"),
    channel: String(get(fm.channel) ?? "Unknown"),
    outletType: String(get(fm.outletType) ?? "Unknown"),
    segmentation: String(get(fm.segmentation) ?? "Unknown"),
    status: coerceStatus(get(fm.status)),
    address: String(get(fm.address) ?? ""),
    lat,
    lng,
    phone: fm.phone ? String(get(fm.phone) ?? "") : undefined,
    photoLink: fm.photoLink ? String(get(fm.photoLink) ?? "") : undefined,
  };
}

type GraphicCtor = typeof import("@arcgis/core/Graphic").default;
type PointCtor = typeof import("@arcgis/core/geometry/Point").default;
type WebMercatorToGeographic = (g: unknown) => { x: number; y: number };

function ArcGISMap({
  selectedOutlet, onSelectOutlet, filterVersion, layerUrl, fieldMap, outletTypes, filters,
}: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EsriMapView | null>(null);
  const layerRef = useRef<FeatureLayer | null>(null);
  const highlightLayerRef = useRef<GraphicsLayer | null>(null);
  const GraphicRef = useRef<GraphicCtor | null>(null);
  const PointRef = useRef<PointCtor | null>(null);
  const toGeoRef = useRef<WebMercatorToGeographic | null>(null);

  const initDoneRef = useRef(false);
  const initialFitDoneRef = useRef(false);
  const prevFilterVersionRef = useRef(filterVersion);
  const selectedIdRef = useRef<string | null>(null);
  const configuredRef = useRef(false);

  // Always-current snapshot of props for callbacks created once at init.
  const propsRef = useRef({ selectedOutlet, onSelectOutlet, fieldMap, outletTypes, filters });
  propsRef.current = { selectedOutlet, onSelectOutlet, fieldMap, outletTypes, filters };

  // Apply the field-dependent configuration (outFields, renderer, popup, filter
  // expression) once the service field names have been resolved.
  function configureLayer() {
    const layer = layerRef.current;
    if (!layer) return;
    const fm = propsRef.current.fieldMap;
    if (!fm.outletType) return; // fields not resolved yet

    layer.outFields = outFieldsFromMap(fm);
    layer.renderer = buildServerRenderer(propsRef.current.outletTypes, fm.outletType) as never;
    layer.definitionExpression = buildWhere(propsRef.current.filters, fm);
    layer.popupTemplate = {
      title: fm.name ? `{${fm.name}}` : "Outlet",
      outFields: outFieldsFromMap(fm),
      content: (feature: { graphic: { attributes: Record<string, unknown> } }) => {
        const a = feature.graphic.attributes;
        return buildPopupContent({
          status: coerceStatus(fm.status ? a[fm.status] : ""),
          outletType: fm.outletType ? String(a[fm.outletType] ?? "") : "",
          address: fm.address ? String(a[fm.address] ?? "") : "",
          phone: fm.phone ? String(a[fm.phone] ?? "") : "",
          photoLink: fm.photoLink ? String(a[fm.photoLink] ?? "") : "",
        });
      },
    } as never;

    if (!configuredRef.current) {
      configuredRef.current = true;
      const view = viewRef.current;
      if (view && !propsRef.current.selectedOutlet) {
        layer.when(() => {
          if (initialFitDoneRef.current) return;
          initialFitDoneRef.current = true;
          layer.queryExtent()
            .then((r) => { if (r?.extent) view.goTo(r.extent.expand(1.1)).catch(() => {}); })
            .catch(() => {});
        });
      }
    }
  }

  useEffect(() => {
    if (initDoneRef.current) return;
    if (!layerUrl) return;
    initDoneRef.current = true;
    let cancelled = false;

    async function initMap() {
      const [MapModule, MapViewModule, FeatureLayerModule, GraphicsLayerModule, configModule, GraphicModule, PointModule, WMModule, HomeModule] =
        await Promise.all([
          import("@arcgis/core/Map"),
          import("@arcgis/core/views/MapView"),
          import("@arcgis/core/layers/FeatureLayer"),
          import("@arcgis/core/layers/GraphicsLayer"),
          import("@arcgis/core/config"),
          import("@arcgis/core/Graphic"),
          import("@arcgis/core/geometry/Point"),
          import("@arcgis/core/geometry/support/webMercatorUtils"),
          import("@arcgis/core/widgets/Home"),
        ]);

      if (cancelled || !mapRef.current) return;

      configModule.default.apiKey = import.meta.env.VITE_ARCGIS_API_KEY ?? "";

      const EsriMap = MapModule.default;
      const MapViewCtor = MapViewModule.default;
      const FeatureLayerCtor = FeatureLayerModule.default;
      const GraphicsLayerCtor = GraphicsLayerModule.default;
      GraphicRef.current = GraphicModule.default;
      PointRef.current = PointModule.default;
      toGeoRef.current = WMModule.webMercatorToGeographic as unknown as WebMercatorToGeographic;

      // Server-hosted layer: ArcGIS queries and clusters on the server, so the
      // client never downloads all outlets just to draw the map.
      const layer = new FeatureLayerCtor({
        url: layerUrl,
        outFields: ["*"],
        featureReduction: buildFeatureReduction(),
      } as never);
      layerRef.current = layer;

      const highlightLayer = new GraphicsLayerCtor({ title: "Selection" });
      highlightLayerRef.current = highlightLayer;

      const map = new EsriMap({ basemap: "streets-navigation-vector", layers: [layer, highlightLayer] });
      const view = new MapViewCtor({
        container: mapRef.current!,
        map,
        center: [45.0, 24.0],
        zoom: 5,
        ui: { components: ["zoom", "compass"] },
      });
      viewRef.current = view;

      // Home button: returns the map to the default Saudi Arabia overview.
      const HomeCtor = HomeModule.default;
      const homeWidget = new HomeCtor({ view } as never);
      view.ui.add(homeWidget, "top-left");

      view.on("click", (event: unknown) => {
        view
          .hitTest(event as Parameters<typeof view.hitTest>[0], { include: [layer] as never })
          .then((response) => {
            const result = response.results.find((r) => r.type === "graphic") as
              | { graphic: { attributes?: Record<string, unknown>; geometry?: unknown; isAggregate?: boolean } }
              | undefined;
            const g = result?.graphic;

            if (g && (g.isAggregate || g.attributes?.cluster_count != null)) {
              const currentZoom = (view.zoom as number) ?? 5;
              view.goTo({ target: g.geometry as never, zoom: Math.min(currentZoom + 2, 18) }).catch(() => {});
              return;
            }

            const attr = g?.attributes;
            const fm = propsRef.current.fieldMap;
            if (attr && fm.oid && attr[fm.oid] != null) {
              const geom = g?.geometry as
                | { x?: number; y?: number; longitude?: number; latitude?: number; spatialReference?: { wkid?: number } }
                | undefined;
              let lng = 0, lat = 0;
              if (geom) {
                if (geom.spatialReference?.wkid === 4326 && geom.longitude != null) {
                  lng = geom.longitude; lat = geom.latitude ?? 0;
                } else if (toGeoRef.current) {
                  const geo = toGeoRef.current(geom);
                  lng = geo.x; lat = geo.y;
                } else {
                  lng = geom.x ?? 0; lat = geom.y ?? 0;
                }
              }
              const outlet = featureToOutlet(attr, lng, lat, fm);
              propsRef.current.onSelectOutlet(outlet);
              view.openPopup({ features: [g as never], location: g!.geometry as never });
              return;
            }
            propsRef.current.onSelectOutlet(null);
            view.closePopup();
          })
          .catch(() => {});
      });

      configureLayer();
    }

    initMap();
    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
      layerRef.current = null;
      highlightLayerRef.current = null;
      GraphicRef.current = null;
      PointRef.current = null;
      toGeoRef.current = null;
      initDoneRef.current = false;
      initialFitDoneRef.current = false;
      configuredRef.current = false;
    };
  }, [layerUrl]);

  // Re-apply field-dependent config when the resolved field names or the outlet
  // type list (renderer colors) become available / change.
  useEffect(() => {
    configureLayer();
  }, [fieldMap, outletTypes]);

  // Push the active filters to the server and re-frame to the result extent.
  useEffect(() => {
    if (prevFilterVersionRef.current === filterVersion) return;
    prevFilterVersionRef.current = filterVersion;
    const layer = layerRef.current;
    const view = viewRef.current;
    if (!layer) return;
    layer.definitionExpression = buildWhere(propsRef.current.filters, propsRef.current.fieldMap);
    if (view && !propsRef.current.selectedOutlet) {
      layer.queryExtent()
        .then((r) => { if (r?.extent) view.goTo(r.extent.expand(1.1)).catch(() => {}); })
        .catch(() => {});
    }
  }, [filterVersion]);

  // Selection: draw a highlight marker and fly to it.
  useEffect(() => {
    const view = viewRef.current;
    const hl = highlightLayerRef.current;
    const Graphic = GraphicRef.current;
    const Point = PointRef.current;
    if (!view || !hl || !Graphic || !Point) return;

    const newSelId = selectedOutlet?.id ?? null;
    if (selectedIdRef.current === newSelId) return;
    selectedIdRef.current = newSelId;

    hl.removeAll();
    if (selectedOutlet && (selectedOutlet.lat || selectedOutlet.lng)) {
      hl.add(
        new Graphic({
          geometry: new Point({
            longitude: selectedOutlet.lng,
            latitude: selectedOutlet.lat,
            spatialReference: { wkid: 4326 },
          }),
          symbol: highlightSymbol(selectedOutlet.outletType) as never,
        })
      );
      const currentZoom = (view.zoom as number) ?? 5;
      view
        .goTo(
          { center: [selectedOutlet.lng, selectedOutlet.lat], zoom: Math.max(currentZoom, 13) },
          { duration: 600 }
        )
        .catch(() => {});
    }
  }, [selectedOutlet]);

  return <div ref={mapRef} className="map-view" />;
}

export default function MapView(props: MapViewProps) {
  const [webgl2, setWebgl2] = useState<boolean | null>(null);
  const typeLegend = useMemo(() => buildTypeLegend(props.outlets), [props.outlets]);

  useEffect(() => { setWebgl2(hasWebGL2()); }, []);

  if (webgl2 === null) return <div className="map-container" />;

  return (
    <div className="map-container">
      {webgl2 ? (
        <ArcGISMap {...props} />
      ) : (
        <Suspense fallback={<div className="map-view" />}>
          <LeafletMap
            outlets={props.outlets}
            selectedOutlet={props.selectedOutlet}
            onSelectOutlet={props.onSelectOutlet}
            filterVersion={props.filterVersion}
            loading={props.loading}
          />
        </Suspense>
      )}
      <div className="map-legend map-legend--types">
        <span className="legend-title">OUTLET TYPE</span>
        <div className="legend-scroll">
          {typeLegend.map(({ type, color }) => {
            const tier = getRetailTier(type);
            return (
              <span key={type} className="legend-item">
                {tier ? (
                  // Show the actual glyph at its relative size, so the legend
                  // explains both the shape and the small/medium/large scale.
                  <img
                    className="legend-glyph"
                    src={svgDataUri(tier.svg(tier.color))}
                    alt=""
                    width={Math.round(tier.size * 0.62)}
                    height={Math.round(tier.size * 0.62)}
                  />
                ) : (
                  <span className="legend-dot" style={{ background: color }} />
                )}
                {type}
              </span>
            );
          })}
        </div>
      </div>
      <StatsCards outlets={props.outlets} allOutlets={props.allOutlets} />
      {!webgl2 && (
        <div className="map-notice">
          <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Map preview uses Leaflet. ArcGIS renders in supported browsers.
        </div>
      )}
    </div>
  );
}
