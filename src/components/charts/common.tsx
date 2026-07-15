// src/components/charts/common.tsx
import { useState } from "react";
import type { ChartData } from "../../data/datasets";
import { colorFor, t } from "../../theme";

export type Row = { period: string } & Record<string, number | null | string>;

/** ChartData -> array of per-period rows for Recharts. */
export function toRows(data: ChartData): Row[] {
  return data.periods.map((p, i) => {
    const row: Row = { period: p };
    for (const s of data.series) row[s.name] = s.values[i];
    return row;
  });
}

export function fmtPct(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return `${v.toFixed(decimals)}%`;
}

/** Latest non-null value of a series. */
export function latest(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return values[i];
  return null;
}

/** A period is a "major" tick if it is a plain year or the first quarter (1Q). */
export function isMajor(period: string): boolean {
  return /^\d{4}$/.test(period) || period.startsWith("1Q");
}

/** Category-axis tick that only renders text for major periods. */
export function CategoryTick(props: any) {
  const { x, y, payload } = props;
  if (!payload || !isMajor(payload.value)) return null;
  const label = /^\d{4}$/.test(payload.value) ? `'${payload.value.slice(2)}` : payload.value;
  return (
    <text x={x} y={y + 12} textAnchor="middle" fontSize={10} fill={t.textMuted}>
      {label}
    </text>
  );
}

/** Shared, styled tooltip: period header + colored rows sorted by value desc. */
export function ChartTooltip({ active, payload, label, decimals = 1, unit = "%" }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload
    .filter((p: any) => p.value !== null && p.value !== undefined && !Array.isArray(p.value) && p.dataKey !== "__band")
    .sort((a: any, b: any) => (b.value as number) - (a.value as number));
  if (rows.length === 0) return null;
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.98)", border: `1px solid ${t.borderSolid}`,
        borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: "8px 10px",
        fontSize: 12, minWidth: 150,
      }}
    >
      <div style={{ fontWeight: 700, color: t.textPrimary, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {rows.map((p: any) => (
          <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flexShrink: 0 }} />
              <span style={{ color: t.textSecondary, overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
            </span>
            <span style={{ fontWeight: 700, color: t.textPrimary, fontVariantNumeric: "tabular-nums" }}>
              {unit === "%" ? fmtPct(p.value, decimals) : `${(p.value as number).toFixed(decimals)}${unit}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Custom legend: colored chip + name + latest value (secondary encoding). */
export function ChartLegend({
  data,
  highlight,
  decimals = 1,
  bandLabel,
}: {
  data: ChartData;
  highlight?: string;
  decimals?: number;
  /** When set, prepends a shaded swatch explaining the chart's range band. */
  bandLabel?: string;
}) {
  return (
    <div
      style={{
        display: "flex", flexWrap: "wrap", gap: "6px 14px", padding: "10px 16px 14px",
        borderTop: `1px solid ${t.border}`,
      }}
    >
      {bandLabel && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <span
            style={{
              width: 14, height: 10, borderRadius: 3,
              background: "rgba(79,70,229,0.14)", border: "1px solid rgba(79,70,229,0.28)", flexShrink: 0,
            }}
          />
          <span style={{ color: t.textMuted }}>{bandLabel}</span>
        </span>
      )}
      {data.series.map((s) => {
        const isHi = s.name === highlight;
        const lv = latest(s.values);
        return (
          <span key={s.name} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span
              style={{
                width: isHi ? 12 : 10, height: isHi ? 4 : 3, borderRadius: 2,
                background: colorFor(s.name), flexShrink: 0,
              }}
            />
            <span style={{ color: isHi ? t.textPrimary : t.textSecondary, fontWeight: isHi ? 700 : 500 }}>
              {s.name}
            </span>
            <span style={{ color: t.textMuted, fontVariantNumeric: "tabular-nums" }}>
              {fmtPct(lv, decimals)}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Segmented view toggle for a widget header. Defaults to Chart / Table; pass
 *  `options` for a custom set (e.g. Trend / Bars / Table). */
export function ViewToggle<T extends string>({
  view,
  onChange,
  options = ["chart", "table"] as unknown as readonly T[],
}: {
  view: T;
  onChange: (v: T) => void;
  options?: readonly T[];
}) {
  return (
    <div style={{ display: "inline-flex", background: "#f3f4f6", borderRadius: 8, padding: 2 }}>
      {options.map((v) => (
        <button
          key={v}
          className="seg-btn"
          onClick={() => onChange(v)}
          aria-pressed={view === v}
          style={{
            border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "3px 10px",
            borderRadius: 6, textTransform: "capitalize",
            background: view === v ? "#fff" : "transparent",
            color: view === v ? t.primaryText : t.textMuted,
            boxShadow: view === v ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
          }}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

/** Accessible table view of a ChartData (the relief channel for low-contrast fills). */
export function DataTable({ data, decimals = 1 }: { data: ChartData; decimals?: number }) {
  return (
    <div style={{ height: "100%", overflow: "auto", padding: "4px 8px" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Period</th>
            {data.series.map((s) => (
              <th key={s.name} style={{ color: colorFor(s.name) }}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.periods.map((p, i) => (
            <tr key={p}>
              <td style={{ fontWeight: 600, color: t.textSecondary }}>{p}</td>
              {data.series.map((s) => (
                <td key={s.name} style={{ color: t.textSecondary }}>{fmtPct(s.values[i], decimals)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Hook: chart/table view state. */
export function useChartView() {
  return useState<"chart" | "table">("chart");
}
