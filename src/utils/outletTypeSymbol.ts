import { getOutletTypeColor } from "./outletTypeColor";

/**
 * Retail-tier map symbology.
 *
 * Mini Market, SuperMarket and HyperMarket are the tiers the business reads the
 * map by, so they get a store glyph instead of a plain dot, scaled by tier —
 * a HyperMarket should look bigger than a corner mini market at a glance.
 *
 * Every other outlet type keeps the plain coloured dot. With 28 types on the
 * layer, giving each one its own glyph would produce shapes nobody can tell
 * apart at map zoom, and 52k picture markers is far heavier to render than
 * simple markers.
 *
 * Glyph design, smallest to largest:
 *   Mini Market  — a single shopfront with one awning bay
 *   SuperMarket  — a wider store with a shopping trolley
 *   HyperMarket  — a broad multi-bay building with a trolley and roof mass
 */

export interface RetailTier {
  /** Exact `English_Outlet_Type` value on the layer. */
  type: string;
  label: string;
  /** Marker size in px for the ArcGIS map. */
  size: number;
  /** Marker size in px for the Leaflet fallback. */
  leafletSize: number;
  color: string;
  svg: (color: string) => string;
}

const DOT = "#ffffff";

/** Mini Market — smallest: one narrow shopfront. */
function miniMarketSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <circle cx="16" cy="16" r="14" fill="${color}" stroke="${DOT}" stroke-width="2"/>
  <path d="M10 14h12v8H10z" fill="${DOT}"/>
  <path d="M9.5 11.5h13l-1 2.5h-11z" fill="${DOT}" opacity="0.75"/>
  <rect x="14.5" y="17" width="3" height="5" fill="${color}"/>
</svg>`;
}

/** SuperMarket — mid: wider store with a trolley. */
function superMarketSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
  <circle cx="20" cy="20" r="18" fill="${color}" stroke="${DOT}" stroke-width="2.5"/>
  <path d="M11 17h18v11H11z" fill="${DOT}"/>
  <path d="M10 13.5h20l-1.4 3.5H11.4z" fill="${DOT}" opacity="0.75"/>
  <rect x="13.5" y="20" width="5" height="8" fill="${color}"/>
  <g fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 20.5h6.5l-1 4h-4.6z"/>
  </g>
  <circle cx="22.4" cy="26.4" r="1" fill="${color}"/>
  <circle cx="26.2" cy="26.4" r="1" fill="${color}"/>
</svg>`;
}

/** HyperMarket — largest: broad multi-bay building with a trolley. */
function hyperMarketSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
  <circle cx="24" cy="24" r="22" fill="${color}" stroke="${DOT}" stroke-width="3"/>
  <path d="M11 20h26v15H11z" fill="${DOT}"/>
  <path d="M9.5 15h29l-2 5h-25z" fill="${DOT}" opacity="0.75"/>
  <rect x="14" y="24" width="6" height="11" fill="${color}"/>
  <rect x="22" y="24" width="4.5" height="6" fill="${color}" opacity="0.55"/>
  <g fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M29 24.5h8l-1.3 5.5h-5.7z"/>
  </g>
  <circle cx="30.8" cy="32.5" r="1.3" fill="${color}"/>
  <circle cx="35.4" cy="32.5" r="1.3" fill="${color}"/>
</svg>`;
}

export const RETAIL_TIERS: RetailTier[] = [
  {
    type: "Mini Market", label: "Mini Market",
    size: 18, leafletSize: 20,
    color: getOutletTypeColor("Mini Market"), svg: miniMarketSvg,
  },
  {
    type: "SuperMarket", label: "SuperMarket",
    size: 26, leafletSize: 28,
    color: getOutletTypeColor("SuperMarket"), svg: superMarketSvg,
  },
  {
    type: "HyperMarket", label: "HyperMarket",
    size: 36, leafletSize: 38,
    color: getOutletTypeColor("HyperMarket"), svg: hyperMarketSvg,
  },
];

const BY_TYPE = new Map(RETAIL_TIERS.map((t) => [t.type.toLowerCase(), t]));

/** Returns the retail tier for an outlet type, or undefined for a plain dot. */
export function getRetailTier(type: string | undefined): RetailTier | undefined {
  if (!type) return undefined;
  return BY_TYPE.get(type.trim().toLowerCase());
}

/**
 * Encodes an SVG as a data URI. `encodeURIComponent` rather than base64 keeps
 * the markup readable in devtools and avoids any unicode/btoa pitfalls.
 */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** ArcGIS picture-marker symbol for a retail tier. */
export function tierPictureSymbol(tier: RetailTier) {
  return {
    type: "picture-marker",
    url: svgDataUri(tier.svg(tier.color)),
    width: `${tier.size}px`,
    height: `${tier.size}px`,
  };
}
