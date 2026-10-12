// src/Dashboard.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import { sdk } from "./lib/sdk";
import { useHostContext } from "./hooks/useHostContext";
import { t, font } from "./theme";
import {
  tpvShare,
  peerNpl, householdNpl, personalLoanRate, costOfRisk,
  peerEarlyNpl, peerNpl15d, peerStage3, peerWriteOffs,
  type ChartData,
} from "./data/datasets";
import { creditCardShare, unsecuredShare, payrollShare } from "./data/loans";
import { systemNpl, systemEarlyNpl, payrollNpl, payrollEarlyNpl } from "./data/bcb";
import { perYear, steps } from "./lib/periods";
import { Header, type DashboardTab } from "./components/Header";
import { Kpi, type KpiProps } from "./components/Kpi";
import { ShareLineChart } from "./components/charts/ShareLineChart";
import { TrendChart, type Verdict } from "./components/charts/TrendChart";
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

/** Latest value, its period label, and its year-over-year change (4 quarters or 12 months back). */
function latestYoY(d: ChartData, name: string): { last: number | null; period: string; deltaPP: number | null } {
  const s = seriesByName(d, name);
  if (!s) return { last: null, period: "–", deltaPP: null };
  const vals = s.values;
  let li = -1;
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== null) { li = i; break; }
  if (li < 0) return { last: null, period: "–", deltaPP: null };
  const last = vals[li]!;
  const prev = li - perYear(d) >= 0 ? vals[li - perYear(d)] : null;
  return {
    last,
    period: d.periods[li],
    deltaPP: prev === null || prev === undefined ? null : Math.round((last - prev) * 10) / 10,
  };
}

function pp(delta: number | null): { text: string; dir: KpiProps["direction"] } {
  if (delta === null) return { text: "", dir: "flat" };
  const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const sign = delta > 0 ? "+" : "";
  return { text: `${sign}${delta.toFixed(1)}pp YoY`, dir };
}

// --- Asset-quality verdicts -------------------------------------------------
// One-line, data-driven takeaways so each chart answers its own question. Numbers
// are read live from the datasets; only the framing is editorial.

const fmt = (n: number | null) => (n == null ? "–" : `${n.toFixed(1)}%`);
/** Signed pp delta, e.g. +2.8 / -0.3 — never a hardcoded sign. */
const signed = (n: number) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(1)}`;
const lv = (d: ChartData, name: string) => latest(seriesByName(d, name)?.values ?? []);
/** Period label of a series' latest non-null reading. */
const lp = (d: ChartData, name: string) => {
  const vals = seriesByName(d, name)?.values ?? [];
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return d.periods[i];
  return "–";
};
/** Value n periods before the latest non-null reading. */
const lvBack = (d: ChartData, name: string, back: number) => {
  const vals = seriesByName(d, name)?.values ?? [];
  for (let i = vals.length - 1; i >= 0; i--) {
    if (vals[i] == null) continue;
    return i - back >= 0 ? vals[i - back] : null;
  }
  return null;
};
/** Highest reading a series has ever printed. */
const peak = (d: ChartData, name: string) =>
  Math.max(...(seriesByName(d, name)?.values ?? []).filter((v): v is number => v != null));
/** Change vs the same period a year earlier (12 months or 4 quarters back), or null. */
const yoy = (d: ChartData, name: string) => {
  const now = lv(d, name);
  const then = lvBack(d, name, perYear(d));
  return now == null || then == null ? null : now - then;
};
/** How many readings in a row, ending at the latest, moved in the same direction. */
const runOf = (d: ChartData, name: string, dir: "down" | "up") => {
  const vals = (seriesByName(d, name)?.values ?? []).filter((v): v is number => v != null);
  let n = 0;
  for (let i = vals.length - 1; i > 0; i--) {
    if (dir === "down" ? vals[i] < vals[i - 1] : vals[i] > vals[i - 1]) n++;
    else break;
  }
  return n;
};
/** Highest reading in the trailing year, with its period label. */
const yearHigh = (d: ChartData, name: string) => {
  const vals = seriesByName(d, name)?.values ?? [];
  let bi = -1;
  for (let i = Math.max(0, vals.length - perYear(d)); i < vals.length; i++) {
    const v = vals[i];
    if (v != null && (bi < 0 || v > vals[bi]!)) bi = i;
  }
  return bi < 0 ? { v: null, at: "–" } : { v: vals[bi]!, at: d.periods[bi] };
};
const isRecord = (d: ChartData, name: string) => {
  const v = lv(d, name);
  return v != null && v >= peak(d, name) - 1e-9;
};
const andList = (xs: string[]) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} & ${xs[xs.length - 1]}`;

