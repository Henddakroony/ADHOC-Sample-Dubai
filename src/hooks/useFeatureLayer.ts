import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, OutletFieldMap } from "../types";
import { coerceStatus } from "../utils/outletStatus";
import { registerOutletTypes } from "../utils/outletTypeColor";

const LAYER_URL = (import.meta.env.VITE_OUTLET_LAYER_URL as string | undefined)?.replace(/\/$/, "");
const API_KEY = (import.meta.env.VITE_ARCGIS_API_KEY as string | undefined) ?? "";
const TIMEOUT_MS = 30_000;
const FIELD_FETCH_TIMEOUT_MS = 60_000; // Wide field selections take longer

async function fetchWithTimeout(url: string, options?: RequestInit, timeoutMs: number = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function parseArcgisJson(res: Response): Promise<Record<string, unknown>> {
  let data: Record<string, unknown>;
  try {
    data = await res.json() as Record<string, unknown>;
  } catch {
    throw new Error(`Non-JSON response (HTTP ${res.status})`);
  }
  const errObj = (data as {
    error?: { code?: number; message?: string; details?: string[] };
  }).error;
  if (errObj) throw new Error(formatArcgisError(errObj));
  return data;
}

async function arcgisGet(url: string): Promise<Record<string, unknown>> {
  const sep = url.includes("?") ? "&" : "?";
  const fullUrl = API_KEY ? `${url}${sep}token=${encodeURIComponent(API_KEY)}` : url;
  let res: Response;
  try {
    res = await fetchWithTimeout(fullUrl);
  } catch (err) {
    throw new Error(`Network error: ${String(err)}`, { cause: err });
  }
  return parseArcgisJson(res);
}

async function arcgisQueryPost(params: Record<string, string>): Promise<Record<string, unknown>> {
  const bodyObj = API_KEY ? { ...params, token: API_KEY } : params;
  const body = new URLSearchParams(bodyObj);
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${LAYER_URL}/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      FIELD_FETCH_TIMEOUT_MS
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    throw new Error(`Network error: ${String(err)}`, { cause: err });
  }
  return parseArcgisJson(res);
}

/**
 * ArcGIS often returns an empty `message` and puts the real cause in
 * `details` — a bare "ArcGIS error 400:" tells you nothing, so fold the
 * details in and add a hint for the failure that actually bites in practice.
 */
function formatArcgisError(err: { code?: number; message?: string; details?: string[] }): string {
  const parts = [err.message, ...(err.details ?? [])].filter(
    (p): p is string => typeof p === "string" && p.trim() !== "",
  );
  const text = parts.join(" — ") || JSON.stringify(err);

  // Overwriting a hosted feature service in ArcGIS Online can republish the
  // data under a NEW sublayer id, which breaks a URL pinned to the old one.
  const layerGone = /layer.*not found|layerId/i.test(text);
  const hint = layerGone
    ? " · The layer id in VITE_OUTLET_LAYER_URL no longer exists — this usually" +
      " happens after overwriting the service. Open the FeatureServer root URL" +
      " in a browser to see the current layer id and update the variable."
    : "";

  return `ArcGIS error ${err.code ?? "?"}: ${text}${hint}`;
}

function findField(fields: string[], candidates: string[]): string | undefined {
  for (const c of candidates) {
    const m = fields.find((f) => f.toLowerCase() === c.toLowerCase());
    if (m) return m;
  }
  return fields.find((f) => candidates.some((c) => f.toLowerCase().includes(c.toLowerCase())));
}

type Feature = {
  attributes: Record<string, unknown>;
  geometry: { x?: number; y?: number } | null;
};

const PAGE_RETRY_ATTEMPTS = 3;
const PAGE_RETRY_DELAY_MS = 1000;

