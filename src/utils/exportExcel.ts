import * as XLSX from "xlsx";

/**
 * Downloads an Excel file from an array of row objects.
 * @param rows       Array of plain objects (all values must be serialisable).
 * @param columnOrder Optional explicit column order; defaults to keys of rows[0].
 * @param sheetName  Name of the worksheet tab (max 31 chars).
 * @param fileName   Output file name without extension.
 */
export function downloadExcel(
  rows: Record<string, unknown>[],
  columnOrder: string[],
  sheetName: string,
  fileName: string,
): void {
  if (!rows.length) return;

  // Build ordered row objects
  const data = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const k of columnOrder) {
      out[k] = r[k] ?? "";
    }
    return out;
  });

  const ws = XLSX.utils.json_to_sheet(data, { header: columnOrder });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

/** Returns a compact date string like 20260808 for use in file names. */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