/** Value of `name` at a specific period label, or null if absent. */
const at = (d: ChartData, name: string, period: string) => {
  const i = d.periods.indexOf(period);
  const v = i >= 0 ? seriesByName(d, name)?.values[i] : undefined;
  return v ?? null;
};

/**
 * A cross-entity snapshot taken at ONE period: the latest period where `anchor`
 * reports. Every other entity is read at that same index rather than at its own
 * latest, so a "latest quarter" ranking can never mix quarters — a real risk
 * now that a lender can be nulled in the newest quarter for reporting too few
 * weekly readings. Anyone absent at that period is listed in `missing` so the
 * copy can say so instead of quietly back-filling an older number.
 */
function panel(d: ChartData, anchor: string, names: { label: string; key: string }[]) {
  const vals = seriesByName(d, anchor)?.values ?? [];
  let i = -1;
  for (let k = vals.length - 1; k >= 0; k--) if (vals[k] != null) { i = k; break; }
  const rows: { label: string; key: string; v: number }[] = [];
  const missing: string[] = [];
  for (const n of names) {
    const v = i >= 0 ? seriesByName(d, n.key)?.values[i] : null;
    if (v == null) missing.push(n.label);
    else rows.push({ ...n, v });
  }
  return {
    period: i >= 0 ? d.periods[i] : "–",
    rows,
    missing,
    ranked: [...rows].sort((a, b) => b.v - a.v),
    mean: rows.length ? rows.reduce((s, r) => s + r.v, 0) / rows.length : NaN,
    /** " (no X reading this quarter)" — empty when everyone reported. */
    note: missing.length ? ` (no ${missing.join(", ")} reading this quarter)` : "",
  };
}

const INCUMBENTS = [
  { label: "Itaú", key: "Itaú" },
  { label: "Santander", key: "Santander Brasil" },
  { label: "Bradesco", key: "Bradesco" },
];
const HH_INCUMBENTS = [
  { label: "Itaú", key: "Itaú" },
  { label: "Santander", key: "Santander" },
  { label: "Bradesco", key: "Bradesco" },
];

