// src/components/insights/EvidenceChart.tsx
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Evidence } from "../../insights/types";
import { colorFor, t } from "../../theme";
import { CategoryTick, ChartTooltip, toRows } from "../charts/common";

// Derived series (e.g. "Headline NPL") aren't entities; give them a fixed,
// CVD-safe order (blue/yellow is the most robust pair) instead of muted gray.
const DERIVED = ["#2a78d6", "#eda100", "#008300", "#820ad1", "#e87ba4", "#eb6834"];

function seriesColor(name: string, i: number): string {
  if (name === "System") return "#6b7280"; // the market itself stays neutral gray
  const c = colorFor(name);
  return c === t.textMuted ? DERIVED[i % DERIVED.length] : c;
}

export function EvidenceChart({ ev, compact = false }: { ev: Evidence; compact?: boolean }) {
  const rows = toRows(ev.data);
  const height = compact ? 96 : 220;
  const unit = ev.unit ?? "%";
  const decimals = ev.decimals ?? 1;
  const hasNegative = ev.data.series.some((s) => s.values.some((v) => v !== null && v < 0));

  const chart =
    ev.type === "line" ? (
      <LineChart data={rows} margin={compact ? { top: 4, right: 4, bottom: 0, left: 4 } : { top: 6, right: 14, bottom: 2, left: -8 }}>
        {!compact && <CartesianGrid stroke={t.gridline} vertical={false} />}
        <XAxis dataKey="period" interval={0} tick={compact ? false : <CategoryTick />} tickLine={false} axisLine={compact ? false : { stroke: t.borderSolid }} height={compact ? 2 : 22} />
        <YAxis width={compact ? 2 : 46} tick={compact ? false : { fontSize: 10, fill: t.textMuted }} tickLine={false} axisLine={false} domain={["auto", "auto"]} tickFormatter={(v: number) => `${v}${unit === "%" ? "%" : ""}`} />
        {!compact && <Tooltip content={<ChartTooltip decimals={decimals} unit={unit} />} cursor={{ stroke: t.textHint, strokeDasharray: "3 3" }} />}
        {ev.data.series.map((s, i) => (
          <Line key={s.name} type="monotone" dataKey={s.name} stroke={seriesColor(s.name, i)} strokeWidth={s.name === "Nu" ? 2.6 : 2} dot={false} activeDot={compact ? false : { r: 4, strokeWidth: 0 }} connectNulls={false} isAnimationActive={false} />
        ))}
      </LineChart>
    ) : (
      <BarChart data={rows} margin={compact ? { top: 4, right: 4, bottom: 0, left: 4 } : { top: 6, right: 14, bottom: 2, left: -8 }} barCategoryGap="24%" barGap={2}>
        {!compact && <CartesianGrid stroke={t.gridline} vertical={false} />}
        <XAxis dataKey="period" interval={0} tick={false} tickLine={false} axisLine={compact ? false : { stroke: t.borderSolid }} height={2} />
        <YAxis width={compact ? 2 : 52} tick={compact ? false : { fontSize: 10, fill: t.textMuted }} tickLine={false} axisLine={false} domain={["auto", "auto"]} tickFormatter={(v: number) => `${v}${unit === "%" ? "%" : ""}`} />
        {!compact && <Tooltip content={<ChartTooltip decimals={decimals} unit={unit} />} cursor={{ fill: "rgba(17,24,39,0.05)" }} />}
        {hasNegative && <ReferenceLine y={0} stroke={t.borderSolid} />}
        {ev.data.series.map((s, i) => (
          <Bar key={s.name} dataKey={s.name} fill={seriesColor(s.name, i)} radius={[2, 2, 0, 0]} isAnimationActive={false} maxBarSize={compact ? 18 : 42} />
        ))}
      </BarChart>
    );

  return (
    <div>
      {!compact && (
        <div style={{ fontSize: 11, fontWeight: 600, color: t.textMuted, margin: "0 0 6px" }}>{ev.title}</div>
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
      </div>
      {/* mini legend: identity is never color-alone */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: compact ? 6 : 8 }}>
        {ev.data.series.map((s, i) => (
          <span key={s.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: t.textSecondary }}>
            <span style={{ width: 9, height: 3, borderRadius: 2, background: seriesColor(s.name, i) }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
