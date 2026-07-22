// src/components/charts/ShareLineChart.tsx
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { ChartData } from "../../data/datasets";
import { colorFor, t } from "../../theme";
import { WidgetCard, type Category } from "../WidgetCard";
import {
  CategoryTick, ChartLegend, ChartTooltip, DataTable, isolatedDot, toRows, useChartView, ViewToggle,
} from "./common";

export function ShareLineChart({
  data,
  title,
  subtitle,
  category,
  highlight = "Nu",
  span = 1,
  chartHeight = 240,
  yUnit = "%",
  decimals = 1,
  yDomain,
}: {
  data: ChartData;
  title: string;
  subtitle?: string;
  category?: Category;
  highlight?: string;
  span?: 1 | 2 | 3;
  chartHeight?: number;
  yUnit?: string;
  decimals?: number;
  yDomain?: [number, number | "auto"];
}) {
  const [view, setView] = useChartView();
  const rows = toRows(data);
  // Draw non-highlight series first, hero last so it sits on top.
  const ordered = [...data.series].sort((a, b) =>
    a.name === highlight ? 1 : b.name === highlight ? -1 : 0,
  );

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
              <LineChart data={rows} margin={{ top: 6, right: 16, bottom: 4, left: -6 }}>
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
                  domain={yDomain ?? [0, "auto"]}
                  tickFormatter={(v: number) => `${v}${yUnit}`}
                />
                <Tooltip
                  content={<ChartTooltip decimals={decimals} unit={yUnit} />}
                  cursor={{ stroke: t.textHint, strokeDasharray: "3 3" }}
                />
                {ordered.map((s) => {
                  const isHi = s.name === highlight;
                  return (
                    <Line
                      key={s.name}
                      type="monotone"
                      dataKey={s.name}
                      stroke={colorFor(s.name)}
                      strokeWidth={isHi ? 3 : 1.8}
                      dot={isolatedDot(s.values, colorFor(s.name))}
                      activeDot={{ r: isHi ? 5 : 4, strokeWidth: 0 }}
                      connectNulls={false}
                      isAnimationActive={false}
                      opacity={isHi ? 1 : 0.9}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ChartLegend data={data} highlight={highlight} decimals={decimals} />
        </div>
      )}
    </WidgetCard>
  );
}
