import { Outlet } from "../types";

/**
 * Normalizes the outlet survey status vocabulary
 * (`English_Outlet_Status`) into the three states the UI renders.
 *
 * The source layer uses visit-outcome wording rather than a simple
 * active/inactive flag, so the mapping is explicit. Anything unrecognized
 * falls back to keyword sniffing and finally to "Inactive" — an unknown
 * status should never silently render as a healthy green outlet.
 *
 * Confirmed against the live ADHOC_KSA_Unicharm layer (see
 * .agents/layer-profile/schema-report.md). Its 7 observed values —
 * Not Selling FMCG, Refused, Refused to Continue Qnr, Successfully visited,
 * Temp Closed, Under Construction, Under Rennovation — are a subset of the
 * broader vocabulary this map already covers (inherited from the Alsafi
 * Danone build, which also saw Change Activity, Duplicate, Permanent Closed,
 * Removed, Shutting down, Not Reach). No changes were needed.
 */
const STATUS_MAP: Record<string, Outlet["status"]> = {
  // ── Active: the outlet was surveyed and is trading ──
  "successfully visited": "Active",
  "active": "Active",

  // ── Pending: temporarily unavailable, expected to return ──
  "temp closed": "Pending",
  "temporarily closed": "Pending",
  "under construction": "Pending",
  "under rennovation": "Pending",
  "under renovation": "Pending",
  "change activity": "Pending",
  "not reach": "Pending",
  "refused": "Pending",
  "refused to continue qnr": "Pending",

  // ── Inactive: gone, or not part of the universe ──
  "permanent closed": "Inactive",
  "permanently closed": "Inactive",
  "shutting down": "Inactive",
  "removed": "Inactive",
  "duplicate": "Inactive",
  "not selling fmcg": "Inactive",
  "inactive": "Inactive",
};

// ── Arabic status vocabulary (K-Group / ADHOC_DB_KGroup) ──────────────────
// The K-Group layer stores `Outlet_Status` in Arabic. Match on distinctive
// tokens rather than whole strings so minor wording variants still resolve.
// Observed values: زيارة ناجحة, زيارة ناجحة بدون استمارة, رفض,
// رفض استكمال الاستمارة, مغلق مؤقت, مغلق مؤقت ويتعامل, مغلق موسمي,
// تحت الانشاء, تحت التجديد, تحت التصفية.
function coerceArabicStatus(raw: string): Outlet["status"] | undefined {
  if (raw.includes("ناجحة")) return "Active";        // successful visit
  if (raw.includes("التصفية")) return "Inactive";    // under liquidation
  if (raw.includes("رفض")) return "Pending";         // refused
  if (raw.includes("مؤقت")) return "Pending";        // temporarily closed
  if (raw.includes("موسمي")) return "Pending";       // seasonally closed
  if (raw.includes("الانشاء") || raw.includes("إنشاء")) return "Pending"; // under construction
  if (raw.includes("التجديد")) return "Pending";     // under renovation
  return undefined;
}

/**
 * True when the outlet was actually surveyed (a successful visit). Used as the
 * base for competitive coverage/share stats. Handles both the English wording
 * ("Successfully visited") and the Arabic ("زيارة ناجحة").
 */
export function isSuccessfulVisit(raw: unknown): boolean {
  const s = String(raw ?? "").trim();
  return s.toLowerCase().includes("success") || s.includes("ناجحة");
}

export function coerceStatus(raw: unknown): Outlet["status"] {
  const original = String(raw ?? "").trim();
  const s = original.toLowerCase();
  if (!s) return "Inactive";

  const exact = STATUS_MAP[s];
  if (exact) return exact;

  // Arabic vocabulary (K-Group layer).
  const ar = coerceArabicStatus(original);
  if (ar) return ar;

  // Fallback keyword sniffing for values not yet seen in the layer.
  if (s.includes("success") || s === "1" || s === "true" || s === "yes") return "Active";
  if (s.includes("temp") || s.includes("construction") || s.includes("renn") ||
      s.includes("renov") || s.includes("pend") || s.includes("review") ||
      s.includes("refus") || s.includes("reach")) return "Pending";
  if (s.includes("closed") || s.includes("shut") || s.includes("remov") ||
      s.includes("duplicate") || s.includes("inact") ||
      s === "0" || s === "false" || s === "no") return "Inactive";

  return "Inactive";
}