// Verdicts are fully data-driven: the ranking, the answer, every sign and every
// trend clause are derived from the datasets so the takeaway can never drift out
// of sync with the chart when the workbook is regenerated.
function buildVerdicts(): {
  npl: Verdict; early: Verdict; payroll: Verdict; payrollEarly: Verdict;
  peer: Verdict; household: Verdict; rate: Verdict; cor: Verdict;
  earlyPeer: Verdict; npl15d: Verdict; stage3: Verdict; writeOffs: Verdict;
} {
  // --- System NPL by product (BCB, monthly). "Record" means the worst reading
  // since the series starts, which the copy names rather than assumes.
  const PRODUCTS = [
    { key: "Credit card loans", label: "card", short: "card", noun: "cards" },
    { key: "Personal loans", label: "personal-loan", short: "personal", noun: "personal loans" },
    { key: "Payroll loans", label: "payroll", short: "payroll", noun: "payroll" },
    { key: "All household loans", label: "household", short: "household", noun: "household credit" },
  ];
  const since = systemNpl.periods[0];
  const nplAt = lp(systemNpl, "Credit card loans");
  const card = lv(systemNpl, "Credit card loans")!;
  const pers = lv(systemNpl, "Personal loans")!;
  const pay = lv(systemNpl, "Payroll loans")!;
  const records = PRODUCTS.filter((p) => isRecord(systemNpl, p.key)).map((p) => p.label);
  const yoyTxt = (d: ChartData, name: string) => {
    const x = yoy(d, name);
    return x == null ? "" : `, ${signed(x)}pp on a year ago`;
  };
  const payYoY = yoy(systemNpl, "Payroll loans");

  // --- System early NPL: which products run hottest, and is the gauge still rising?
  const earlyAt = lp(systemEarlyNpl, "Credit card loans");
  const earlyRanked = PRODUCTS
    .map((p) => ({ ...p, v: lv(systemEarlyNpl, p.key) }))
    .filter((p): p is typeof p & { v: number } => p.v != null)
    .sort((a, b) => b.v - a.v);
  const perse = lv(systemEarlyNpl, "Personal loans")!;
  const perseYoY = yoy(systemEarlyNpl, "Personal loans");
  const perseHigh = yearHigh(systemEarlyNpl, "Personal loans");
  const perseEasing = runOf(systemEarlyNpl, "Personal loans", "down");
  const carde = lv(systemEarlyNpl, "Credit card loans")!;
  const cardeYoY = yoy(systemEarlyNpl, "Credit card loans");
  const perseState =
    perseYoY != null && perseYoY <= 0
      ? `already below a year ago (${signed(perseYoY)}pp) — the gauge has turned`
      : perseEasing >= 2 && perseHigh.v != null
        ? `${perseYoY == null ? "" : `still ${signed(perseYoY)}pp on a year ago, but `}off their ${perseHigh.at} high (${fmt(perseHigh.v)}) for ${steps(systemEarlyNpl, perseEasing)} running`
        : `still climbing${perseYoY == null ? "" : ` (${signed(perseYoY)}pp on a year ago)`}`;

  // --- Payroll by borrower: the "safe" product is really three products.
  const priv = lv(payrollNpl, "Private-sector payroll")!;
  const pub = lv(payrollNpl, "Public-sector payroll")!;
  const inss = lv(payrollNpl, "INSS payroll")!;
  const privYoY = yoy(payrollNpl, "Private-sector payroll");
  const privAt = lp(payrollNpl, "Private-sector payroll");
  const privE = lv(payrollEarlyNpl, "Private-sector payroll")!;
  const privEYoY = yoy(payrollEarlyNpl, "Private-sector payroll");
  const privEHigh = yearHigh(payrollEarlyNpl, "Private-sector payroll");
  const privEAgo = lvBack(payrollEarlyNpl, "Private-sector payroll", perYear(payrollEarlyNpl));
  const privECresting = privEHigh.v != null && privE < privEHigh.v - 0.25;

  // --- Peer NPL (whole bank). Nu is now in the workbook, so the chart can
  // finally answer with Nu itself rather than using Inter as a stand-in.
  const nu = lv(peerNpl, "Nu")!;
  const peerPanel = panel(peerNpl, "Nu", [...INCUMBENTS, { label: "Inter", key: "Inter" }]);
  const inter = peerPanel.rows.find((r) => r.key === "Inter")?.v ?? lv(peerNpl, "Inter")!;
  const incs = peerPanel.rows.filter((r) => r.key !== "Inter");
  const worstInc = incs.reduce((a, b) => (b.v > a.v ? b : a));
  const bestInc = incs.reduce((a, b) => (b.v < a.v ? b : a));
  const nuAbove = nu > worstInc.v;

  // --- Household segment: the like-for-like read, because the incumbents'
  // whole-bank ratio is diluted by mortgages and corporate lending.
  const nuHh = lv(householdNpl, "Nu")!;
  const hhPanel = panel(householdNpl, "Nu", HH_INCUMBENTS);
  const hhIncs = hhPanel.rows;
  const hhWorst = hhIncs.reduce((a, b) => (b.v > a.v ? b : a));
  const bankAvg = incs.reduce((a, b) => a + b.v, 0) / incs.length;
  const hhAvg = hhPanel.mean;
  const headlinePrem = nu - bankAvg;
  const likeForLike = nuHh - hhAvg;
  const mixShare = (100 * (headlinePrem - likeForLike)) / headlinePrem;
  const hhAt = lp(householdNpl, "Nu");

  // --- Pricing: what each bank charges for the same product.
  const ratePanel = panel(personalLoanRate, "Nu", [
    { label: "Nu", key: "Nu" },
    ...INCUMBENTS.map((i) => ({ label: i.label, key: i.label })),
    { label: "Caixa", key: "Caixa" },
  ]);
  const rateRanked = ratePanel.ranked;
  const nuRate = lv(personalLoanRate, "Nu")!;
  const itRate = ratePanel.rows.find((r) => r.key === "Itaú")?.v ?? lv(personalLoanRate, "Itaú")!;
  const rateAt = ratePanel.period;
  const nuRatePos = rateRanked.findIndex((r) => r.key === "Nu") + 1;

  // --- Cost of risk: what those loans actually lose, per year. Same unit as
  // the rate above, so the two charts read as one trade.
  const nuCor = lv(costOfRisk, "Nu")!;
  const corPanel = panel(costOfRisk, "Nu", INCUMBENTS);
  const corIncs = corPanel.rows;
  const corAvg = corPanel.mean;
  const corAt = corPanel.period;
  const itCor = corIncs.find((r) => r.key === "Itaú")?.v ?? lv(costOfRisk, "Itaú")!;

  // --- Four more bank-by-bank views of "whose loans are in trouble?", each
  // measuring it a different way. Every panel anchors to Nu's own latest
  // period so a ranking can never quietly mix quarters.
  const WITH_INTER = [...INCUMBENTS, { label: "Inter", key: "Inter" }];

  const earlyPeerPanel = panel(peerEarlyNpl, "Nu", WITH_INTER);
  const nuEarlyPeer = lv(peerEarlyNpl, "Nu")!;
  const earlyPeerIncs = earlyPeerPanel.rows.filter((r) => r.key !== "Inter");
  const earlyPeerAvg = earlyPeerIncs.reduce((a, b) => a + b.v, 0) / earlyPeerIncs.length;
  const earlyPeerWorst = earlyPeerIncs.reduce((a, b) => (b.v > a.v ? b : a));
  // Does the leading-indicator gap agree with the headline (90-day) gap?
  const headlineGapWide = nu - worstInc.v > 1;
  const earlyGapWide = nuEarlyPeer - earlyPeerWorst.v > 1;

  // This one needs Nu INSIDE the ranked list (a rank, not just a comparison),
  // unlike the panels above — so, unlike WITH_INTER, Nu is included here.
  const npl15dPanel = panel(peerNpl15d, "Nu", [{ label: "Nu", key: "Nu" }, ...WITH_INTER]);
  const rank15d = npl15dPanel.ranked.findIndex((r) => r.key === "Nu") + 1;

  const stage3Panel = panel(peerStage3, "Nu", WITH_INTER);
  const nuStage3 = lv(peerStage3, "Nu")!;
  const stage3Incs = stage3Panel.rows.filter((r) => r.key !== "Inter");
  const stage3Avg = stage3Incs.reduce((a, b) => a + b.v, 0) / stage3Incs.length;
  // Same bank, same quarter: does Nu's own forward-looking flag (Stage 3) run
  // above or below its own 90-day NPL? (Both series share Nu's latest period
  // here since peerStage3's panel is also anchored to Nu.)
  const nuNplSamePeriod = at(peerNpl, "Nu", stage3Panel.period);
  const stage3AboveNpl = nuNplSamePeriod != null && nuStage3 > nuNplSamePeriod;

  const writeOffsPanel = panel(peerWriteOffs, "Nu", WITH_INTER);
  const nuWriteOffs = lv(peerWriteOffs, "Nu")!;
  const writeOffsIncs = writeOffsPanel.rows.filter((r) => r.key !== "Inter");
  const writeOffsAvg = writeOffsIncs.reduce((a, b) => a + b.v, 0) / writeOffsIncs.length;
  const writeOffsWorst = writeOffsIncs.reduce((a, b) => (b.v > a.v ? b : a));

  return {
    npl: {
      answer: records.length
        ? `${andList(records).replace(/^./, (c) => c.toUpperCase())} NPL${records.length > 1 ? "s are" : " is"} at the worst level since ${since}; payroll is still ${(card / pay).toFixed(1)}× cleaner than cards.`
        : `Card & personal-loan NPLs sit below their peaks; payroll is ${(card / pay).toFixed(1)}× cleaner than cards.`,
      detail: `${nplAt}: credit cards ${fmt(card)}${yoyTxt(systemNpl, "Credit card loans")}; personal loans ${fmt(pers)}${yoyTxt(systemNpl, "Personal loans")}. Payroll, the secured product, sits at ${fmt(pay)} — still a ~${Math.round(card - pay)}pp gap to card stress, though it is ${payYoY != null && payYoY > 0 ? "rising too" : "not rising"}; the borrower split below shows where.`,
    },
    early: {
      answer: `Leading indicator — early arrears run hottest in ${earlyRanked[0]?.noun} & ${earlyRanked[1]?.noun}.`,
      detail: `${earlyAt}: ${earlyRanked.map((p) => `${p.short} ${fmt(p.v)}`).join(" · ")}. These are loans 15–90 days late — the pipeline into the 90-day ratio above. Personal-loan early arrears (${fmt(perse)}) are ${perseState}; card (${fmt(carde)}) is ${cardeYoY == null ? "the latest reading" : `${signed(cardeYoY)}pp on a year ago`}.`,
    },
    payroll: {
      answer: priv > card
        ? `"Safe" payroll isn't one product — private-sector payroll now defaults more than credit cards (${fmt(priv)} vs ${fmt(card)}).`
        : `"Safe" payroll isn't one product — private-sector payroll defaults ${(priv / inss).toFixed(1)}× INSS payroll.`,
      detail: `${privAt}: private-sector workers ${fmt(priv)}${privYoY == null ? "" : ` (${signed(privYoY)}pp in a year${isRecord(payrollNpl, "Private-sector payroll") ? `, the worst since ${payrollNpl.periods[0]}` : ""})`}, public employees ${fmt(pub)}, INSS retirees & pensioners ${fmt(inss)}. The all-payroll ${fmt(pay)} averages them together. A private-sector deduction lasts only as long as the job; a public salary or an INSS pension rarely stops.`,
    },
    payrollEarly: {
      answer: privECresting
        ? `Private-sector payroll arrears may be cresting — but from ${privEAgo ? `${(privE / privEAgo).toFixed(1)}× last year's level` : "a high level"}.`
        : `Private-sector payroll arrears are still building${privEYoY == null ? "" : ` — ${signed(privEYoY)}pp in a year`}.`,
      detail: `Early (15–90 day) arrears, ${lp(payrollEarlyNpl, "Private-sector payroll")}: private-sector ${fmt(privE)}${privEAgo == null ? "" : ` vs ${fmt(privEAgo)} a year earlier`}${privECresting ? `, down from ${fmt(privEHigh.v)} in ${privEHigh.at}` : ""}; public-sector ${fmt(lv(payrollEarlyNpl, "Public-sector payroll"))} and INSS ${fmt(lv(payrollEarlyNpl, "INSS payroll"))}. Whatever is in this pipeline and isn't cured reaches the 90-day chart above within three months.`,
    },
    peer: {
      answer: nuAbove
        ? `Yes on the headline — Nu's ${fmt(nu)} is above every incumbent. But the books aren't comparable.`
        : `No — Nu's ${fmt(nu)} sits inside the incumbent range.`,
      detail: `Nu is ${signed(nu - worstInc.v)}pp vs the weakest incumbent (${worstInc.label} ${fmt(worstInc.v)}) and ${signed(nu - bestInc.v)}pp vs best-in-class ${bestInc.label} (${fmt(bestInc.v)}); Inter, the other digital bank, prints ${fmt(inter)}. The catch: Nu lends almost only to households, while ${bestInc.label}'s ratio is diluted by mortgages and corporate loans. The household-only chart below strips that out.`,
    },
    household: {
      answer: `Like-for-like Nu's premium is ${signed(likeForLike)}pp, not ${signed(headlinePrem)}pp — ${mixShare.toFixed(0)}% of the headline gap was book mix.`,
      detail: `On household books only (${hhAt})${hhPanel.note}, Nu runs ${fmt(nuHh)} against ${hhIncs.map((i) => `${i.label} ${fmt(i.v)}`).join(" · ")} — an average of ${fmt(hhAvg)}, versus ${fmt(bankAvg)} for the same three banks whole-bank. Nu is still the highest of the four, but by ${signed(nuHh - hhWorst.v)}pp over ${hhWorst.label} rather than the ${signed(nu - worstInc.v)}pp the chart above implies.`,
    },
    rate: {
      answer:
        nuRatePos === 1
          ? `Yes — Nu charges the most of the five, ${fmt(nuRate)} a.a. against Itaú's ${fmt(itRate)}.`
          : `Nu is #${nuRatePos} of five on price, ${fmt(nuRate)} a.a. against Itaú's ${fmt(itRate)}.`,
      detail: `Latest quarter (${rateAt})${ratePanel.note}, non-payroll personal loans: ${rateRanked.map((r) => `${r.label} ${fmt(r.v)}`).join(" · ")}. Nu prices ${(nuRate / itRate).toFixed(2)}× Itaú — the revenue side of the extra default risk in the charts above.`,
    },
    cor: {
      answer: `Nu loses ${fmt(nuCor)} of its book a year to credit — ${signed(nuCor - itCor)}pp more than Itaú, against a ${signed(nuRate - itRate)}pp pricing premium.`,
      // The two premiums sit on different portfolios (one product's APR vs the
      // whole book's provisions), so they are shown side by side and never
      // divided into a cover ratio.
      detail: `Cost of risk (${corAt})${corPanel.note} = annualised provisions ÷ loans. Nu ${fmt(nuCor)} vs an incumbent average of ${fmt(corAvg)} (${corIncs.map((i) => `${i.label} ${fmt(i.v)}`).join(" · ")}). Nu's pricing premium over Itaú on personal loans is the larger of the two figures, but it is measured on one product's new lending while cost of risk spans the whole book — read them together, not as a ratio.`,
    },
    earlyPeer: {
      answer: earlyGapWide === headlineGapWide
        ? "Same story as the headline number — this isn't a temporary blip."
        : earlyGapWide
          ? "This early-warning gauge is already wider than the headline gap — worth watching."
          : "This early-warning gauge is narrower than the headline gap — Nu's newest loans look relatively better than its overall book.",
      detail: `Early NPL (${earlyPeerPanel.period})${earlyPeerPanel.note}: Nu ${fmt(nuEarlyPeer)} vs an incumbent average of ${fmt(earlyPeerAvg)} (${earlyPeerIncs.map((i) => `${i.label} ${fmt(i.v)}`).join(" · ")}); Inter ${fmt(earlyPeerPanel.rows.find((r) => r.key === "Inter")?.v ?? NaN)}. This flags trouble sooner than the 90-day ratio above — it's the number to watch first if things are turning.`,
    },
    npl15d: {
      answer: `Nu is #${rank15d} of five once you count everyone overdue by 15+ days, not just 90.`,
      detail: `NPL over 15 days (${npl15dPanel.period})${npl15dPanel.note}: ${npl15dPanel.ranked.map((r) => `${r.label} ${fmt(r.v)}`).join(" · ")}. This is a wider net than the 90-day NPL chart above, so every bank's number here reads higher — it's the ranking that matters, not the raw level.`,
    },
    stage3: {
      answer: stage3AboveNpl
        ? `Nu's own risk-classification runs ${signed(nuStage3 - (nuNplSamePeriod ?? nuStage3))}pp above its 90-day NPL — the bank already flags more loans as trouble than the simple overdue-count shows.`
        : `Nu's own risk-classification (${fmt(nuStage3)}) roughly matches its 90-day NPL (${fmt(nuNplSamePeriod)}).`,
      detail: `"Stage 3" (${stage3Panel.period})${stage3Panel.note} is each bank's own forward-looking classification of its highest-risk loans, not just a days-overdue count: Nu ${fmt(nuStage3)} vs an incumbent average of ${fmt(stage3Avg)} (${stage3Incs.map((i) => `${i.label} ${fmt(i.v)}`).join(" · ")}).`,
    },
    writeOffs: {
      answer: `Nu formally writes off ${fmt(nuWriteOffs)} of its book a year — ${signed(nuWriteOffs - writeOffsWorst.v)}pp above the highest incumbent, but far below its ${fmt(nuCor)} cost-of-risk provision.`,
      detail: `Write-offs (${writeOffsPanel.period})${writeOffsPanel.note} are loans a bank has fully given up on and booked as a realised loss — a later, harder step than cost of risk (money set aside AHEAD of that). Nu ${fmt(nuWriteOffs)} vs an incumbent average of ${fmt(writeOffsAvg)} (${writeOffsIncs.map((i) => `${i.label} ${fmt(i.v)}`).join(" · ")}). The gap between what Nu sets aside (${fmt(nuCor)}) and what it has actually written off (${fmt(nuWriteOffs)}) is normal — provisions come first, formal write-offs follow later.`,
    },
  };
}