async function fetchPage(outFields: string, returnGeometry: boolean, offset: number, pageSize: number): Promise<Feature[]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= PAGE_RETRY_ATTEMPTS; attempt++) {
    try {
      const pageData = await arcgisQueryPost({
        where: "1=1",
        outFields,
        returnGeometry: returnGeometry ? "true" : "false",
        outSR: "4326",
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
        f: "json",
      }) as {
        features?: Feature[];
        exceededTransferLimit?: boolean;
      };
      return pageData.features ?? [];
    } catch (err) {
      lastErr = err;
      if (attempt < PAGE_RETRY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, PAGE_RETRY_DELAY_MS * attempt));
      }
    }
  }
  throw lastErr;
}

export interface RawField {
  name: string;
  alias: string;
  type: string;
}

interface ServiceMeta {
  pageSize: number;
  totalCount: number;
  objectIdField: string;
}

export interface FeatureLayerState {
  outlets: Outlet[];
  loading: boolean;
  loadingProgress: number;
  loadingTotal: number;
  error: string | null;
  districts: string[];
  regions: string[];
  governorates: string[];
  segmentations: string[];
  channels: string[];
  outletTypes: string[];
  matchingStatuses: string[];
  objectIdField: string;
  allFields: RawField[];
  fieldMap: OutletFieldMap;
  layerUrl: string;
  fullRows: Record<string, unknown>[];
  fullLoading: boolean;
  fullLoaded: boolean;
  fullError: string | null;
  // Names of fields whose values have actually been merged into fullRows —
  // lets a consumer (e.g. table exports) tell "loaded but empty" apart from
  // "not fetched yet" for any given column, instead of trusting fullLoading
  // alone (which only reflects whatever fetch happens to be in flight).
  loadedFieldNames: string[];
  // Progress of the on-demand field fetch, in pages (each ~pageSize outlets).
  // Both 0 when no field fetch is running; `fieldFetchTotal` is 0 while the
  // page count is still unknown, which the UI reads as "indeterminate".
  fieldFetchProgress: number;
  fieldFetchTotal: number;
  ensureFields: (names: string[]) => void;
  refetch: () => void;
}

