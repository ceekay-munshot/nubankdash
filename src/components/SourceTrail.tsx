// src/components/SourceTrail.tsx
import { t } from "../theme";
import { WidgetCard } from "./WidgetCard";
import {
  creditCardShare, tpvShare, systemNpl, householdNpl, personalLoanRate, costOfRisk,
  type ChartData,
} from "../data/datasets";

/** The workbook edition these series were generated from. */
export const WORKBOOK = "Nu_Brazil.xlsx (08.24.2026)";

/** "1Q16–2Q26" — read off the data so the provenance copy cannot go stale. */
function coverage(d: ChartData): string {
  return `${d.periods[0]}–${d.periods[d.periods.length - 1]}`;
}

/** Periods where a series has no value for ANY entity — a hole in the source. */
function gaps(d: ChartData): string[] {
  return d.periods.filter((_, i) => d.series.every((s) => s.values[i] === null));
}

interface SourceEntry {
  title: string;
  detail: string;
}

const tpvGaps = gaps(tpvShare);

const SOURCES: SourceEntry[] = [
  {
    title: "Bank loan books — IF.data / company filings",
    detail:
      `Credit-card, unsecured & payroll balances (R$ mn), ${coverage(creditCardShare)}. Nu = Nu Pagamentos + Nu Financeira. ` +
      "Share = entity ÷ the sheet's own system total, so one bad bank cell cannot move Nu's share.",
  },
  {
    title: "Card TPV — issuer disclosures",
    detail:
      `Quarterly credit + debit TPV (R$ bn) for the 8 tracked issuers, ${coverage(tpvShare)}; share = issuer ÷ tracked-issuer total. ` +
      (tpvGaps.length
        ? `No share is published for ${tpvGaps.join(", ")}: Caixa's volume is missing from the workbook for those quarters, which would silently inflate every other issuer's share.`
        : "Nu reported from 1Q21."),
  },
  {
    title: "System & peer NPL — central-bank / IR reports",
    detail:
      `System NPL and early-NPL by product, plus each bank's own NPL ratio (%), ${coverage(systemNpl)}. ` +
      "Nu's own ratio is published in this workbook edition, so the peer chart no longer needs Inter as a stand-in.",
  },
  {
    title: "Household-segment NPL — bank segment disclosures",
    detail:
      `Each bank's NPL on its household book only (%), ${coverage(householdNpl)} — the like-for-like comparison with Nu, ` +
      "whose book is essentially all household. Bradesco stops disclosing household early-NPL after 4Q24.",
  },
  {
    title: "Personal-loan pricing — BCB weekly rate series",
    detail:
      `Non-payroll, pre-fixed personal-loan rates (% a.a.), ${coverage(personalLoanRate)}, averaged from weekly readings into calendar quarters; ` +
      "partial quarters (fewer than 6 weeks of data) are dropped rather than shown.",
  },
  {
    title: "Cost of risk — bank disclosures",
    detail:
      `Annualised credit provisions ÷ loans (% a.a.), ${coverage(costOfRisk)}. The only series here in the same unit as an interest rate, ` +
      "which is what makes the price-of-risk comparison possible.",
  },
];

export function SourceTrail({ generatedAt }: { generatedAt: string }) {
  return (
    <WidgetCard
      title="Sources & method"
      subtitle="Provenance for every series on this dashboard"
      category="analytics"
      bodyMinHeight={160}
    >
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "auto" }}>
        {SOURCES.map((s) => (
          <div key={s.title} style={{ display: "flex", gap: 10 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.primary, marginTop: 6, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.textSecondary }}>{s.title}</div>
              <div style={{ fontSize: 12, color: t.textHint, lineHeight: 1.45 }}>{s.detail}</div>
            </div>
          </div>
        ))}
        <div
          style={{
            marginTop: "auto", paddingTop: 10, borderTop: `1px solid ${t.border}`,
            fontSize: 11, color: t.textHint, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6,
          }}
        >
          <span>Workbook: {WORKBOOK}</span>
          <span>Rendered {generatedAt}</span>
        </div>
      </div>
    </WidgetCard>
  );
}
