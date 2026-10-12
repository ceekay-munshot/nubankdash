// src/components/SourceTrail.tsx
import { t } from "../theme";
import { WidgetCard } from "./WidgetCard";
import {
  tpvShare, tpvHoles, peerNpl, householdNpl, personalLoanRate, costOfRisk,
  peerEarlyNpl, peerNpl15d, peerStage3, peerWriteOffs,
  WORKBOOK, type ChartData,
} from "../data/datasets";
import { creditCardShare } from "../data/loans";
import { IFDATA_QUARTERS, IFDATA_FETCHED } from "../data/ifdata";
import { systemNpl, payrollNpl, BCB_WORKBOOK, BCB_CODES } from "../data/bcb";

/** "1Q16–2Q26" — read off the data so the provenance copy cannot go stale. */
function coverage(d: ChartData): string {
  return `${d.periods[0]}–${d.periods[d.periods.length - 1]}`;
}

/** "21129/21050 (card), …" — the SGS codes the parser read off the workbook header. */
function sgs(lines: [name: string, label: string][]): string {
  return lines
    .map(([name, label]) => {
      const c = BCB_CODES[name];
      return c ? `${c.npl ?? "?"}/${c.early ?? "?"} (${label})` : null;
    })
    .filter(Boolean)
    .join(", ");
}

interface SourceEntry {
  title: string;
  detail: string;
}

/**
 * The TPV holes are reported by the parser rather than re-derived from the
 * shares: an issuer nulled mid-series looks like an ordinary null here, and a
 * period the parser dropped entirely is invisible from the data alone.
 */
function tpvHoleNote(): string {
  if (tpvHoles.length === 0) return "Nu reported from 1Q21.";
  const repaired = tpvHoles.filter((h) => h.repaired);
  const dropped = tpvHoles.filter((h) => !h.repaired);
  const list = (hs: typeof tpvHoles) =>
    hs.map((h) => `${h.issuer} ${h.period}`).join(", ");
  return [
    repaired.length
      ? `The workbook is missing ${list(repaired)}. That issuer's own share is left blank and the denominator is repaired by interpolation, so the issuers that did report keep their true share instead of all eight being inflated by the missing volume.`
      : "",
    dropped.length
      ? `${list(dropped)} is missing with no later reading to interpolate from, so that quarter is not published at all.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const SOURCES: SourceEntry[] = [
  {
    title: "Bank loan books — IF.data / company filings",
    detail:
      `Credit-card, unsecured & payroll balances (R$ mn), ${coverage(creditCardShare)}. Nu = Nu Pagamentos + Nu Financeira. ` +
      "Share = entity ÷ the sheet's own system total, so one bad bank cell cannot move Nu's share." +
      (IFDATA_QUARTERS.length
        ? ` ${IFDATA_QUARTERS.join(", ")} ${IFDATA_QUARTERS.length > 1 ? "are" : "is"} newer than the workbook and taken straight from BCB IF.data (fetched ${IFDATA_FETCHED}) by the same method, after re-deriving the workbook's newest quarter from IF.data and matching it bank by bank.`
        : ""),
  },
  {
    title: "Card TPV — issuer disclosures",
    detail:
      `Quarterly credit + debit TPV (R$ bn) for the 8 tracked issuers, ${coverage(tpvShare)}; share = issuer ÷ tracked-issuer total. ` +
      tpvHoleNote(),
  },
  {
    title: "System NPL by product — BCB monthly series",
    detail:
      `90-day and early (15–90 day) NPL for credit cards, non-payroll personal loans, payroll and all household credit (%), monthly, ${coverage(systemNpl)}. ` +
      `SGS codes, 90-day/early: ${sgs([["Credit card loans", "card"], ["Personal loans", "personal"], ["Payroll loans", "payroll"], ["All household loans", "household"]])}. ` +
      "\"All household loans\" is BCB's all-household total — mortgages, vehicle and rural credit included — so it doesn't match the narrower household line earlier editions charted.",
  },
  {
    title: "Payroll NPL by borrower — BCB monthly series",
    detail:
      `90-day and early NPL on payroll loans to private-sector workers, public employees and INSS retirees & pensioners (%), ${coverage(payrollNpl)}. ` +
      `SGS codes: ${sgs([["Private-sector payroll", "private"], ["Public-sector payroll", "public"], ["INSS payroll", "INSS"]])}. ` +
      "The workbook prints the all-payroll series twice; one copy is used everywhere so the line matches across charts.",
  },
  {
    title: "Peer NPL — bank IR reports",
    detail:
      `Each bank's own 90-day NPL ratio (%), ${coverage(peerNpl)}. ` +
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
  {
    title: "Four more credit-risk views — bank disclosures",
    detail:
      `Early NPL, NPL over 15 days, "Stage 3" and write-offs, bank by bank (%), ${coverage(peerNpl15d)}. ` +
      "Each answers the same question — whose loans are in trouble — a different way; see the Credit risk section for what makes them differ. " +
      `Coverage varies by bank and metric: ${coverage(peerEarlyNpl)} for early NPL, ${coverage(peerStage3)} for Stage 3, ${coverage(peerWriteOffs)} for write-offs.`,
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
          <span>Workbooks: {WORKBOOK} · {BCB_WORKBOOK}</span>
          <span>Rendered {generatedAt}</span>
        </div>
      </div>
    </WidgetCard>
  );
}
