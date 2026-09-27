import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { Outlet } from "../types";
import { getOutletTypeColor } from "../utils/outletTypeColor";
import { getRetailTier } from "../utils/outletTypeSymbol";

const STATUS_COLORS: Record<string, string> = {
  Active:   "#22c55e",
  Inactive: "#ef4444",
  Pending:  "#f59e0b",
};

interface LeafletMapProps {
  outlets: Outlet[];
  selectedOutlet: Outlet | null;
  onSelectOutlet: (o: Outlet | null) => void;
  filterVersion: number;
  loading: boolean;
}

function makeIcon(color: string, selected: boolean, outletType?: string) {
  // Mini / Super / Hyper markets render as sized store glyphs; every other
  // type keeps the plain dot. Mirrors the ArcGIS renderer.
  const tier = getRetailTier(outletType);
  if (tier) {
    const total = selected ? Math.round(tier.leafletSize * 1.45) : tier.leafletSize;
    const cx = total / 2;
    const glyph = tier.svg(tier.color)
      .replace(/width="\d+"/, `width="${total}"`)
      .replace(/height="\d+"/, `height="${total}"`);
    return L.divIcon({
      html: selected
        ? `<div style="filter:drop-shadow(0 0 6px ${tier.color})">${glyph}</div>`
        : glyph,
      className: "",
      iconSize: [total, total],
      iconAnchor: [cx, cx],
      popupAnchor: [0, -(cx + 4)],
    });
  }

  const size = selected ? 18 : 10;
  const ring = selected ? 5 : 2;
  const total = size + ring * 2;
  const cx = total / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}">
    ${selected ? `<circle cx="${cx}" cy="${cx}" r="${cx - 0.5}" fill="${color}" opacity="0.18"/>` : ""}
    <circle cx="${cx}" cy="${cx}" r="${size / 2}"
      fill="${color}" stroke="rgba(255,255,255,0.85)" stroke-width="${selected ? 2 : 1.5}"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [total, total],
    iconAnchor: [cx, cx],
    popupAnchor: [0, -(cx + 4)],
  });
}

function ok(v?: string) {
  return v && v !== "undefined" && v !== "null" && v !== "Unknown" && v !== "";
}

function makePopupHtml(outlet: Outlet): string {
  const color = STATUS_COLORS[outlet.status] ?? "#475569";
  const photo = ok(outlet.photoLink)
    ? `<div style="margin:-12px -12px 12px;border-radius:10px 10px 0 0;overflow:hidden;height:130px;background:#1e293b">
         <img src="${outlet.photoLink}" alt="outlet photo"
           style="width:100%;height:100%;object-fit:cover;display:block"
           onerror="this.parentElement.style.display='none'" />
       </div>`
    : "";
  return `
    <div style="font-family:Inter,system-ui,sans-serif;min-width:220px;max-width:280px;padding:12px">
      ${photo}
      <div style="font-size:13px;font-weight:700;color:#f1f5f9;margin-bottom:6px;line-height:1.35">${outlet.name}</div>
      ${ok(outlet.outletType) ? `<div style="font-size:11px;color:#94a3b8;margin-bottom:8px">${outlet.outletType}</div>` : ""}
      <div style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;
        background:${color}22;color:${color};border-radius:20px;padding:2px 8px;margin-bottom:10px">
        <span style="width:5px;height:5px;background:${color};border-radius:50%;display:inline-block"></span>
        ${outlet.status}
      </div>
      <div style="font-size:12px;color:#94a3b8;display:flex;flex-direction:column;gap:5px">
        ${ok(outlet.address) ? `
          <div style="display:flex;gap:6px;align-items:flex-start">
            <span style="margin-top:1px;opacity:.6">📍</span>
            <span>${outlet.address}</span>
          </div>` : ""}
        ${ok(outlet.phone) ? `
          <div style="display:flex;gap:6px;align-items:center">
            <span style="opacity:.6">📞</span>
            <span>${outlet.phone}</span>
          </div>` : ""}
      </div>
    </div>`;
}

