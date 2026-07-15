// src/components/charts/NplTrendChart.tsx
//
// Answer-oriented time-series chart for the asset-quality section. The question
// each card asks (e.g. "is Inter taking worse credit risk than incumbents?") is
// a change-over-time comparison, so the default view is LINES, not grouped bars:
// lines let the eye trace one entity across ~40 quarters and read cross-overs at
// a glance. Three devices make the conclusion legible from the chart itself:
//   1. direct end-of-line labels (name + latest value), decluttered vertically;
//   2. an optional peer "band" — the min–max envelope of a reference group —
//      so a hero line breaking above it literally *is* the answer;
//   3. a computed verdict strip that states the takeaway in one line.
// A Bars view (the old grouped-bar rendering) and a Table view remain available.
import { useState } from "react";
import {
  Area, Bar, BarChart, CartesianGrid, Customized, ComposedChart, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { ChartData } from "../../data/datasets";
import { colorFor, t } from "../../theme";
import { WidgetCard, type Category } from "../WidgetCard";
import {
  CategoryTick, ChartLegend, ChartTooltip, DataTable, fmtPct, latest, toRows, ViewToggle,
} from "./common";

export type Verdict = { answer: string; detail: string; accent?: string };

type View = "trend" | "bars" | "table";

const SHORT: Record<string, string> = {
  "Credit card loans": "Card",
  "Personal loans": "Personal",
  "Payroll loans": "Payroll",
  "Household loans": "Household",
  "Santander Brasil": "Santander",
};
const shortLabel = (name: string) => SHORT[name] ?? name;

export function NplTrendChart({
  data,
  title,
  subtitle,
  category,
  verdict,
  highlight,
  band,
  span = 2,
  chartHeight = 240,
  decimals = 1,
}: {
  data: ChartData;
  title: string;
  subtitle?: string;
  category?: Category;
  /** One-line takeaway rendered above the chart. */
  verdict?: Verdict;
  /** Series drawn as the hero line (thick, full opacity); others recede. */
  highlight?: string;
  /** Names whose min–max envelope is shaded as the "peer band". */
  band?: { of: string[]; label?: string };
  span?: 1 | 2 | 3;
  chartHeight?: number;
  decimals?: number;
}) {
  const [view, setView] = useState<View>("trend");
  const rows = toRows(data);

  // Attach the reference-group envelope [low, high] to each row for the band.
  if (band) {
    for (const row of rows) {
      const vals = band.of
        .map((n) => row[n])
        .filter((v): v is number => typeof v === "number");
      (row as Record<string, unknown>).__band = vals.length ? [Math.min(...vals), Math.max(...vals)] : null;
    }
  }

  // Draw recessive series first so the hero line lands on top.
  const ordered = [...data.series].sort((a, b) =>
    a.name === highlight ? 1 : b.name === highlight ? -1 : 0,
  );
  const rightPad = 122; // room for end-of-line labels

  return (
    <WidgetCard
      title={title}
      subtitle={subtitle}
      category={category}
      span={span}
      actions={<ViewToggle<View> view={view} onChange={setView} options={["trend", "bars", "table"]} />}
      bodyMinHeight={chartHeight + (verdict ? 132 : 64)}
    >
      {view === "table" ? (
        <DataTable data={data} decimals={decimals} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {verdict && <VerdictStrip {...verdict} />}
          <div style={{ height: chartHeight, padding: "10px 12px 0" }}>
            <ResponsiveContainer width="100%" height="100%">
              {view === "bars" ? (
                <BarChart data={rows} margin={{ top: 6, right: 16, bottom: 4, left: -6 }} barCategoryGap="18%" barGap={1}>
                  <CartesianGrid stroke={t.gridline} vertical={false} />
                  <XAxis dataKey="period" interval={0} tick={<CategoryTick />} tickLine={false} axisLine={{ stroke: t.borderSolid }} height={22} />
                  <YAxis width={44} tick={{ fontSize: 10, fill: t.textMuted }} tickLine={false} axisLine={false} domain={[0, "auto"]} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip content={<ChartTooltip decimals={decimals} unit="%" />} cursor={{ fill: "rgba(17,24,39,0.05)" }} />
                  {data.series.map((s) => (
                    <Bar key={s.name} dataKey={s.name} fill={colorFor(s.name)} radius={[2, 2, 0, 0]} isAnimationActive={false} maxBarSize={14} />
                  ))}
                </BarChart>
              ) : (
                <ComposedChart data={rows} margin={{ top: 8, right: rightPad, bottom: 4, left: -6 }}>
                  <CartesianGrid stroke={t.gridline} vertical={false} />
                  <XAxis dataKey="period" interval={0} tick={<CategoryTick />} tickLine={false} axisLine={{ stroke: t.borderSolid }} height={22} />
                  <YAxis width={44} tick={{ fontSize: 10, fill: t.textMuted }} tickLine={false} axisLine={false} domain={[0, "auto"]} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip content={<ChartTooltip decimals={decimals} unit="%" />} cursor={{ stroke: t.textHint, strokeDasharray: "3 3" }} />
                  {band && (
                    <Area
                      dataKey="__band"
                      name={band.label ?? "Peer range"}
                      stroke="none"
                      fill={t.primary}
                      fillOpacity={0.07}
                      isAnimationActive={false}
                      connectNulls
                      legendType="none"
                      activeDot={false}
                    />
                  )}
                  {ordered.map((s) => {
                    const isHi = s.name === highlight;
                    const muted = highlight != null && !isHi;
                    return (
                      <Line
                        key={s.name}
                        type="monotone"
                        dataKey={s.name}
                        stroke={colorFor(s.name)}
                        strokeWidth={isHi ? 3 : 1.75}
                        dot={false}
                        activeDot={{ r: isHi ? 5 : 4, strokeWidth: 0 }}
                        connectNulls={false}
                        isAnimationActive={false}
                        opacity={muted ? 0.5 : isHi ? 1 : 0.95}
                      />
                    );
                  })}
                  <Customized
                    component={(cp: unknown) => (
                      <EndLabelLayer chart={cp} series={data.series} highlight={highlight} decimals={decimals} />
                    )}
                  />
                </ComposedChart>
              )}
            </ResponsiveContainer>
          </div>
          <ChartLegend
            data={data}
            highlight={highlight}
            decimals={decimals}
            bandLabel={band && view === "trend" ? band.label ?? "Peer range" : undefined}
          />
        </div>
      )}
    </WidgetCard>
  );
}

/** One-line computed takeaway with a colored left rule. */
function VerdictStrip({ answer, detail, accent = t.primary }: Verdict) {
  return (
    <div
      style={{
        display: "flex", gap: 10, margin: "12px 14px 2px", padding: "10px 12px",
        background: "rgba(249,250,251,0.85)", border: `1px solid ${t.border}`,
        borderLeft: `3px solid ${accent}`, borderRadius: 10,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: t.textPrimary, lineHeight: 1.35 }}>{answer}</div>
        <div style={{ fontSize: 11.5, color: t.textMuted, lineHeight: 1.4, marginTop: 2 }}>{detail}</div>
      </div>
    </div>
  );
}

/** SVG layer (rendered inside the chart via <Customized>) that places a colored
 *  dot + short name + latest value at each line's right end, decluttered so
 *  near-equal values don't overlap. This is the primary "read the ranking here"
 *  affordance and the required contrast relief for the low-contrast fills. */
function EndLabelLayer({
  chart,
  series,
  highlight,
  decimals,
}: {
  chart: any;
  series: ChartData["series"];
  highlight?: string;
  decimals: number;
}) {
  const yMap = chart?.yAxisMap;
  const offset = chart?.offset;
  if (!yMap || !offset) return null;
  const yAxis = yMap[Object.keys(yMap)[0]];
  const yScale = yAxis?.scale;
  if (typeof yScale !== "function") return null;

  const plotRight = offset.left + offset.width;
  const topBound = offset.top + 6;
  const botBound = offset.top + offset.height - 4;

  type Item = { name: string; value: number; color: string; y: number; hero: boolean };
  const items: Item[] = series
    .map((s): Item | null => {
      const v = latest(s.values);
      if (v == null) return null;
      return { name: s.name, value: v, color: colorFor(s.name), y: yScale(v), hero: s.name === highlight };
    })
    .filter((x): x is Item => x !== null)
    .sort((a, b) => a.y - b.y);

  // Greedy vertical declutter, then clamp the stack inside the plot.
  const gap = 15;
  for (let i = 1; i < items.length; i++) {
    if (items[i].y - items[i - 1].y < gap) items[i].y = items[i - 1].y + gap;
  }
  const overflow = items.length ? items[items.length - 1].y - botBound : 0;
  if (overflow > 0) for (const it of items) it.y = Math.max(topBound, it.y - overflow);

  const x = plotRight + 7;
  return (
    <g>
      {items.map((it) => (
        <g key={it.name}>
          <circle cx={x} cy={it.y} r={it.hero ? 3.5 : 3} fill={it.color} />
          <text
            x={x + 8}
            y={it.y}
            dominantBaseline="central"
            fontSize={11}
            fontWeight={it.hero ? 700 : 600}
            fill={it.hero ? t.textPrimary : t.textSecondary}
            fontFamily="inherit"
          >
            <tspan>{shortLabel(it.name)}</tspan>
            <tspan fill={t.textMuted} fontWeight={it.hero ? 700 : 500} dx={5} style={{ fontVariantNumeric: "tabular-nums" }}>
              {fmtPct(it.value, decimals)}
            </tspan>
          </text>
        </g>
      ))}
    </g>
  );
}