const VERDICTS = buildVerdicts();

/** 180+ monthly readings make the grouped-bar view unreadable, so those charts offer trend + table. */
const MONTHLY_VIEWS: ("trend" | "table")[] = ["trend", "table"];

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

/** Section that starts collapsed; children mount only when expanded (lazy). */
function CollapsibleSection({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="seg-btn"
        style={{
          display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", width: "100%",
          margin: "8px 0 2px", padding: "6px 2px", background: "transparent", border: "none",
          cursor: "pointer", textAlign: "left",
        }}
      >
        <span
          aria-hidden
          style={{
            fontSize: 10, color: t.textMuted, display: "inline-block", alignSelf: "center",
            transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s ease",
          }}
        >
          ▶
        </span>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: t.textPrimary, margin: 0, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {title}
        </h2>
        <span style={{ fontSize: 12, color: t.textHint }}>{hint}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: t.primaryText }}>
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open && children}
    </section>
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
    const nuNpl = latestYoY(peerNpl, "Nu");
    // Every scope label carries its OWN latest period — the workbook publishes
    // loan balances, card volumes and NPLs on different lags, so a single
    // hardcoded quarter would be wrong for at least one tile.
    return [
      { label: "Nu · Credit-card share", value: `${cc.last?.toFixed(1)}%`, ...spread(pp(cc.deltaPP)), scope: `${cc.period} · % of system`, accent: "#820ad1" },
      { label: "Nu · Card TPV share", value: `${tpv.last?.toFixed(1)}%`, ...spread(pp(tpv.deltaPP)), scope: `${tpv.period} · #2 issuer`, accent: "#820ad1" },
      { label: "Nu · Unsecured share", value: `${uns.last?.toFixed(1)}%`, ...spread(pp(uns.deltaPP)), scope: `${uns.period} · % of system`, accent: "#820ad1" },
      { label: "Nu · Payroll share", value: `${pay.last?.toFixed(2)}%`, ...spread(pp(pay.deltaPP)), scope: `${pay.period} · early entry`, accent: "#820ad1" },
      { label: "Nu · NPL ratio", value: `${nuNpl.last?.toFixed(1)}%`, ...spread(pp(nuNpl.deltaPP)), invert: true, scope: `${nuNpl.period} · 90-day, whole bank`, accent: "#820ad1" },
      { label: "System · Card NPL", value: `${npl.last?.toFixed(1)}%`, ...spread(pp(npl.deltaPP)), invert: true, scope: `${npl.period} · credit cycle`, accent: "#2a78d6" },
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
        nuNpl: latest(seriesByName(peerNpl, "Nu")!.values),
        nuHouseholdNpl: latest(seriesByName(householdNpl, "Nu")!.values),
        nuPersonalLoanRate: latest(seriesByName(personalLoanRate, "Nu")!.values),
        nuCostOfRisk: latest(seriesByName(costOfRisk, "Nu")!.values),
        nuEarlyNplPeer: latest(seriesByName(peerEarlyNpl, "Nu")!.values),
        nuNpl15d: latest(seriesByName(peerNpl15d, "Nu")!.values),
        nuStage3: latest(seriesByName(peerStage3, "Nu")!.values),
        nuWriteOffs: latest(seriesByName(peerWriteOffs, "Nu")!.values),
        systemCardNpl: latest(seriesByName(systemNpl, "Credit card loans")!.values),
        systemPrivatePayrollNpl: latest(seriesByName(payrollNpl, "Private-sector payroll")!.values),
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
            subtitle={`Nu now ~${Math.round(lv(creditCardShare, "Nu") ?? 0)}% of the system, from ~${Math.round(at(creditCardShare, "Nu", "2019") ?? 0)}% in 2019`}
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
            subtitle={`Fastest-growing Nu book; ~${Math.round(lv(unsecuredShare, "Nu") ?? 0)}% of system`}
            category="markets"
          />
          <ShareLineChart
            data={payrollShare}
            title="Payroll loans — market share"
            subtitle="Nu's newest entry; still well under 1% of a bank-dominated market"
            category="markets"
            decimals={1}
          />
        </div>

        {/* Asset quality section */}
        <SectionLabel title="Asset quality" hint="System credit cycle & peer credit risk (NPL %)" />
        <div style={{ ...GRID(460), marginTop: 12, marginBottom: 28 }}>
          <TrendChart
            data={systemNpl}
            title="System NPL by product"
            subtitle="Macro credit cycle — 90-day NPL ratio by loan product (BCB, monthly)"
            category="analytics"
            verdict={VERDICTS.npl}
            span={2}
            chartHeight={244}
            views={MONTHLY_VIEWS}
          />
          <TrendChart
            data={systemEarlyNpl}
            title="System early NPL by product"
            subtitle="Leading indicator — 15-to-90-day arrears by loan product (BCB, monthly)"
            category="analytics"
            verdict={VERDICTS.early}
            span={2}
            chartHeight={244}
            views={MONTHLY_VIEWS}
          />
          <TrendChart
            data={payrollNpl}
            title="Payroll NPL by borrower"
            subtitle="Private-sector workers vs public employees vs INSS retirees — 90-day NPL (BCB, monthly)"
            category="analytics"
            verdict={VERDICTS.payroll}
            highlight="Private-sector payroll"
            span={2}
            chartHeight={244}
            views={MONTHLY_VIEWS}
          />
          <TrendChart
            data={payrollEarlyNpl}
            title="Payroll early NPL by borrower"
            subtitle="15-to-90-day arrears — the pipeline into the chart above (BCB, monthly)"
            category="analytics"
            verdict={VERDICTS.payrollEarly}
            highlight="Private-sector payroll"
            span={2}
            chartHeight={244}
            views={MONTHLY_VIEWS}
          />
          <TrendChart
            data={peerNpl}
            title="Peer NPL ratio — whole bank"
            subtitle="Is Nu taking worse credit risk than the incumbents?"
            category="sector"
            verdict={VERDICTS.peer}
            highlight="Nu"
            band={{ of: ["Itaú", "Santander Brasil", "Bradesco"], label: "Incumbent range" }}
            span={2}
            chartHeight={244}
          />
          <TrendChart
            data={householdNpl}
            title="Peer NPL ratio — household books only"
            subtitle="The like-for-like comparison: Nu lends only to households, the incumbents don't"
            category="sector"
            verdict={VERDICTS.household}
            highlight="Nu"
            band={{ of: ["Itaú", "Santander", "Bradesco"], label: "Incumbent range" }}
            span={2}
            chartHeight={244}
          />
        </div>

        {/* Credit risk, four more ways — same underlying question ("whose loans
            are in trouble?"), checked with different measures so nothing in
            the source workbook is left off the dashboard. */}
        <SectionLabel title="Credit risk — checked four more ways" hint="Same question as above, bank by bank, measured differently" />
        <div style={{ ...GRID(460), marginTop: 12, marginBottom: 28 }}>
          <TrendChart
            data={peerEarlyNpl}
            title="Whose loans are just starting to fall behind?"
            subtitle="Early-warning ratio, bank by bank — flags trouble before it's 90 days overdue"
            category="sector"
            verdict={VERDICTS.earlyPeer}
            highlight="Nu"
            band={{ of: ["Itaú", "Santander Brasil", "Bradesco"], label: "Incumbent range" }}
            span={2}
            chartHeight={244}
          />
          <TrendChart
            data={peerNpl15d}
            title="Loans overdue 15+ days, not just 90"
            subtitle="A wider net than the headline NPL ratio — everyone's number is naturally higher here"
            category="sector"
            verdict={VERDICTS.npl15d}
            highlight="Nu"
            band={{ of: ["Itaú", "Santander Brasil", "Bradesco"], label: "Incumbent range" }}
            span={2}
            chartHeight={244}
          />
          <TrendChart
            data={peerStage3}
            title="How each bank classifies its own riskiest loans"
            subtitle="'Stage 3' — the bank's own forward-looking red flag, not just a days-overdue count"
            category="sector"
            verdict={VERDICTS.stage3}
            highlight="Nu"
            band={{ of: ["Itaú", "Santander Brasil", "Bradesco"], label: "Incumbent range" }}
            span={2}
            chartHeight={244}
          />
          <TrendChart
            data={peerWriteOffs}
            title="How much of the loan book gets given up on for good"
            subtitle="Write-offs — the final, realised loss, after provisions (cost of risk, below) are set aside"
            category="sector"
            verdict={VERDICTS.writeOffs}
            highlight="Nu"
            band={{ of: ["Itaú", "Santander Brasil", "Bradesco"], label: "Incumbent range" }}
            span={2}
            chartHeight={244}
          />
        </div>

        {/* Pricing section */}
        <SectionLabel title="Pricing" hint="What each bank charges for the same product (BCB weekly series)" />
        <div style={{ ...GRID(460), marginTop: 12, marginBottom: 28 }}>
          <TrendChart
            data={personalLoanRate}
            title="Personal-loan interest rate"
            subtitle="Non-payroll, pre-fixed personal loans — % a.a., quarterly average of the weekly BCB rate"
            category="sector"
            verdict={VERDICTS.rate}
            highlight="Nu"
            span={2}
            chartHeight={244}
          />
          <TrendChart
            data={costOfRisk}
            title="Cost of risk"
            subtitle="What the lending actually loses — annualised provisions ÷ loans, % a.a. (same unit as the rate above)"
            category="sector"
            verdict={VERDICTS.cor}
            highlight="Nu"
            band={{ of: ["Itaú", "Santander Brasil", "Bradesco"], label: "Incumbent range" }}
            span={2}
            chartHeight={244}
          />
        </div>

        {/* Context + provenance — collapsed by default; widgets mount on expand */}
        <CollapsibleSection title="Session & sources" hint="Host watchlist and data provenance">
          <div style={{ ...GRID(360), marginTop: 12 }}>
            <WatchlistWidget token={session.token} />
            <div style={{ gridColumn: "span 2" }}>
              <SourceTrail generatedAt={generatedAt} />
            </div>
          </div>
        </CollapsibleSection>
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
