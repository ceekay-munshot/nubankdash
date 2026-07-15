// src/components/SourceTrail.tsx
import { t } from "../theme";
import { WidgetCard } from "./WidgetCard";

interface SourceEntry {
  title: string;
  detail: string;
}

const SOURCES: SourceEntry[] = [
  {
    title: "Bank loan books — IF.data / company filings",
    detail:
      "Credit-card, unsecured & payroll balances (R$ mn). Nu = Nu Pagamentos + Nu Financeira. Share = entity ÷ system total.",
  },
  {
    title: "Card TPV — issuer disclosures",
    detail:
      "Quarterly credit + debit TPV (R$ bn) for the 8 tracked issuers; share = issuer ÷ tracked-issuer total. Nu reported from 1Q21.",
  },
  {
    title: "System & peer NPL — central-bank / IR reports",
    detail: "System NPL and early-NPL by product, plus peer NPL ratios (%), 1Q16–1Q26.",
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
          <span>Workbook: Nu_Brazil.xlsx (05.20.2026)</span>
          <span>Rendered {generatedAt}</span>
        </div>
      </div>
    </WidgetCard>
  );
}
