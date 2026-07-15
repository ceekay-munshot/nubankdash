// src/components/insights/InsightModal.tsx
//
// The transparency layer: for any insight, show WHERE the numbers come from,
// the STEP-BY-STEP arithmetic with the real values, the one-line formula, the
// supporting chart, and the caveats. Rendered as an overlay OUTSIDE
// #dashboard-main so host visual snapshots never capture it.
import { useEffect, useRef } from "react";
import type { Insight } from "../../insights/types";
import { t, font } from "../../theme";
import { EvidenceChart } from "./EvidenceChart";
import { KindBadge } from "./InsightCard";

const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function SectionTitle({ children }: { children: string }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 8px" }}>
      {children}
    </div>
  );
}

export function InsightModal({ insight, onClose }: { insight: Insight; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 50, background: "rgba(17,24,39,0.45)",
        backdropFilter: "blur(2px)", display: "grid", placeItems: "center", padding: 20,
        animation: "fadeIn 0.15s ease", fontFamily: font,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={insight.title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 94vw)", maxHeight: "86vh", overflow: "auto",
          background: "#ffffff", borderRadius: 16, boxShadow: "0 24px 64px rgba(0,0,0,0.25)",
          animation: "slideUp 0.18s ease",
        }}
      >
        {/* header */}
        <div style={{ position: "sticky", top: 0, background: "rgba(255,255,255,0.97)", backdropFilter: "blur(8px)", borderBottom: `1px solid ${t.borderSolid}`, padding: "14px 20px", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <KindBadge kind={insight.kind} />
              <span style={{ fontSize: 10, fontWeight: 600, color: t.textHint, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {insight.confidence} confidence
              </span>
            </div>
            <button
              ref={closeRef}
              onClick={onClose}
              aria-label="Close"
              style={{
                border: `1px solid ${t.borderSolid}`, background: "#fff", color: t.textSecondary,
                width: 28, height: 28, borderRadius: 8, cursor: "pointer", fontSize: 14, lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
          <h2 style={{ margin: "10px 0 0", fontSize: 16, fontWeight: 700, color: t.textPrimary, lineHeight: 1.35 }}>{insight.title}</h2>
        </div>

        <div style={{ padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
          {/* hero stat + what it means */}
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 12, padding: "10px 14px", minWidth: 150 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#6b21a8", letterSpacing: "-0.02em" }}>{insight.stat.value}</div>
              <div style={{ fontSize: 11, color: "#7e22ce", lineHeight: 1.35, marginTop: 2 }}>{insight.stat.label}</div>
            </div>
            <p style={{ flex: 1, minWidth: 240, margin: 0, fontSize: 13, color: t.textSecondary, lineHeight: 1.6 }}>{insight.detail}</p>
          </div>

          {/* evidence chart */}
          <div style={{ background: t.cardBodyBg, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 14px" }}>
            <EvidenceChart ev={insight.evidence} />
          </div>

          {/* data used */}
          <div>
            <SectionTitle>Data used</SectionTitle>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {insight.sources.map((s) => (
                <span key={s} style={{ fontSize: 11, fontWeight: 600, color: t.textSecondary, background: "#f3f4f6", border: `1px solid ${t.borderSolid}`, borderRadius: 99, padding: "3px 10px" }}>
                  {s}
                </span>
              ))}
            </div>
          </div>

          {/* step-by-step */}
          <div>
            <SectionTitle>How we calculated it — step by step</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {insight.steps.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#fff", border: `1px solid ${t.border}`, borderRadius: 10, padding: "9px 12px" }}>
                  <span
                    style={{
                      width: 20, height: 20, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
                      background: t.primaryLight, color: t.primaryText, fontSize: 11, fontWeight: 700, marginTop: 1,
                    }}
                  >
                    {i + 1}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textPrimary, lineHeight: 1.4 }}>{s.label}</div>
                    <div style={{ fontSize: 11.5, color: t.textMuted, fontFamily: mono, marginTop: 3, overflowWrap: "anywhere" }}>{s.math}</div>
                    {s.source && <div style={{ fontSize: 10.5, color: t.textHint, marginTop: 3 }}>↳ {s.source}</div>}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#6b21a8", textAlign: "right", maxWidth: 220, lineHeight: 1.4 }}>{s.result}</div>
                </div>
              ))}
            </div>
          </div>

          {/* formula */}
          <div>
            <SectionTitle>The whole formula in one line</SectionTitle>
            <div style={{ fontFamily: mono, fontSize: 12, color: t.textSecondary, background: "#f9fafb", border: `1px solid ${t.border}`, borderRadius: 10, padding: "10px 12px", overflowWrap: "anywhere" }}>
              {insight.formula}
            </div>
          </div>

          {/* caveats */}
          <div>
            <SectionTitle>Caveats — what could weaken this</SectionTitle>
            <ul style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 5 }}>
              {insight.caveats.map((c, i) => (
                <li key={i} style={{ fontSize: 12, color: t.textSecondary, lineHeight: 1.55 }}>{c}</li>
              ))}
            </ul>
          </div>

          <div style={{ fontSize: 11, color: t.textHint, borderTop: `1px solid ${t.border}`, paddingTop: 10 }}>
            Every number above is computed live from the bundled workbook series (Nu_Brazil.xlsx, 05.20.2026) — the same data behind the Overview charts. Analytics, not investment advice.
          </div>
        </div>
      </div>
    </div>
  );
}
