// src/lib/periods.ts
//
// Three period-label shapes reach this dashboard: "2019" (annual), "1Q26"
// (quarterly, the Nu_Brazil workbook) and "Aug 2026" (monthly, the BCB
// workbook). Anything that steps back "a year" or compares "the same season"
// has to ask the data which shape it is reading — a hardcoded 4 would compare
// a monthly reading with the one four MONTHS earlier and call it year-on-year.
import type { ChartData } from "../data/datasets";

export const isMonthly = (period: string) => /^[A-Z][a-z]{2} \d{4}$/.test(period);
export const isQuarterly = (period: string) => /^\dQ\d{2}$/.test(period);

/** Readings per year at a dataset's native frequency (read off its newest label): 12, 4 or 1. */
export function perYear(d: ChartData): number {
  const p = d.periods[d.periods.length - 1] ?? "";
  return isMonthly(p) ? 12 : isQuarterly(p) ? 4 : 1;
}

/** "month" / "quarter" / "year" — what one step along a dataset's axis is. */
export function stepName(d: ChartData): string {
  const n = perYear(d);
  return n === 12 ? "month" : n === 4 ? "quarter" : "year";
}

/** Count of steps with the unit, pluralised: "3 months", "1 quarter". */
export function steps(d: ChartData, n: number): string {
  return `${n} ${stepName(d)}${n === 1 ? "" : "s"}`;
}

/** Same-season key — "Aug" for a month, "1Q" for a quarter, "" for a year. */
export function seasonOf(period: string): string {
  if (isMonthly(period)) return period.slice(0, 3);
  if (isQuarterly(period)) return period.slice(0, 2);
  return "";
}