export default function LeafletMap({ outlets, selectedOutlet, onSelectOutlet, filterVersion, loading }: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const initialFitDoneRef = useRef(false);
  const prevFilterVersionRef = useRef(filterVersion);
  const selectedIdRef = useRef<string | null>(null);
  const onSelectOutletRef = useRef(onSelectOutlet);
  onSelectOutletRef.current = onSelectOutlet;

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current) return;

    const map = L.map(containerRef.current, {
      center: [24.0, 45.0],
      zoom: 6,
      zoomControl: false,
      preferCanvas: true,
    });

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_matter/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
        subdomains: "abcd",
      }
    ).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    const cluster = L.markerClusterGroup({
      chunkedLoading: true,
      chunkInterval: 150,
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction(c) {
        const n = c.getChildCount();
        const size = n >= 1000 ? 48 : n >= 100 ? 40 : 32;
        return L.divIcon({
          html: `<div style="
            width:${size}px;height:${size}px;border-radius:50%;
            background:rgba(61,90,168,0.92);
            border:2px solid rgba(255,255,255,0.25);
            display:flex;align-items:center;justify-content:center;
            font-family:Inter,sans-serif;font-size:${size >= 48 ? 12 : 11}px;
            font-weight:700;color:#fff;
            box-shadow:0 2px 12px rgba(61,90,168,0.45)
          ">${n >= 1000 ? `${Math.round(n / 1000)}k` : n}</div>`,
          className: "",
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
      },
    });

    map.addLayer(cluster);
    mapRef.current = map;
    clusterRef.current = cluster;
    map.on("click", () => onSelectOutletRef.current(null));

    const markers = markersRef.current;
    return () => {
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
      markers.clear();
      initialFitDoneRef.current = false;
    };
  }, []);

  // Incrementally sync markers when outlets or selection change — reuse existing
  // markers, add only new ones, remove gone ones, restyle selection in place.
  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (!map || !cluster) return;

    const markers = markersRef.current;
    const validOutlets = outlets.filter((o) => o.lat !== 0 || o.lng !== 0);
    const nextIds = new Set<string>();
    const newMarkers: L.Marker[] = [];

    validOutlets.forEach((outlet) => {
      nextIds.add(outlet.id);
      if (markers.has(outlet.id)) return;

      const color = getOutletTypeColor(outlet.outletType);
      const isSelected = selectedOutlet?.id === outlet.id;
      const marker = L.marker([outlet.lat, outlet.lng], {
        icon: makeIcon(color, isSelected, outlet.outletType),
        zIndexOffset: isSelected ? 1000 : 0,
      });

      marker.bindPopup(makePopupHtml(outlet), { maxWidth: 280 });
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onSelectOutletRef.current(outlet);
        marker.openPopup();
      });

      markers.set(outlet.id, marker);
      newMarkers.push(marker);
    });

    // Remove markers no longer in the filtered set
    const toRemove: L.Marker[] = [];
    markers.forEach((marker, id) => {
      if (!nextIds.has(id)) { toRemove.push(marker); markers.delete(id); }
    });

    if (toRemove.length) cluster.removeLayers(toRemove);
    if (newMarkers.length) cluster.addLayers(newMarkers);

    // Update selection styling in place
    const prevSelId = selectedIdRef.current;
    const newSelId = selectedOutlet?.id ?? null;
    if (prevSelId !== newSelId) {
      if (prevSelId) {
        const pm = markers.get(prevSelId);
        const po = validOutlets.find((o) => o.id === prevSelId);
        if (pm && po) {
          pm.setIcon(makeIcon(getOutletTypeColor(po.outletType), false, po.outletType));
          pm.setZIndexOffset(0);
        }
      }
      if (newSelId) {
        const nm = markers.get(newSelId);
        const no = validOutlets.find((o) => o.id === newSelId);
        if (nm && no) {
          nm.setIcon(makeIcon(getOutletTypeColor(no.outletType), true, no.outletType));
          nm.setZIndexOffset(1000);
        }
      }
      selectedIdRef.current = newSelId;
    }

    const filterChanged = prevFilterVersionRef.current !== filterVersion;
    prevFilterVersionRef.current = filterVersion;

    if (selectedOutlet) {
      // Fly to selected outlet
      const found = validOutlets.find((o) => o.id === selectedOutlet.id);
      if (found) {
        map.flyTo([found.lat, found.lng], Math.max(map.getZoom(), 14), { duration: 0.8 });
        setTimeout(() => {
          const m = markersRef.current.get(found.id);
          if (m) { cluster.zoomToShowLayer(m, () => m.openPopup()); }
        }, 900);
      }
    } else if (filterChanged && validOutlets.length > 0) {
      // Fit bounds to filtered results
      const bounds = cluster.getBounds();
      if (bounds.isValid()) {
        const maxZoom = validOutlets.length < 50 ? 14 : validOutlets.length < 500 ? 12 : validOutlets.length < 5000 ? 9 : 7;
        map.fitBounds(bounds, { padding: [60, 60], maxZoom, animate: true });
      }
    } else if (!initialFitDoneRef.current && !loading && validOutlets.length > 0) {
      // Initial fit once the full dataset has finished streaming in
      const bounds = cluster.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 8 });
        initialFitDoneRef.current = true;
      }
    }
  }, [outlets, selectedOutlet, filterVersion, loading]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
