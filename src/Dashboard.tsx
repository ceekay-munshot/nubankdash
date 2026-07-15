// src/Dashboard.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import { sdk } from "./lib/sdk";
import { useHostContext } from "./hooks/useHostContext";
import { t, font } from "./theme";
import {
  creditCardShare, tpvShare, unsecuredShare, payrollShare,
  systemNpl, systemEarlyNpl, peerNpl, type ChartData,
} from "./data/datasets";
import { Header, type DashboardTab } from "./components/Header";
import { Kpi, type KpiProps } from "./components/Kpi";
import { ShareLineChart } from "./components/charts/ShareLineChart";
import { NplBarChart } from "./components/charts/NplBarChart";
import { WatchlistWidget } from "./components/WatchlistWidget";
import { SourceTrail } from "./components/SourceTrail";
import { latest } from "./components/charts/common";
import { InsightsView } from "./views/InsightsView";
import { InsightModal } from "./components/insights/InsightModal";
import { INSIGHTS } from "./insights/engine";
import type { Insight } from "./insights/types";

// --- KPI helpers ------------------------------------------------------------

function seriesByName(d: ChartData, name: string) {
  return d.series.find((s) => s.name === name);
}

/** Latest value and its year-over-year (4-period) change, both nullable. */
function latestYoY(d: ChartData, name: string): { last: number | null; deltaPP: number | null } {
  const s = seriesByName(d, name);
  if (!s) return { last: null, deltaPP: null };
  const vals = s.values;
  let li = -1;
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== null) { li = i; break; }
  if (li < 0) return { last: null, deltaPP: null };
  const last = vals[li]!;
  const prev = li - 4 >= 0 ? vals[li - 4] : null;
  return { last, deltaPP: prev === null || prev === undefined ? null : Math.round((last - prev) * 10) / 10 };
}

function pp(delta: number | null): { text: string; dir: KpiProps["direction"] } {
  if (delta === null) return { text: "", dir: "flat" };
  const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const sign = delta > 0 ? "+" : "";
  return { text: `${sign}${delta.toFixed(1)}pp YoY`, dir };
}