export function useFeatureLayer(): FeatureLayerState {
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  const [state, setState] = useState<Omit<FeatureLayerState, "refetch" | "ensureFields" | "layerUrl">>({
    outlets: [],
    loading: true,
    loadingProgress: 0,
    loadingTotal: 0,
    error: null,
    districts: [],
    regions: [],
    governorates: [],
    segmentations: [],
    channels: [],
    outletTypes: [],
    matchingStatuses: [],
    objectIdField: "OBJECTID",
    allFields: [],
    fieldMap: { oid: "OBJECTID" },
    fullRows: [],
    fullLoading: false,
    fullLoaded: false,
    fullError: null,
    loadedFieldNames: [],
    fieldFetchProgress: 0,
    fieldFetchTotal: 0,
  });

  // Service metadata captured during the lean load, reused by the on-demand
  // field fetch that enriches the data-table / export rows.
  const [serviceMeta, setServiceMeta] = useState<ServiceMeta | null>(null);

  // ── On-demand field loading ────────────────────────────────────
  // The lean load seeds `fullRows` with the map/default fields it already
  // fetched. Additional fields (extra table columns, export selections) are
  // fetched lazily and merged into the existing rows by OBJECTID, rather than
  // pulling all ~580 fields up front (which made the data table load slowly).
  const rowsByOidRef = useRef<Map<unknown, Record<string, unknown>>>(new Map());
  const rowsArrayRef = useRef<Record<string, unknown>[]>([]);
  const loadedFieldsRef = useRef<Set<string>>(new Set());
  const requestedFieldsRef = useRef<Set<string>>(new Set());
  const inFlightFieldsRef = useRef<Set<string>>(new Set());
  const oidFieldRef = useRef<string>("OBJECTID");
  const fetchTokenRef = useRef(0);
  const [fetchSignal, setFetchSignal] = useState(0);

  const ensureFields = useCallback((names: string[]) => {
    for (const n of names) {
      if (n) requestedFieldsRef.current.add(n);
    }
    setFetchSignal((x) => x + 1);
  }, []);


  // ── Lean load: only the fields the map + sidebar need ──────────
  useEffect(() => {
    if (!LAYER_URL) {
      setState((s) => ({ ...s, loading: false, error: "VITE_OUTLET_LAYER_URL is not set" }));
      return;
    }
    if (!API_KEY) {
      setState((s) => ({ ...s, loading: false, error: "VITE_ARCGIS_API_KEY is not set" }));
      return;
    }

    let cancelled = false;
    setState((s) => ({
      ...s,
      loading: true,
      loadingProgress: 0,
      error: null,
      fullRows: [],
      fullLoading: false,
      fullLoaded: false,
      fullError: null,
      loadedFieldNames: [],
      fieldFetchProgress: 0,
      fieldFetchTotal: 0,
    }));
    setServiceMeta(null);
    // Reset the on-demand field accumulator for a fresh load. `requestedFields`
    // is intentionally preserved so the fields consumers already asked for get
    // re-fetched once the new metadata arrives. Bumping the fetch token aborts
    // any field fetch still in flight from the previous load.
    fetchTokenRef.current += 1;
    rowsByOidRef.current = new Map();
    rowsArrayRef.current = [];
    loadedFieldsRef.current = new Set();
    inFlightFieldsRef.current = new Set();

    async function load() {
      try {
        // ── 1. Service metadata ──────────────────────────────────
        console.log("[useFeatureLayer] fetching metadata");
        const meta = await arcgisGet(`${LAYER_URL}?f=json`) as {
          fields?: Array<{ name: string; alias?: string; type: string }>;
          objectIdField?: string;
          maxRecordCount?: number;
        };
        if (cancelled) return;

        const rawFieldDefs: RawField[] = (meta.fields ?? []).map((f) => ({
          name: f.name,
          alias: f.alias ?? f.name,
          type: f.type ?? "",
        }));
        const fieldNames = rawFieldDefs.map((f) => f.name);
        const oidField = meta.objectIdField ?? "OBJECTID";
        const pageSize = Math.min(meta.maxRecordCount ?? 1000, 2000);

        // Fixed fields from user spec
        const districtField   = fieldNames.find((f) => f === "English_Dis")      ?? fieldNames.find((f) => f === "Sector_Name_English") ?? findField(fieldNames, ["English_Dis", "English_District", "DISTRICT_ENGLISH_NAME", "District_English_Name", "District", "Sector_Name_English", "Shiakha_Name_English"]);
        const regionField     = fieldNames.find((f) => f === "English_Region")   ?? findField(fieldNames, ["English_Region", "EMIRATE_ENGLISH_NAME", "Emirate_English_Name", "Emirate", "Region"]);
        const govField        = fieldNames.find((f) => f === "English_Gov")       ?? findField(fieldNames, ["English_Gov", "Governorate"]);
        const channelField    = fieldNames.find((f) => f === "Channel")           ?? findField(fieldNames, ["Channel", "Category", "English_AreaType", "AreaType"]);
        // Prefer the English outlet-type column when the layer carries one
        // (K-Group's `Outlet_Type` is Arabic; `English_Type` is the English form).
        const outletTypeField = fieldNames.find((f) => f === "English_Outlet_Type") ?? fieldNames.find((f) => f === "English_Type") ?? findField(fieldNames, ["English_Outlet_Type", "English_Type", "Outlet_Type"]);

        // Name field — prefer English outlet name
        const nameField = findField(fieldNames, [
          "English_Outlet_Name", "English_Name", "Outlet_Name", "Name",
          "English_Zone_Name", "Zone_Name", "TITLE", "LABEL",
        ]) ?? fieldNames[0] ?? oidField;

        // Status field — prefer English
        const statusField = findField(fieldNames, [
          "English_Outlet_Status", "English_Status", "Status",
          "Arabic_Outlet_Status", "ACTIVE", "STATUS_CODE",
        ]);

        const segmentationField = findField(fieldNames, [
          "New_Safi_Segmentation",
          "Final_Segmentation", "Adhoc_Segmentation", "ADHOC_Segmentation",
          "Store_Segmentation", "StoreSegmentation",
          "Segmentation", "Store_Segment", "Segment", "Category_Segmentation", "Channel_Segmentation",
        ]);

        const adhocCodeField = findField(fieldNames, ["ADHOC_Code", "Adhoc_Code", "adhoc_code", "ADHOC_ID", "Adhoc_ID"]);
        const addressField   = findField(fieldNames, ["Address", "FULL_ADDR", "Street", "Location"]);
        const phoneField     = findField(fieldNames, ["Phone_Number___Mobile1", "Telephone___Cell_Phone", "Mobile", "Phone", "Tel", "Telephone", "Contact"]);
        const photoLinkField = findField(fieldNames, ["Photos_Link_2025", "Photo_Link_2025", "Photo_Link", "PhotoLink", "Photo_URL", "Image_URL"]);

        // Matching_Status — exact name preferred, then fuzzy
        const matchingStatusField = fieldNames.find((f) => f === "Matching_Status") ?? findField(fieldNames, ["Matching_Status"]);

        // Arabic outlet name is one of the default table columns, so fetch it
        // with the lean set to keep the default data-table view instant.
        const arabicNameField = findField(fieldNames, ["Arabic_Outlet_Name", "Arabic_Name"]);

        // Lean field set: what mapFeature reads to build an Outlet, plus the
        // default data-table columns. Extra fields are fetched on demand.
        const leanFieldSet = new Set<string>([oidField, nameField]);
        for (const f of [
          districtField, regionField, govField, channelField, outletTypeField, segmentationField,
          statusField, addressField, phoneField, photoLinkField, arabicNameField, matchingStatusField,
          adhocCodeField,
        ]) {
          if (f) leanFieldSet.add(f);
        }
        const outFields = Array.from(leanFieldSet).join(",");

        console.log("[useFeatureLayer] fields:", { regionField, govField, channelField, outletTypeField, nameField, statusField, segmentationField, addressField, phoneField, photoLinkField, matchingStatusField, adhocCodeField });
        console.log("[useFeatureLayer] lean outFields:", outFields);

        const fieldMap: OutletFieldMap = {
          oid: oidField,
          name: nameField,
          district: districtField,
          region: regionField,
          gov: govField,
          channel: channelField,
          outletType: outletTypeField,
          segmentation: segmentationField,
          status: statusField,
          address: addressField,
          phone: phoneField,
          photoLink: photoLinkField,
          matchingStatus: matchingStatusField,
        };
        setState((s) => ({ ...s, fieldMap }));

        // ── 2. Get total record count ────────────────────────────
        const countParams = new URLSearchParams({ where: "1=1", returnCountOnly: "true", f: "json" });
        const countData = await arcgisGet(`${LAYER_URL}/query?${countParams}`) as { count?: number };
        if (cancelled) return;
        const totalCount = countData.count ?? 0;
        console.log("[useFeatureLayer] total records:", totalCount);

        setState((s) => ({ ...s, loadingTotal: totalCount }));

        // ── 3. Streaming, parallel pagination ────────────────────
        // Field-detection / normalization (unchanged behavior, applied per row)
        const mapFeature = (feature: Feature, idx: number): Outlet => {
          const attr = feature.attributes;
          const geom = feature.geometry;
          return {
            id: String(attr[oidField] ?? idx),
            name: String(attr[nameField] ?? `Outlet ${idx + 1}`),
            district: districtField ? String(attr[districtField] ?? "Unknown") : "Unknown",
            region: regionField ? String(attr[regionField] ?? "Unknown") : "Unknown",
            governorate: govField ? String(attr[govField] ?? "Unknown") : "Unknown",
            channel: channelField ? String(attr[channelField] ?? "Unknown") : "Unknown",
            outletType: outletTypeField ? String(attr[outletTypeField] ?? "Unknown") : "Unknown",
            segmentation: segmentationField ? String(attr[segmentationField] ?? "Unknown") : "Unknown",
            status: coerceStatus(statusField ? attr[statusField] : "Active"),
            address: addressField ? String(attr[addressField] ?? "") : "",
            lat: geom?.y ?? 0,
            lng: geom?.x ?? 0,
            phone: phoneField ? String(attr[phoneField] ?? "") : undefined,
            photoLink: photoLinkField ? String(attr[photoLinkField] ?? "") : undefined,
            matchingStatus: matchingStatusField ? String(attr[matchingStatusField] ?? "") : undefined,
          };
        };

        const clean = (v: string) => v && v !== "Unknown" && v !== "null" && v !== "undefined";
        const buildList = (set: Set<string>) => ["All", ...Array.from(set).sort()];

        // Accumulators shared across parallel page workers
        const outlets: Outlet[] = [];
        const districtSet = new Set<string>();
        const regionSet = new Set<string>();
        const govSet = new Set<string>();
        const channelSet = new Set<string>();
        const typeSet = new Set<string>();
        const segSet = new Set<string>();
        const matchingStatusSet = new Set<string>();

        const ingest = (features: Feature[]) => {
          for (const f of features) {
            const o = mapFeature(f, outlets.length);
            outlets.push(o);
            const attrs = f.attributes;
            rowsArrayRef.current.push(attrs);
            rowsByOidRef.current.set(attrs[oidField], attrs);
            if (clean(o.district)) districtSet.add(o.district);
            if (clean(o.region)) regionSet.add(o.region);
            if (clean(o.governorate)) govSet.add(o.governorate);
            if (clean(o.channel)) channelSet.add(o.channel);
            if (clean(o.outletType)) typeSet.add(o.outletType);
            if (segmentationField && clean(o.segmentation)) segSet.add(o.segmentation);
            if (matchingStatusField && o.matchingStatus && clean(o.matchingStatus)) matchingStatusSet.add(o.matchingStatus);
          }
        };

        const publish = (done: boolean) => {
          // Assign distinct colours as soon as the type list is known, so the
          // map, legend, sidebar and charts all agree.
          registerOutletTypes(Array.from(typeSet));
          setState((s) => ({
            ...s,
            outlets: outlets.slice(),
            loading: !done,
            loadingProgress: outlets.length,
            loadingTotal: totalCount > 0 ? totalCount : outlets.length,
            error: null,
            districts: buildList(districtSet),
            regions: buildList(regionSet),
            governorates: buildList(govSet),
            channels: buildList(channelSet),
            outletTypes: buildList(typeSet),
            segmentations: segmentationField && segSet.size > 0 ? buildList(segSet) : [],
            matchingStatuses: matchingStatusField && matchingStatusSet.size > 0 ? buildList(matchingStatusSet) : [],
            objectIdField: oidField,
            allFields: rawFieldDefs,
          }));
        };

        const pageCount = totalCount > 0 ? Math.ceil(totalCount / pageSize) : 1;
        const offsets = Array.from({ length: pageCount }, (_, i) => i * pageSize);

        // Worker pool: surface each page to the UI as it arrives.
        const CONCURRENCY = 6;
        let nextOffsetIdx = 0;
        const worker = async () => {
          while (true) {
            const i = nextOffsetIdx++;
            if (i >= offsets.length) break;
            if (cancelled) return;
            const features = await fetchPage(outFields, true, offsets[i], pageSize);
            if (cancelled) return;
            ingest(features);
            console.log(`[useFeatureLayer] loaded ${outlets.length}/${totalCount}`);
            publish(false);
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, offsets.length) }, worker)
        );
        if (cancelled) return;

        console.log("[useFeatureLayer] all features loaded:", outlets.length);
        publish(true);

        // Seed the data-table rows from the fields we already fetched and record
        // which fields are present, so extra columns can be fetched lazily and
        // merged in on demand.
        oidFieldRef.current = oidField;
        loadedFieldsRef.current = new Set(leanFieldSet);
        setState((s) => ({
          ...s,
          fullRows: rowsArrayRef.current.slice(),
          fullLoaded: true,
          fullLoading: false,
          fullError: null,
          loadedFieldNames: Array.from(leanFieldSet),
        }));

        // Publish service metadata; this also triggers the on-demand field
        // effect to fetch any fields consumers already requested.
        setServiceMeta({ pageSize, totalCount, objectIdField: oidField });
      } catch (err) {
        console.error("[useFeatureLayer] error:", err);
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: String(err) }));
      }
    }

    load();
    return () => { cancelled = true; };
  }, [reloadKey]);

  // ── On-demand field fetch ──────────────────────────────────────
  // Runs whenever consumers request fields (via ensureFields) or when fresh
  // metadata arrives after a reload. Fetches only the requested fields that
  // aren't already loaded and merges them into the existing rows by OBJECTID.
  useEffect(() => {
    if (!serviceMeta) return;
    if (!LAYER_URL || !API_KEY) return;

    const missing = Array.from(requestedFieldsRef.current).filter(
      (f) => !loadedFieldsRef.current.has(f) && !inFlightFieldsRef.current.has(f)
    );
    if (missing.length === 0) return;

    for (const f of missing) inFlightFieldsRef.current.add(f);
    const token = fetchTokenRef.current;
    const oid = oidFieldRef.current;

    const { pageSize, totalCount } = serviceMeta;
    const pageCount = totalCount > 0 ? Math.ceil(totalCount / pageSize) : 1;

    setState((s) => ({
      ...s,
      fullLoading: true,
      fullError: null,
      fieldFetchProgress: 0,
      fieldFetchTotal: pageCount,
    }));

    async function fetchMissing() {
      try {
        const offsets = Array.from({ length: pageCount }, (_, i) => i * pageSize);
        const outFields = [oid, ...missing].join(",");

        let pagesDone = 0;
        const CONCURRENCY = 6;
        let nextOffsetIdx = 0;
        const worker = async () => {
          while (true) {
            const i = nextOffsetIdx++;
            if (i >= offsets.length) break;
            if (token !== fetchTokenRef.current) return;
            const features = await fetchPage(outFields, false, offsets[i], pageSize);
            if (token !== fetchTokenRef.current) return;
            for (const f of features) {
              const row = rowsByOidRef.current.get(f.attributes[oid]);
              if (row) Object.assign(row, f.attributes);
            }
            pagesDone += 1;
            setState((s) => ({ ...s, fieldFetchProgress: pagesDone }));
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, offsets.length) }, worker)
        );
        if (token !== fetchTokenRef.current) return;

        for (const f of missing) {
          loadedFieldsRef.current.add(f);
          inFlightFieldsRef.current.delete(f);
        }
        console.log("[useFeatureLayer] merged fields:", missing.join(","));
        const stillLoading = inFlightFieldsRef.current.size > 0;
        setState((s) => ({
          ...s,
          fullRows: rowsArrayRef.current.slice(),
          fullLoading: stillLoading,
          loadedFieldNames: Array.from(loadedFieldsRef.current),
          fieldFetchProgress: stillLoading ? s.fieldFetchProgress : 0,
          fieldFetchTotal: stillLoading ? s.fieldFetchTotal : 0,
        }));
      } catch (err) {
        console.error("[useFeatureLayer] field fetch error:", err);
        if (token !== fetchTokenRef.current) return;
        for (const f of missing) inFlightFieldsRef.current.delete(f);
        const stillLoading = inFlightFieldsRef.current.size > 0;
        setState((s) => ({
          ...s,
          fullLoading: stillLoading,
          fullError: String(err),
          fieldFetchProgress: stillLoading ? s.fieldFetchProgress : 0,
          fieldFetchTotal: stillLoading ? s.fieldFetchTotal : 0,
        }));
      }
    }

    fetchMissing();
  }, [fetchSignal, serviceMeta]);

  return { ...state, layerUrl: LAYER_URL ?? "", ensureFields, refetch };
}
