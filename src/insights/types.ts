// src/insights/types.ts
import type { ChartData } from "../data/datasets";

export type InsightKind = "opportunity" | "risk" | "watch" | "change" | "structural";

/** One numbered row of the transparent calculation trail. */
export interface CalcStep {
  label: string;   // plain-language description of the step
  math: string;    // the actual arithmetic with real numbers, e.g. "14.9 ÷ 23.6"
  result: string;  // formatted result of this step
  source?: string; // where the inputs come from, e.g. "Loans sheet · Credit card · 4Q25"
}

export interface Evidence {
  title: string;
  type: "line" | "bar";
  data: ChartData;
  unit?: string;     // "%" (default), "" for ratios, "pp", …
  decimals?: number;
}

export interface Insight {
  id: string;
  kind: InsightKind;
  confidence: "High" | "Medium";
  title: string;
  takeaway: string;                       // one-sentence so-what
  stat: { value: string; label: string }; // hero number on the card
  detail: string;                         // 2–3 sentence expansion (modal)
  sources: string[];                      // sheets/series used
  formula: string;                        // the whole calculation in one line
  steps: CalcStep[];                      // step-by-step with real numbers
  caveats: string[];                      // what could weaken the conclusion
  evidence: Evidence;                     // supporting chart
}