function SectionLabel({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{ margin: "8px 2px 2px", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, color: t.textPrimary, margin: 0, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {title}
      </h2>
      <span style={{ fontSize: 12, color: t.textHint }}>{hint}</span>
    </div>
  );
}

function KpiTile({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: t.cardBg, border: `1px solid ${t.border}`, borderRadius: 16,
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)", backdropFilter: "blur(8px)", overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

const GRID = (min: number): React.CSSProperties => ({
  display: "grid", gap: 20, gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
});

export function Dashboard() {
  const { session, ticker, tickerCompany } = useHostContext();
  const connected = !!session.token;
  const generatedAt = useMemo(() => new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", []);

  const [tab, setTab] = useState<DashboardTab>("overview");
  const [openInsight, setOpenInsight] = useState<Insight | null>(null);

  const switchTab = (v: DashboardTab) => {
    setTab(v);
    sdk.publish("dashboard.tab.change", { tab: v });
  };
  const openInsightModal = (i: Insight) => {
    setOpenInsight(i);
    sdk.publish("dashboard.insight.open", { id: i.id });
  };

  // Snapshot getter, reassigned each render so the host always reads live state.
  const snapshotRef = useRef<() => unknown>(() => ({}));

  const kpis: KpiProps[] = useMemo(() => {
    const cc = latestYoY(creditCardShare, "Nu");
    const tpv = latestYoY(tpvShare, "Nu");
    const uns = latestYoY(unsecuredShare, "Nu");
    const pay = latestYoY(payrollShare, "Nu");
    const npl = latestYoY(systemNpl, "Credit card loans");
    return [
      { label: "Nu · Credit-card share", value: `${cc.last?.toFixed(1)}%`, ...spread(pp(cc.deltaPP)), scope: "4Q25 · % of system", accent: "#820ad1" },
      { label: "Nu · Card TPV share", value: `${tpv.last?.toFixed(1)}%`, ...spread(pp(tpv.deltaPP)), scope: "1Q26 · #2 issuer", accent: "#820ad1" },
      { label: "Nu · Unsecured share", value: `${uns.last?.toFixed(1)}%`, ...spread(pp(uns.deltaPP)), scope: "4Q25 · % of system", accent: "#820ad1" },
      { label: "Nu · Payroll share", value: `${pay.last?.toFixed(1)}%`, ...spread(pp(pay.deltaPP)), scope: "4Q25 · early entry", accent: "#820ad1" },
      { label: "System · Card NPL", value: `${npl.last?.toFixed(1)}%`, ...spread(pp(npl.deltaPP)), invert: true, scope: "1Q26 · credit cycle", accent: "#2a78d6" },
    ];
  }, []);

  // Keep the snapshot getter current (bounded, cloneable — auth-standards §6).
  snapshotRef.current = () => ({
    context: {
      dashboard: "nubank-brazil-market-share",
      selectedTicker: ticker,
      sessionUser: session.userName ?? null,
      generatedAt,
    },
    selection: { view: tab, openInsight: openInsight?.id ?? null },
    data: {
      kpis: kpis.map((k) => ({ label: k.label, value: k.value, delta: k.delta ?? null })),
      latest: {
        nuCreditCardShare: latest(seriesByName(creditCardShare, "Nu")!.values),
        nuTpvShare: latest(seriesByName(tpvShare, "Nu")!.values),
        nuUnsecuredShare: latest(seriesByName(unsecuredShare, "Nu")!.values),
        nuPayrollShare: latest(seriesByName(payrollShare, "Nu")!.values),
        systemCardNpl: latest(seriesByName(systemNpl, "Credit card loans")!.values),
      },
      insights: INSIGHTS.map((i) => ({
        id: i.id, kind: i.kind, title: i.title, stat: i.stat.value, takeaway: i.takeaway,
      })),
    },
  });

  const [exporting, setExporting] = useState(false);

  async function captureBlob(): Promise<Blob | null> {
    const el =
      (document.querySelector("#dashboard-main") as HTMLElement | null) ||
      (document.querySelector("[data-dashboard-capture-root='true']") as HTMLElement | null) ||
      (document.querySelector("main") as HTMLElement | null);
    if (!el) return null;
    return toBlob(el, { pixelRatio: 2, backgroundColor: "#ffffff" });
  }

  async function onExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await captureBlob();
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "nubank-brazil-dashboard.png";
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("[dashboard] export failed", err);
    } finally {
      setExporting(false);
    }
  }

  // Register host request handlers once. DO NOT call sdk.ready() — the SDK
  // auto-sends dashboard:ready from its host:init handler (auth-standards §5).
  useEffect(() => {
    const offVisual = sdk.onRequest("dashboard.capture.visual", async () => {
      try {
        const blob = await captureBlob();
        if (!blob) throw new Error("capture root not found");
        return { visualSnapshot: blob, capturedAt: new Date().toISOString() };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    });

    const offSnapshot = sdk.onRequest("dashboard.capture.snapshot", () => {
      try {
        return snapshotRef.current();
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    });

    // Fire-and-forget telemetry that the dashboard mounted.
    sdk.publish("dashboard.view", { dashboard: "nubank-brazil-market-share" });

    return () => {
      offVisual();
      offSnapshot();
    };
  }, []);

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden",
        background: t.pageBg, fontFamily: font, color: t.textPrimary,
      }}
    >
      <Header
        ticker={ticker}
        tickerCompany={tickerCompany}
        connected={connected}
        onExport={onExport}
        tab={tab}
        onTab={switchTab}
        insightCount={INSIGHTS.length}
      />

      <main id="dashboard-main" data-dashboard-capture-root="true" style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>
        {tab === "insights" ? (
          <InsightsView onOpen={openInsightModal} />
        ) : (
          <>
        {/* KPI strip */}
        <div style={{ ...GRID(200), marginBottom: 24 }}>
          {kpis.map((k) => (
            <KpiTile key={k.label}>
              <Kpi {...k} />
            </KpiTile>
          ))}
        </div>

        {/* Market share section */}
        <SectionLabel title="Market share" hint="Nu vs Brazilian banks — share of system, over time" />
        <div style={{ ...GRID(460), marginTop: 12, marginBottom: 28 }}>
          <ShareLineChart
            data={creditCardShare}
            title="Credit-card loans — market share"
            subtitle="Nu now ~15% of the system, from near-zero in 2018"
            category="markets"
          />
          <ShareLineChart
            data={tpvShare}
            title="Card TPV — market share"
            subtitle="Nu is the #2 card issuer by payment volume"
            category="markets"
          />
          <ShareLineChart
            data={unsecuredShare}
            title="Unsecured loans — market share"
            subtitle="Fastest-growing Nu book; ~14% of system"
            category="markets"
          />
          <ShareLineChart
            data={payrollShare}
            title="Payroll loans — market share"
            subtitle="Nu's newest entry; still under 1% of a bank-dominated market"
            category="markets"
            decimals={1}
          />
        </div>

        {/* Asset quality section */}
        <SectionLabel title="Asset quality" hint="System credit cycle & peer credit risk (NPL %)" />
        <div style={{ ...GRID(460), marginTop: 12, marginBottom: 28 }}>
          <NplBarChart
            data={systemNpl}
            title="System NPL by product"
            subtitle="Macro credit cycle — card & personal NPLs rising again; payroll structurally clean"
            category="analytics"
            span={2}
            chartHeight={260}
          />
          <NplBarChart
            data={systemEarlyNpl}
            title="System early NPL by product"
            subtitle="Leading indicator — short-dated arrears by product"
            category="analytics"
            span={2}
            chartHeight={260}
          />
          <NplBarChart
            data={peerNpl}
            title="Peer NPL ratio"
            subtitle="Are digital banks (Inter) taking worse credit risk than incumbents?"
            category="sector"
            span={2}
            chartHeight={260}
          />
        </div>

        {/* Context + provenance */}
        <SectionLabel title="Session & sources" hint="Host watchlist and data provenance" />
        <div style={{ ...GRID(360), marginTop: 12 }}>
          <WatchlistWidget token={session.token} />
          <div style={{ gridColumn: "span 2" }}>
            <SourceTrail generatedAt={generatedAt} />
          </div>
        </div>
          </>
        )}
      </main>

      {/* Transparency modal — outside #dashboard-main so host visual snapshots
          capture the dashboard, never the overlay. */}
      {openInsight && <InsightModal insight={openInsight} onClose={() => setOpenInsight(null)} />}
    </div>
  );
}

function spread(x: { text: string; dir: KpiProps["direction"] }): Partial<KpiProps> {
  return { delta: x.text || undefined, direction: x.dir };
}
