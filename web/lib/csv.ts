// Pure module (no imports) so it can be unit-tested with plain `node --test`.

type Cell = string | number | boolean | null | undefined;

/**
 * One CSV cell. Text starting with = + - @ (or a tab/CR) is prefixed with an
 * apostrophe so spreadsheets don't run it as a formula: the export includes
 * free text typed by the user (comments, tags), which can't be trusted once
 * the file is opened in Excel. Real numbers are passed through untouched.
 */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}
