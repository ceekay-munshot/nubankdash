// src/data/loans.ts
//
// The quarterly loan series the dashboard reads: the Nu_Brazil workbook's
// (datasets.ts / absolutes.ts), with any NEWER quarters fetched straight from
// the workbook's own source, BCB IF.data (ifdata.ts, scratchpad/fetch_ifdata.py),
// appended. The workbook always wins for a quarter it covers, so when the next
// edition arrives its numbers replace the fetched ones with no code change.
import type { ChartData } from "./datasets";
import {
  creditCardShare as ccShareWb, unsecuredShare as unsShareWb, payrollShare as payShareWb,
} from "./datasets";
import {
  loanAbsCreditCard as ccAbsWb, loanAbsUnsecured as unsAbsWb, loanAbsPayroll as payAbsWb,
} from "./absolutes";
import {
  creditCardShareExt, unsecuredShareExt, payrollShareExt,
  loanAbsCreditCardExt, loanAbsUnsecuredExt, loanAbsPayrollExt,
} from "./ifdata";

/** `base` with every period of `more` that `base` lacks appended, series matched by name. */
function extend(base: ChartData, more: ChartData): ChartData {
  const add = more.periods.filter((p) => !base.periods.includes(p));
  if (add.length === 0) return base;
  return {
    periods: [...base.periods, ...add],
    series: base.series.map((s) => {
      const m = more.series.find((x) => x.name === s.name);
      return {
        name: s.name,
        values: [...s.values, ...add.map((p) => m?.values[more.periods.indexOf(p)] ?? null)],
      };
    }),
  };
}

export const creditCardShare = extend(ccShareWb, creditCardShareExt);
export const unsecuredShare = extend(unsShareWb, unsecuredShareExt);
export const payrollShare = extend(payShareWb, payrollShareExt);
export const loanAbsCreditCard = extend(ccAbsWb, loanAbsCreditCardExt);
export const loanAbsUnsecured = extend(unsAbsWb, loanAbsUnsecuredExt);
export const loanAbsPayroll = extend(payAbsWb, loanAbsPayrollExt);
