// src/components/Kpi.tsx
import { t } from "../theme";

export interface KpiProps {
  label: string;
  value: string;
  delta?: string;
  direction?: "up" | "down" | "flat";
  /** When true, "up" is bad (e.g. NPL rising) so the up-arrow reads red. */
  invert?: boolean;
  scope?: string;
  accent?: string;
}

export function Kpi({ label, value, delta, direction = "flat", invert = false, scope, accent }: KpiProps) {
  const goodUp = !invert;
  const deltaColor =
    direction === "flat"
      ? t.textMuted
      : (direction === "up") === goodUp
        ? "#059669"
        : "#dc2626";
  const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "•";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "16px 18px", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {accent && <span style={{ width: 8, height: 8, borderRadius: 2, background: accent }} />}
        <span
          style={{
            fontSize: 11, fontWeight: 600, color: t.textMuted, textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, color: t.textPrimary, lineHeight: 1.05, letterSpacing: "-0.02em" }}>
        {value}
      </div>
      {delta && (
        <div style={{ fontSize: 12, fontWeight: 600, color: deltaColor, display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 9 }}>{arrow}</span>
          {delta}
        </div>
      )}
      {scope && <div style={{ fontSize: 11, color: t.textHint, marginTop: "auto" }}>{scope}</div>}
    </div>
  );
}
