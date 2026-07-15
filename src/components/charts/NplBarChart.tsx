// src/components/charts/NplBarChart.tsx
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { ChartData } from "../../data/datasets";
import { colorFor, t } from "../../theme";
import { WidgetCard, type Category } from "../WidgetCard";
import {
  CategoryTick, ChartLegend, ChartTooltip, DataTable, toRows, useChartView, ViewToggle,
} from "./common";

export function NplBarChart({
  data,
  title,
  subtitle,
  category,
  span = 2,
  chartHeight = 240,
  decimals = 1,
  highlight,
}: {
  data: ChartData;
  title: string;
  subtitle?: string;
  category?: Category;
  span?: 1 | 2 | 3;
  chartHeight?: number;
  decimals?: number;
  highlight?: string;
}) {
  const [view, setView] = useChartView();
  const rows = toRows(data);

  return (
    <WidgetCard
      title={title}
      subtitle={subtitle}
      category={category}
      span={span}
      actions={<ViewToggle view={view} onChange={setView} />}
      bodyMinHeight={chartHeight + 64}
    >
      {view === "table" ? (
        <DataTable data={data} decimals={decimals} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ height: chartHeight, padding: "12px 12px 0" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 6, right: 16, bottom: 4, left: -6 }} barCategoryGap="18%" barGap={1}>
                <CartesianGrid stroke={t.gridline} vertical={false} />
                <XAxis
                  dataKey="period"
                  interval={0}
                  tick={<CategoryTick />}
                  tickLine={false}
                  axisLine={{ stroke: t.borderSolid }}
                  height={22}
                />
                <YAxis
                  width={44}
                  tick={{ fontSize: 10, fill: t.textMuted }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, "auto"]}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  content={<ChartTooltip decimals={decimals} unit="%" />}
                  cursor={{ fill: "rgba(17,24,39,0.05)" }}
                />
                {data.series.map((s) => (
                  <Bar
                    key={s.name}
                    dataKey={s.name}
                    fill={colorFor(s.name)}
                    radius={[2, 2, 0, 0]}
                    isAnimationActive={false}
                    maxBarSize={14}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ChartLegend data={data} highlight={highlight} decimals={decimals} />
        </div>
      )}
    </WidgetCard>
  );
}
