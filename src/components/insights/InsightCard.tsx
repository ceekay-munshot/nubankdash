// src/components/insights/InsightCard.tsx
import type { Insight, InsightKind } from "../../insights/types";
import { t } from "../../theme";
import { EvidenceChart } from "./EvidenceChart";

export const KIND_META: Record<InsightKind, { label: string; bg: string; text: string; border: string }> = {
  opportunity: { label: "Opportunity", bg: "#f0fdf4", text: "#16a34a", border: "#bbf7d0" },
  risk: { label: "Risk", bg: "#fff1f2", text: "#e11d48", border: "#fecdd3" },
  watch: { label: "Watch", bg: "#fffbeb", text: "#d97706", border: "#fde68a" },
  change: { label: "Change", bg: "#eff6ff", text: "#2563eb", border: "#dbeafe" },
  structural: { label: "Structural", bg: "#f5f3ff", text: "#7c3aed", border: "#ede9fe" },
};

export function KindBadge({ kind }: { kind: InsightKind }) {
  const m = KIND_META[kind];
  return (
    <span
      style={{
        fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
        padding: "2px 8px", borderRadius: 6, border: `1px solid ${m.border}`,
        background: m.bg, color: m.text, whiteSpace: "nowrap",
      }}
    >
      {m.label}
    </span>
  );
}

export function InsightCard({ insight, onOpen }: { insight: Insight; onOpen: (i: Insight) => void }) {
  return (
    <div
      className="widget-card"
      role="button"
      tabIndex={0}
      aria-label={`${insight.title} — open calculation details`}
      onClick={() => onOpen(insight)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(insight); } }}
      style={{
        background: t.cardBg, border: `1px solid ${t.border}`, borderRadius: 16,
        display: "flex", flexDirection: "column", overflow: "hidden", cursor: "pointer",
        backdropFilter: "blur(8px)", boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ padding: "14px 16px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <KindBadge kind={insight.kind} />
        <span style={{ fontSize: 10, fontWeight: 600, color: t.textHint, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {insight.confidence} confidence
        </span>
      </div>

      <div style={{ padding: "10px 16px 0" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: t.textPrimary, lineHeight: 1.35 }}>{insight.title}</h3>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: t.textSecondary, lineHeight: 1.5 }}>{insight.takeaway}</p>
      </div>

      <div style={{ padding: "12px 16px 0", display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: t.textPrimary, letterSpacing: "-0.02em" }}>{insight.stat.value}</span>
        <span style={{ fontSize: 11, color: t.textHint, lineHeight: 1.3 }}>{insight.stat.label}</span>
      </div>

      <div style={{ padding: "10px 16px 0" }}>
        <EvidenceChart ev={insight.evidence} compact />
      </div>

      <div
        style={{
          marginTop: "auto", padding: "10px 16px 12px", display: "flex", alignItems: "center",
          justifyContent: "space-between", borderTop: `1px solid ${t.border}`, marginBlockStart: 12,
        }}
      >
        <span style={{ fontSize: 11, color: t.textHint }}>
          {insight.steps.length}-step calculation · {insight.sources.length} source sheet{insight.sources.length > 1 ? "s" : ""}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: t.primaryText }}>See the math →</span>
      </div>
    </div>
  );
}
