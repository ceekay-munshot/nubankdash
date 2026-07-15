// src/views/InsightsView.tsx
//
// The Insights tab: machine-verified, nuanced findings for buy-side analysis
// of Nu — each card opens a full transparency modal (sources, step-by-step
// math, formula, caveats). Cards are computed at runtime by the insight
// engine from the same bundled workbook series the Overview charts use.
import { useMemo, useState } from "react";
import { INSIGHTS } from "../insights/engine";
import type { Insight, InsightKind } from "../insights/types";
import { t } from "../theme";
import { WidgetCard } from "../components/WidgetCard";
import { InsightCard, KIND_META } from "../components/insights/InsightCard";

const KIND_ORDER: InsightKind[] = ["opportunity", "change", "risk", "structural", "watch"];

function FilterChip({ active, label, count, color, onClick }: {
  active: boolean; label: string; count: number; color?: string; onClick: () => void;
}) {
  return (
    <button
      className="seg-btn"
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 12px",
        fontSize: 12, fontWeight: 600, cursor: "pointer", borderRadius: 99,
        border: `1px solid ${active ? t.primary : t.borderSolid}`,
        background: active ? t.primaryLight : "#fff",
        color: active ? t.primaryText : t.textSecondary,
      }}
    >
      {color && <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />}
      {label}
      <span style={{ fontSize: 11, color: active ? t.primaryText : t.textHint }}>{count}</span>
    </button>
  );
}

export function InsightsView({ onOpen }: { onOpen: (i: Insight) => void }) {
  const [filter, setFilter] = useState<InsightKind | "all">("all");

  const counts = useMemo(() => {
    const c = new Map<InsightKind, number>();
    for (const i of INSIGHTS) c.set(i.kind, (c.get(i.kind) ?? 0) + 1);
    return c;
  }, []);

  const visible = filter === "all" ? INSIGHTS : INSIGHTS.filter((i) => i.kind === filter);

  return (
    <>
      {/* intro + filters */}
      <div style={{ margin: "0 2px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: t.textPrimary, margin: 0, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Insights
          </h2>
          <span style={{ fontSize: 12, color: t.textHint }}>
            {INSIGHTS.length} nuanced findings computed from the workbook — click any card for the sources and step-by-step math
          </span>
        </div>
        {/* plain-English glossary for the few finance terms the data uses */}
        <div
          style={{
            fontSize: 11.5, color: t.textMuted, lineHeight: 1.7,
            background: "rgba(255,255,255,0.7)", border: `1px solid ${t.border}`,
            borderRadius: 10, padding: "8px 12px",
          }}
        >
          <strong style={{ color: t.textSecondary }}>Plain-English glossary:</strong>{" "}
          <strong>NPL / defaults</strong> = share of loans overdue and not being repaid ·{" "}
          <strong>Early NPL</strong> = loans just starting to miss payments ·{" "}
          <strong>TPV</strong> = total card spending a bank processes ·{" "}
          <strong>Unsecured</strong> = loans with no collateral behind them ·{" "}
          <strong>pp</strong> = percentage points ·{" "}
          <strong>bp</strong> = hundredths of a percentage point ·{" "}
          <strong>QoQ</strong> = vs the previous quarter
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <FilterChip active={filter === "all"} label="All" count={INSIGHTS.length} onClick={() => setFilter("all")} />
          {KIND_ORDER.filter((k) => (counts.get(k) ?? 0) > 0).map((k) => (
            <FilterChip
              key={k}
              active={filter === k}
              label={KIND_META[k].label}
              count={counts.get(k) ?? 0}
              color={KIND_META[k].text}
              onClick={() => setFilter(k)}
            />
          ))}
        </div>
      </div>

      {/* insight cards */}
      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}>
        {visible.map((i) => (
          <InsightCard key={i.id} insight={i} onOpen={onOpen} />
        ))}
      </div>

      {/* methodology / trust card */}
      <div style={{ marginTop: 24 }}>
        <WidgetCard
          title="How these insights work"
          subtitle="Method, provenance, and what they are not"
          category="analytics"
          bodyMinHeight={120}
        >
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              ["Computed, not written", "Every number is calculated at load time from the bundled workbook series (Loans, TPV, Asset quality) — the identical data behind the Overview charts. Nothing is typed in by hand."],
              ["Fully auditable", "Each card's modal shows the source rows, every arithmetic step with the real values, the one-line formula, and the caveats that could weaken the conclusion."],
              ["Honest about limits", "Where the data contradicts folklore we say so (e.g. early NPL is a coincident gauge here, not a 2–3 quarter lead — we measured it). Correlations are evidence of direction, not forecasts."],
              ["Not investment advice", "These are analytics on the supplied workbook, intended as inputs to your own process."],
            ].map(([h, b]) => (
              <div key={h} style={{ display: "flex", gap: 10 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.primary, marginTop: 6, flexShrink: 0 }} />
                <div>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: t.textSecondary }}>{h}. </span>
                  <span style={{ fontSize: 12.5, color: t.textMuted, lineHeight: 1.55 }}>{b}</span>
                </div>
              </div>
            ))}
          </div>
        </WidgetCard>
      </div>
    </>
  );
}
