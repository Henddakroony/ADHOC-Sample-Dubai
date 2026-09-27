/**
 * Color assignment for the Routing map.
 *
 * Two symbology modes:
 *  - "vanDay"  — a fixed categorical palette (Van Day is a small set, 1..12+).
 *  - "vanCode" — hash each numeric van code to a palette slot (53+ vans, so a
 *    stable hash keeps the same van the same color across renders).
 */

export type SymbologyMode = "vanCode" | "vanDay";

/** 12-slot palette for Van Day — brand baby-blue leads, then distinct hues. */
export const VAN_DAY_PALETTE = [
  "#5BBEE8", "#7B7FD1", "#14A38B", "#E8871E", "#C0399F", "#3AA0FF",
  "#E2B33C", "#5AC98A", "#D64545", "#8B5EDC", "#2FB0C6", "#E86FA6",
];

/** Wider palette for Van Code hashing. */
export const VAN_CODE_PALETTE = [
  "#5BBEE8", "#F59E0B", "#14B8A6", "#A855F7", "#EC4899", "#3B82F6",
  "#EF4444", "#EAB308", "#06B6D4", "#8B5CF6", "#F97316", "#10B981",
  "#6366F1", "#D946EF", "#84CC16", "#0EA5E9", "#F43F5E", "#22C55E",
];

export function colorForVanDay(day: number | string | null | undefined): string {
  const n = Number(day);
  if (!Number.isFinite(n)) return "#64748b";
  const idx = ((Math.trunc(n) - 1) % VAN_DAY_PALETTE.length + VAN_DAY_PALETTE.length) % VAN_DAY_PALETTE.length;
  return VAN_DAY_PALETTE[idx];
}

export function colorForVanCode(code: number | string | null | undefined): string {
  const n = Number(code);
  if (!Number.isFinite(n)) return "#64748b";
  const idx = (Math.abs(Math.trunc(n)) * 2654435761) % VAN_CODE_PALETTE.length;
  return VAN_CODE_PALETTE[idx];
}

export function colorFor(mode: SymbologyMode, value: number | string | null | undefined): string {
  return mode === "vanDay" ? colorForVanDay(value) : colorForVanCode(value);
}
