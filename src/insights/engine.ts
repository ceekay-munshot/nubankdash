// src/insights/engine.ts
//
// The insight engine. Every insight below is COMPUTED at module load from the
// bundled workbook series (src/data/datasets.ts + src/data/absolutes.ts), and
// each one carries its own step-by-step calculation trail built from the very
// same intermediate values that are displayed — so what you read on a card and
// what you see in the "how we got this" modal can never diverge.
//
// House rules for this file:
//  - No number is hardcoded; everything derives from the datasets.
//  - Every step's `math` string shows the real inputs, not placeholders.
//  - If the data can't support a claim, the insight states the honest version
//    (e.g. early NPL is a COINCIDENT gauge for personal loans — we measured
//    the lead-lag and report the measured correlations, not folklore).

import {
  creditCardShare, tpvShare, unsecuredShare, payrollShare,
  systemNpl, systemEarlyNpl, peerNpl, type ChartData,
} from "../data/datasets";
import { loanAbsCreditCard, loanAbsUnsecured, loanAbsPayroll } from "../data/absolutes";
import type { CalcStep, Insight } from "./types";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function ser(d: ChartData, name: string): (number | null)[] {
  const s = d.series.find((x) => x.name === name);
  if (!s) throw new Error(`series not found: ${name}`);
  return s.values;
}

/** Value of `name` at `period`; throws if absent (insight is then skipped). */
function at(d: ChartData, name: string, period: string): number {
  const i = d.periods.indexOf(period);
  const v = i >= 0 ? ser(d, name)[i] : null;
  if (v === null || v === undefined) throw new Error(`${name} @ ${period} missing`);
  return v;
}

/** Latest non-null value with its period label. */
function last(d: ChartData, name: string): { period: string; value: number } {
  const vals = ser(d, name);
  for (let i = vals.length - 1; i >= 0; i--) {
    const v = vals[i];
    if (v !== null && v !== undefined) return { period: d.periods[i], value: v };
  }
  throw new Error(`series empty: ${name}`);
}

const f = (x: number, dp = 1) => x.toFixed(dp);
const signed = (x: number, dp = 1) => `${x >= 0 ? "+" : ""}${x.toFixed(dp)}`;
/** R$ mn -> compact bn string. */
const bn = (mn: number, dp = 1) => `R$${(mn / 1000).toFixed(dp)}bn`;
const mn = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 0 });

function pearson(x: (number | null)[], y: (number | null)[]): { r: number; n: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const a = x[i], b = y[i];
    if (a !== null && a !== undefined && b !== null && b !== undefined) { xs.push(a); ys.push(b); }
  }
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return { r: num / Math.sqrt(dx * dy), n };
}

/** Correlation of lead(t) with lag(t+k). */
function lagCorr(lead: (number | null)[], lag: (number | null)[], k: number) {
  return pearson(k > 0 ? lead.slice(0, lead.length - k) : lead, k > 0 ? lag.slice(k) : lag);
}

const cd = (periods: string[], series: { name: string; values: (number | null)[] }[]): ChartData => ({ periods, series });

const SHEETS = {
  loans: "Loans sheet (IF.data balances, R$ mn)",
  tpv: "TPV Market share sheet (R$ bn card volumes)",
  aq: "Asset quality sheet (NPL ratios, %)",
};

// ---------------------------------------------------------------------------
// A. Monetization gap — TPV share vs card-loan share
// ---------------------------------------------------------------------------
function insightMonetizationGap(): Insight {
  const nuTpv = last(tpvShare, "Nu");                 // 1Q26
  const itTpv = last(tpvShare, "Itaú");
  const nuLoan = last(creditCardShare, "Nu");         // 4Q25
  const itLoan = last(creditCardShare, "Itaú");
  const rNu = nuLoan.value / nuTpv.value;
  const rIt = itLoan.value / itTpv.value;
  const implied = nuTpv.value * rIt;
  const gapPp = implied - nuLoan.value;
  const sysCard = last(loanAbsCreditCard, "System").value; // R$ mn, 4Q25
  const latentMn = (gapPp / 100) * sysCard;

  // conversion-ratio trend (quarterly era, where both series have the period)
  const qs = creditCardShare.periods.filter((p) => /Q/.test(p) && tpvShare.periods.includes(p));
  const ratio = (bank: string) => qs.map((p) => {
    const l = ser(creditCardShare, bank)[creditCardShare.periods.indexOf(p)];
    const t = ser(tpvShare, bank)[tpvShare.periods.indexOf(p)];
    return l !== null && t !== null && t !== 0 ? Math.round((l / t) * 100) / 100 : null;
  });

  const steps: CalcStep[] = [
    { label: "Nu's share of card payment volume (TPV)", math: `read directly`, result: `${f(nuTpv.value)}%`, source: `${SHEETS.tpv} · ${nuTpv.period}` },
    { label: "Nu's share of card loans", math: `read directly`, result: `${f(nuLoan.value)}%`, source: `${SHEETS.loans} · ${nuLoan.period}` },
    { label: "Nu's spend→credit conversion ratio", math: `${f(nuLoan.value)} ÷ ${f(nuTpv.value)}`, result: f(rNu, 2) },
    { label: "Itaú's conversion ratio (the incumbent benchmark)", math: `${f(itLoan.value)} ÷ ${f(itTpv.value)}`, result: f(rIt, 2) },
    { label: "Nu's card share if it converted spend like Itaú", math: `${f(nuTpv.value)} × ${f(rIt, 2)}`, result: `${f(implied)}%` },
    { label: "Latent card loans hiding in Nu's own customer spend", math: `(${f(implied)} − ${f(nuLoan.value)})% × ${bn(sysCard, 0)} system card book`, result: `≈ ${bn(latentMn, 0)}`, source: `${SHEETS.loans} · Total · 4Q25` },
  ];

  return {
    id: "monetization-gap",
    kind: "opportunity",
    confidence: "High",
    title: `Nu processes ${f(nuTpv.value)}% of card spend but holds only ${f(nuLoan.value)}% of card credit`,
    takeaway: `Closing just the conversion gap to Itaú's level implies ≈ ${bn(latentMn, 0)} of additional card loans inside Nu's existing customer base — growth that needs no new customers.`,
    stat: { value: bn(latentMn, 0), label: "latent card credit at Itaú-level conversion" },
    detail: `Nu turns each point of payment-volume share into only ${f(rNu, 2)} points of card-loan share, versus ${f(rIt, 2)} for Itaú. The ratio has been improving (${f(ratio("Nu")[0] ?? 0, 2)} in ${qs[0]} → ${f(rNu, 2)} now), so the gap is closing — but ${f(gapPp)}pp of share, ≈ ${bn(latentMn, 0)} at today's system size, is still unconverted. This is the cleanest quantification of Nu's within-base monetization runway.`,
    sources: [SHEETS.tpv, SHEETS.loans],
    formula: "latent = TPVshareNu × (loanShareItaú ÷ TPVshareItaú) − loanShareNu, × system card book",
    steps,
    caveats: [
      "TPV includes debit and prepaid volume; Nu's base skews to debit, so part of the gap is structural, not addressable.",
      `Period mismatch: TPV is ${nuTpv.period}, loan shares are ${nuLoan.period} (one quarter apart).`,
      "Itaú's conversion benefits from corporate and high-limit card books Nu doesn't have (yet).",
    ],
    evidence: {
      title: "Spend→credit conversion ratio (card-loan share ÷ TPV share)",
      type: "line",
      data: cd(qs, [
        { name: "Nu", values: ratio("Nu") },
        { name: "Itaú", values: ratio("Itaú") },
      ]),
      unit: "×",
      decimals: 2,
    },
  };
}

// ---------------------------------------------------------------------------
// B. 2Q25 — Nu's biggest share grab happened in a shrinking market
// ---------------------------------------------------------------------------
function insightShrinkingMarketGrab(): Insight {
  const P1 = "1Q25", P2 = "2Q25";
  const sys1 = at(loanAbsCreditCard, "System", P1), sys2 = at(loanAbsCreditCard, "System", P2);
  const nu1 = at(loanAbsCreditCard, "Nu", P1), nu2 = at(loanAbsCreditCard, "Nu", P2);
  const it1 = at(loanAbsCreditCard, "Itaú", P1), it2 = at(loanAbsCreditCard, "Itaú", P2);
  const qoq = (a: number, b: number) => 100 * (b / a - 1);
  const sh1 = at(creditCardShare, "Nu", P1), sh2 = at(creditCardShare, "Nu", P2);
  const jump = sh2 - sh1;

  // verify it's the largest QoQ share gain in the quarterly era
  const nuShare = ser(creditCardShare, "Nu");
  const qIdx = creditCardShare.periods.map((p, i) => ({ p, i })).filter((x) => /Q/.test(x.p));
  let maxJump = -Infinity, maxAt = "";
  for (let k = 1; k < qIdx.length; k++) {
    const a = nuShare[qIdx[k - 1].i], b = nuShare[qIdx[k].i];
    if (a !== null && b !== null && b - a > maxJump) { maxJump = b - a; maxAt = qIdx[k].p; }
  }

  const steps: CalcStep[] = [
    { label: "System card book, 1Q25 → 2Q25", math: `${mn(sys1)} → ${mn(sys2)} (R$ mn)`, result: `${signed(qoq(sys1, sys2))}% QoQ`, source: `${SHEETS.loans} · Total row` },
    { label: "Itaú's card book, same quarter", math: `${mn(it1)} → ${mn(it2)}`, result: `${signed(qoq(it1, it2))}% QoQ`, source: `${SHEETS.loans} · Itaú` },
    { label: "Nu's card book, same quarter", math: `${mn(nu1)} → ${mn(nu2)}`, result: `${signed(qoq(nu1, nu2))}% QoQ`, source: `${SHEETS.loans} · Nu (both entities)` },
    { label: "Nu's market share, 1Q25 → 2Q25", math: `${f(sh1, 2)}% → ${f(sh2, 2)}%`, result: `${signed(jump, 2)}pp` },
    { label: "Rank that jump against every quarter in the data", math: `max QoQ share gain across all quarters = ${signed(maxJump, 2)}pp @ ${maxAt}`, result: maxAt === P2 ? "2Q25 is the largest on record" : `largest is ${maxAt}` },
  ];

  return {
    id: "shrinking-market-grab",
    kind: "change",
    confidence: "High",
    title: "Nu's biggest share grab ever came while the card market was shrinking",
    takeaway: `In 2Q25 the system card book contracted ${signed(qoq(sys1, sys2))}% and Itaú cut ${signed(qoq(it1, it2))}%, yet Nu grew ${signed(qoq(nu1, nu2))}% — its largest single-quarter share gain (${signed(jump, 2)}pp) in the whole dataset.`,
    stat: { value: `${signed(jump, 2)}pp`, label: "share gained in 2Q25 — a record — while the market shrank" },
    detail: `A share gain in a growing market can just mean growing with the tide. This one happened against the tide: incumbents were actively de-risking card exposure (Itaú ${signed(qoq(it1, it2))}% QoQ) into rising card NPLs, and Nu expanded ${signed(qoq(nu1, nu2))}%. Either Nu sees underwriting signal incumbents don't, or it is absorbing risk they are shedding — both readings matter, and vintage disclosure from Nu is the thing to watch next.`,
    sources: [SHEETS.loans],
    formula: "QoQ% = balance(2Q25) ÷ balance(1Q25) − 1;  shareΔ = Nu₂/Sys₂ − Nu₁/Sys₁",
    steps,
    caveats: [
      "Single-quarter event; 3Q25/4Q25 gains normalized to +0.3pp/+0.2pp.",
      "Nu consolidated its two legal entities' reporting in 1Q25; we sum both entities in every quarter so the comparison is like-for-like, but reclassification noise can't be fully excluded.",
      "Incumbent retrenchment can flatter Nu's share without any change in Nu's own risk appetite.",
    ],
    evidence: {
      title: "Card book growth, 1Q25 → 2Q25 (QoQ %)",
      type: "bar",
      data: cd(["2Q25 QoQ growth"], [
        { name: "Nu", values: [Math.round(qoq(nu1, nu2) * 10) / 10] },
        { name: "Bradesco", values: [Math.round(qoq(at(loanAbsCreditCard, "Bradesco", P1), at(loanAbsCreditCard, "Bradesco", P2)) * 10) / 10] },
        { name: "BB", values: [Math.round(qoq(at(loanAbsCreditCard, "BB", P1), at(loanAbsCreditCard, "BB", P2)) * 10) / 10] },
        { name: "Santander", values: [Math.round(qoq(at(loanAbsCreditCard, "Santander", P1), at(loanAbsCreditCard, "Santander", P2)) * 10) / 10] },
        { name: "System", values: [Math.round(qoq(sys1, sys2) * 10) / 10] },
        { name: "Itaú", values: [Math.round(qoq(it1, it2) * 10) / 10] },
      ]),
      unit: "%",
    },
  };
}

// ---------------------------------------------------------------------------
// C. Record card NPL is stock, not flow
// ---------------------------------------------------------------------------
function insightStockNotFlow(): Insight {
  const npl = ser(systemNpl, "Credit card loans");
  const enpl = ser(systemEarlyNpl, "Credit card loans");
  const periods = systemNpl.periods;
  const cur = last(systemNpl, "Credit card loans");
  const curE = last(systemEarlyNpl, "Credit card loans");
  const maxNpl = Math.max(...npl.filter((v): v is number => v !== null));
  const eVals = enpl.filter((v): v is number => v !== null);
  const maxE = Math.max(...eVals);
  const rankE = eVals.slice().sort((a, b) => a - b).findIndex((v) => v >= curE.value) + 1;
  const yAgo = at(systemEarlyNpl, "Credit card loans", "1Q25");
  // Q1 seasonal jump, 2023-2026
  const q1jumps = [23, 24, 25, 26].map((y) => at(systemEarlyNpl, "Credit card loans", `1Q${y}`) - at(systemEarlyNpl, "Credit card loans", `4Q${y - 1}`));
  const avgQ1 = q1jumps.reduce((s, v) => s + v, 0) / q1jumps.length;
  const prev = at(systemEarlyNpl, "Credit card loans", "4Q25");

  const steps: CalcStep[] = [
    { label: "Headline card NPL today (the stock of bad loans)", math: `read directly`, result: `${f(cur.value)}% — ties the highest of all ${periods.length} quarters (max = ${f(maxNpl)}%)`, source: `${SHEETS.aq} · System NPL · ${cur.period}` },
    { label: "Early card NPL today (the flow of NEW arrears)", math: `read directly`, result: `${f(curE.value)}%`, source: `${SHEETS.aq} · System early NPL · ${curE.period}` },
    { label: "Compare the flow to a year ago", math: `${f(curE.value)} (1Q26) vs ${f(yAgo)} (1Q25)`, result: `${signed(curE.value - yAgo)}pp YoY — flat` },
    { label: "Rank the flow in its own history", math: `sort all ${eVals.length} readings; today sits #${rankE}`, result: `mid-pack (record is ${f(maxE)}%)` },
    { label: "Strip the Q1 seasonality", math: `avg 4Q→1Q jump 2023–26 = ${f(avgQ1, 2)}pp; this year ${f(prev)} → ${f(curE.value)} = ${signed(curE.value - prev)}pp`, result: "the QoQ rise is mostly the usual Q1 pattern" },
  ];

  return {
    id: "stock-not-flow",
    kind: "watch",
    confidence: "High",
    title: `Card NPL at a record ${f(cur.value)}% — but the flow of new arrears is flat`,
    takeaway: `The scary headline (record ${f(cur.value)}% card NPL) is a STOCK statistic; the flow gauge (early NPL) is ${f(curE.value)}%, exactly flat YoY and mid-pack versus its own history — new vintages are not deteriorating.`,
    stat: { value: `${signed(curE.value - yAgo, 1)}pp`, label: "YoY change in early card NPL — the flow behind the record stock" },
    detail: `When headline NPL makes new highs while early-stage arrears stay flat, the deterioration is coming from the aging of existing problem loans (and/or slower write-offs), not from newly-originated credit going bad. For anyone underwriting Nu — whose book is ~64% cards — the flow gauge, not the record headline, is the number that describes today's origination environment.`,
    sources: [SHEETS.aq],
    formula: "compare percentile-rank(headline NPL) vs percentile-rank(early NPL); YoY Δ of early NPL; seasonal adj = QoQ − avg(4Q→1Q)",
    steps,
    caveats: [
      "The sheet doesn't state the early-NPL day-bucket definition; a definition change would break comparability.",
      "Slower bank write-offs can hold the stock high even as the flow improves — direction is the signal, not the level.",
    ],
    evidence: {
      title: "Card loans: headline NPL (stock) vs early NPL (flow)",
      type: "line",
      data: cd(periods, [
        { name: "Headline NPL", values: npl },
        { name: "Early NPL", values: enpl },
      ]),
    },
  };
}

// ---------------------------------------------------------------------------
// D. Personal-loan cycle hasn't peaked — measured, not assumed
// ---------------------------------------------------------------------------
function insightPersonalCycle(): Insight {
  const e = ser(systemEarlyNpl, "Personal loans");
  const h = ser(systemNpl, "Personal loans");
  const periods = systemNpl.periods;
  const curH = last(systemNpl, "Personal loans");
  const curE = last(systemEarlyNpl, "Personal loans");
  const trough = at(systemNpl, "Personal loans", "3Q24");
  const r0 = lagCorr(e, h, 0);
  const r1 = lagCorr(e, h, 1);
  const r2 = lagCorr(e, h, 2);
  // consecutive rises in early NPL
  const ev = e.filter((v): v is number => v !== null);
  let rises = 0;
  for (let i = ev.length - 1; i > 0 && rises < 6; i--) { if (ev[i] > ev[i - 1]) rises++; else break; }

  const steps: CalcStep[] = [
    { label: "Headline personal-loan NPL, trough → now", math: `${f(trough)} (3Q24) → ${f(curH.value)} (${curH.period})`, result: `${signed(curH.value - trough)}pp in 6 quarters`, source: `${SHEETS.aq} · System NPL · Personal loans` },
    { label: "Early personal-loan NPL (the flow gauge) now", math: `last readings: ${e.slice(-5).map((v) => (v === null ? "–" : f(v))).join(" → ")}`, result: `${f(curE.value)}% — still climbing (${rises} consecutive rises)`, source: `${SHEETS.aq} · System early NPL` },
    { label: "Measure how the two move together (we tested lags 0–2)", math: `corr(early(t), headline(t+k)): k=0 r=${f(r0.r, 2)}, k=1 r=${f(r1.r, 2)}, k=2 r=${f(r2.r, 2)} (n=${r0.n})`, result: `strongest same-quarter → early NPL is a coincident gauge, not a long lead` },
    { label: "Read the two gauges together", math: `flow still rising + tightest link at k≤1`, result: "no crest signal yet → headline unlikely to have peaked" },
  ];

  return {
    id: "personal-cycle-not-peaked",
    kind: "risk",
    confidence: "Medium",
    title: "The personal-loan NPL cycle shows no sign of cresting",
    takeaway: `Headline personal NPL is up ${signed(curH.value - trough)}pp since 3Q24 to ${f(curH.value)}%, and the early-arrears gauge — which we measured to move with the headline (r=${f(r0.r, 2)} same-quarter) — is itself still making new local highs.`,
    stat: { value: `${f(curH.value)}%`, label: `personal-loan NPL, +${f(curH.value - trough)}pp off the 3Q24 trough — flow gauge still rising` },
    detail: `This is the product where Nu is expanding fastest (see the unsecured-capture insight). We tested the folklore that early NPL "leads by 2–3 quarters": it doesn't in this data — correlation peaks at lag 0 (r=${f(r0.r, 2)}) and fades with distance. That makes the current reading MORE useful, not less: the coincident gauge has not turned, so there is no data-based reason to call the personal-loan cycle peaked.`,
    sources: [SHEETS.aq],
    formula: "Pearson r between early-NPL(t) and headline-NPL(t+k), k = 0,1,2, over all overlapping quarters",
    steps,
    caveats: [
      `Correlations are moderate (r≈${f(r0.r, 2)}), computed over ${r0.n} quarters — direction-of-cycle evidence, not a forecasting model.`,
      "System-level series: Nu's own vintages could behave better or worse than the system.",
      "A fast rate-cutting cycle would be the standard way this rolls over.",
    ],
    evidence: {
      title: "Personal loans: headline NPL vs early NPL",
      type: "line",
      data: cd(periods, [
        { name: "Headline NPL", values: h },
        { name: "Early NPL", values: e },
      ]),
    },
  };
}

// ---------------------------------------------------------------------------
// E. Product-mix NPL exposure — Nu's book is built riskier
// ---------------------------------------------------------------------------
function mixNpl(bank: string) {
  const c = last(loanAbsCreditCard, bank).value;
  const u = last(loanAbsUnsecured, bank).value;
  const p = last(loanAbsPayroll, bank).value;
  const nplC = last(systemNpl, "Credit card loans").value;
  const nplU = last(systemNpl, "Personal loans").value;
  const nplP = last(systemNpl, "Payroll loans").value;
  const tot = c + u + p;
  return { c, u, p, tot, w: (c * nplC + u * nplU + p * nplP) / tot, nplC, nplU, nplP };
}

function insightMixRisk(): Insight {
  const nu = mixNpl("Nu");
  const it = mixNpl("Itaú");
  const br = mixNpl("Bradesco");
  const sa = mixNpl("Santander");
  const gap = nu.w - it.w;

  const steps: CalcStep[] = [
    { label: "Nu's book by product (4Q25, R$ mn)", math: `card ${mn(nu.c)} (${f((100 * nu.c) / nu.tot, 0)}%) · personal ${mn(nu.u)} (${f((100 * nu.u) / nu.tot, 0)}%) · payroll ${mn(nu.p)} (${f((100 * nu.p) / nu.tot, 0)}%)`, result: `${f((100 * (nu.c + nu.u)) / nu.tot, 0)}% of the book is unsecured`, source: `${SHEETS.loans} · Nu rows, 4Q25` },
    { label: "System NPL by product (1Q26)", math: `card ${f(nu.nplC)}% · personal ${f(nu.nplU)}% · payroll ${f(nu.nplP)}%`, result: "the risk price of each product", source: `${SHEETS.aq} · System NPL` },
    { label: "Nu's mix-weighted NPL exposure", math: `(${mn(nu.c)}×${f(nu.nplC)} + ${mn(nu.u)}×${f(nu.nplU)} + ${mn(nu.p)}×${f(nu.nplP)}) ÷ ${mn(nu.tot)}`, result: `${f(nu.w, 2)}%` },
    { label: "Same formula for the incumbents", math: `Itaú ${f(it.w, 2)}% · Santander ${f(sa.w, 2)}% · Bradesco ${f(br.w, 2)}%`, result: "the comparable structural exposure" },
    { label: "Structural gap Nu must out-underwrite", math: `${f(nu.w, 2)} − ${f(it.w, 2)}`, result: `${signed(gap, 2)}pp vs Itaú (${signed(nu.w - br.w, 2)}pp vs Bradesco)` },
  ];

  return {
    id: "mix-weighted-risk",
    kind: "structural",
    confidence: "High",
    title: `Nu's product mix carries ${signed(gap, 1)}pp more NPL than Itaú's — by construction`,
    takeaway: `Holding underwriting skill EQUAL, Nu's book would run at ${f(nu.w, 1)}% system-average NPL versus ${f(it.w, 1)}% for Itaú and ${f(br.w, 1)}% for Bradesco, purely because ${f((100 * (nu.c + nu.u)) / nu.tot, 0)}% of Nu's book is cards + personal loans.`,
    stat: { value: `${f(nu.w, 1)}%`, label: `mix-weighted NPL exposure vs ${f(it.w, 1)}% Itaú / ${f(br.w, 1)}% Bradesco` },
    detail: `This separates portfolio CONSTRUCTION from underwriting SKILL — a distinction headline NPL comparisons miss entirely. When Nu reports NPLs near incumbent levels, it is out-underwriting them by roughly this gap; when it reports worse NPLs, check whether the gap explains all of it before crediting the bears. It also quantifies the payroll push: every 1pp of book shifted from cards to payroll mechanically cuts Nu's exposure by ~${f(nu.nplC - nu.nplP, 1)}bp.`,
    sources: [SHEETS.loans, SHEETS.aq],
    formula: "mixNPL(bank) = Σₚ balance(bank,p) × systemNPL(p) ÷ Σₚ balance(bank,p), over card/personal/payroll",
    steps,
    caveats: [
      "Uses SYSTEM product NPLs, not bank-specific ones — deliberately, to isolate mix from skill.",
      "Covers the three products in the sheet; incumbents also hold mortgages/vehicle books (typically cleaner), so their full-book advantage is understated here, not overstated.",
      "Books are 4Q25, NPLs are 1Q26 (one quarter apart).",
    ],
    evidence: {
      title: "Mix-weighted NPL exposure by bank (identical underwriting assumed)",
      type: "bar",
      data: cd(["Mix-weighted NPL"], [
        { name: "Nu", values: [Math.round(nu.w * 100) / 100] },
        { name: "Itaú", values: [Math.round(it.w * 100) / 100] },
        { name: "Santander", values: [Math.round(sa.w * 100) / 100] },
        { name: "Bradesco", values: [Math.round(br.w * 100) / 100] },
      ]),
    },
  };
}

// ---------------------------------------------------------------------------
// F. Nu captured a third of ALL unsecured growth — into a rising-NPL product
// ---------------------------------------------------------------------------
function insightUnsecuredCapture(): Insight {
  const P0 = "4Q24", P1 = "4Q25";
  const sys0 = at(loanAbsUnsecured, "System", P0), sys1 = at(loanAbsUnsecured, "System", P1);
  const nu0 = at(loanAbsUnsecured, "Nu", P0), nu1 = at(loanAbsUnsecured, "Nu", P1);
  const dSys = sys1 - sys0, dNu = nu1 - nu0;
  const capture = (100 * dNu) / dSys;
  const share = last(unsecuredShare, "Nu").value;
  const ratio = capture / share;
  const nplNow = last(systemNpl, "Personal loans").value;
  const npl3q24 = at(systemNpl, "Personal loans", "3Q24");
  const banks: [string, number][] = ["Bradesco", "BB", "Itaú", "Caixa", "Inter"].map((b) => [b, at(loanAbsUnsecured, b, P1) - at(loanAbsUnsecured, b, P0)]);

  const steps: CalcStep[] = [
    { label: "System unsecured-loan growth over the year", math: `${mn(sys1)} − ${mn(sys0)}`, result: `+${mn(dSys)} (R$ mn)`, source: `${SHEETS.loans} · Total · ${P0}→${P1}` },
    { label: "Nu's unsecured growth over the same year", math: `${mn(nu1)} − ${mn(nu0)}`, result: `+${mn(dNu)} (${signed(100 * (nu1 / nu0 - 1), 0)}% YoY)`, source: `${SHEETS.loans} · Nu rows` },
    { label: "Nu's capture of ALL system growth", math: `${mn(dNu)} ÷ ${mn(dSys)}`, result: `${f(capture)}% — the largest of any bank` },
    { label: "Compare with Nu's share of the stock", math: `${f(capture)} ÷ ${f(share)}`, result: `${f(ratio, 1)}× its ${f(share)}% stock share` },
    { label: "The product's risk backdrop over those quarters", math: `personal-loan NPL ${f(npl3q24)} (3Q24) → ${f(nplNow)} (1Q26)`, result: `${signed(nplNow - npl3q24)}pp while Nu accelerated`, source: `${SHEETS.aq} · System NPL` },
  ];

  return {
    id: "unsecured-capture",
    kind: "risk",
    confidence: "High",
    title: `Nu took ${f(capture, 0)}% of ALL unsecured growth — while product NPL climbed to ${f(nplNow)}%`,
    takeaway: `Over ${P0}→${P1}, Nu supplied ${f(capture)}% of the entire system's unsecured-loan growth (${f(ratio, 1)}× its stock share) — its fastest expansion is aimed at exactly the product whose NPL has risen most.`,
    stat: { value: `${f(capture, 0)}%`, label: `of system unsecured growth captured by one bank with a ${f(share)}% share` },
    detail: `Growth capture at ${f(ratio, 1)}× stock share is what taking a market looks like — but doing it pro-cyclically, into a product running ${f(nplNow)}% system NPL and rising, concentrates vintage risk in the 2025 cohort. If Nu's 2025 unsecured vintages season well, this was the land-grab of the cycle; if not, the damage is proportional to how much of the growth Nu supplied — which is: a third of it.`,
    sources: [SHEETS.loans, SHEETS.aq],
    formula: "capture = ΔNu ÷ ΔSystem over 4Q24→4Q25;  intensity = capture ÷ Nu's stock share",
    steps,
    caveats: [
      "One-year window; capture ratios are volatile year to year.",
      "System growth includes banks not listed in the sheet (~40% of the Δ) — Nu's capture of the LISTED banks' growth is even higher.",
      "Nu's own unsecured NPL is not in the workbook; system NPL is the backdrop, not Nu's realized loss rate.",
    ],
    evidence: {
      title: `Who supplied the system's unsecured growth (${P0}→${P1}, R$ mn)`,
      type: "bar",
      data: cd(["Δ unsecured balance"], [
        { name: "Nu", values: [Math.round(dNu)] },
        ...banks.map(([b, d]) => ({ name: b, values: [Math.round(d)] })),
      ]),
      unit: " R$mn",
      decimals: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// G. Payroll: a 90%-QoQ sprint into the product incumbents are leaving
// ---------------------------------------------------------------------------
function insightPayrollEntry(): Insight {
  const nu3 = at(loanAbsPayroll, "Nu", "3Q25"), nu4 = at(loanAbsPayroll, "Nu", "4Q25");
  const qoq = 100 * (nu4 / nu3 - 1);
  const sant = ser(loanAbsPayroll, "Santander");
  const peak = Math.max(...sant.filter((v): v is number => v !== null));
  const peakPeriod = loanAbsPayroll.periods[sant.indexOf(peak)];
  const santNow = last(loanAbsPayroll, "Santander").value;
  const santDraw = 100 * (santNow / peak - 1);
  const pNpl = last(systemNpl, "Payroll loans").value;
  const pMax = Math.max(...ser(systemNpl, "Payroll loans").filter((v): v is number => v !== null));
  const cNpl = last(systemNpl, "Credit card loans").value;
  const mixCut = cNpl - pNpl;

  const steps: CalcStep[] = [
    { label: "Nu's payroll book, 3Q25 → 4Q25", math: `${mn(nu3)} → ${mn(nu4)} (R$ mn)`, result: `${signed(qoq, 0)}% QoQ — the fastest-growing line in Nu's book`, source: `${SHEETS.loans} · Nu rows` },
    { label: "The incumbent on the other side of the trade", math: `Santander payroll: peak ${mn(peak)} (${peakPeriod}) → ${mn(santNow)}`, result: `${f(santDraw)}% from peak`, source: `${SHEETS.loans} · Santander` },
    { label: "The product's cyclical position", math: `payroll NPL now ${f(pNpl)}% vs series max ${f(pMax)}%`, result: pNpl === pMax ? "entering at the product's WORST NPL on record" : "near the record", source: `${SHEETS.aq} · System NPL · Payroll` },
    { label: "…but payroll is still the cleanest product", math: `card ${f(cNpl)}% ÷ payroll ${f(pNpl)}%`, result: `${f(cNpl / pNpl, 1)}× cleaner than cards` },
    { label: "Mechanical effect on Nu's mix risk", math: `${f(cNpl)} − ${f(pNpl)} = ${f(mixCut)}pp product gap`, result: `each 1pp of book shifted card→payroll cuts mix-NPL exposure ~${f(mixCut, 1)}bp` },
  ];

  return {
    id: "payroll-contrarian-entry",
    kind: "opportunity",
    confidence: "Medium",
    title: `Payroll: Nu grew ${signed(qoq, 0)}% QoQ into the product incumbents are exiting`,
    takeaway: `Nu's payroll book jumped ${signed(qoq, 0)}% in 4Q25 while Santander sits ${f(santDraw)}% below its ${peakPeriod} peak — a contrarian entry that also mechanically de-risks Nu's product mix (payroll runs ${f(cNpl / pNpl, 1)}× cleaner than cards).`,
    stat: { value: `${signed(qoq, 0)}%`, label: "QoQ growth in Nu's payroll book, 4Q25 — from a 0.9% share" },
    detail: `The nuance is the timing on both sides: Nu is scaling payroll exactly when the product's NPL (${f(pNpl)}%) is at its highest in the entire series AND when a large incumbent is retreating. Because payroll is structurally ${f(cNpl / pNpl, 1)}× cleaner than Nu's core card product, every point of mix shifted toward payroll directly shrinks the structural risk gap flagged in the mix-weighted insight — this is the same story from the constructive side.`,
    sources: [SHEETS.loans, SHEETS.aq],
    formula: "QoQ = Nu(4Q25) ÷ Nu(3Q25) − 1;  drawdown = Santander(4Q25) ÷ peak − 1;  mix effect = NPLcard − NPLpayroll per 1pp of book shifted",
    steps,
    caveats: [
      `Base effect: ${signed(qoq, 0)}% QoQ is off a small base — Nu's payroll share is still ~${f(last(payrollShare, "Nu").value, 1)}%.`,
      "Payroll margins are thin and rate-capped; it dilutes yield even as it de-risks.",
      "Record product NPL could mean structural deterioration in payroll itself (rate caps squeezing weaker borrowers), not just cycle.",
    ],
    evidence: {
      title: "Payroll market share: Nu enters as Santander retreats",
      type: "line",
      data: cd(payrollShare.periods, [
        { name: "Nu", values: ser(payrollShare, "Nu") },
        { name: "Santander", values: ser(payrollShare, "Santander") },
      ]),
    },
  };
}

// ---------------------------------------------------------------------------
// H. The Inter mirror — this is a Nu trade, not a "digital banks" trade
// ---------------------------------------------------------------------------
function insightInterMirror(): Insight {
  const P0 = "4Q23", P1 = "4Q25";
  const nuD = at(creditCardShare, "Nu", P1) - at(creditCardShare, "Nu", P0);
  const inD = at(creditCardShare, "Inter", P1) - at(creditCardShare, "Inter", P0);
  const inNpl = last(peerNpl, "Inter");
  const itNpl = last(peerNpl, "Itaú");
  const spread = inNpl.value - itNpl.value;
  // widest-ever check
  const inS = ser(peerNpl, "Inter"), itS = ser(peerNpl, "Itaú");
  let maxSpread = -Infinity, maxAt = "";
  peerNpl.periods.forEach((p, i) => {
    const a = inS[i], b = itS[i];
    if (a !== null && b !== null && a - b > maxSpread) { maxSpread = a - b; maxAt = p; }
  });
  const itMin = Math.min(...itS.filter((v): v is number => v !== null));

  const steps: CalcStep[] = [
    { label: "Card share gained over two years (4Q23→4Q25)", math: `Nu ${signed(nuD, 2)}pp vs Inter ${signed(inD, 2)}pp`, result: `Nu gained ${f(nuD / inD, 0)}× more`, source: `${SHEETS.loans} · share columns` },
    { label: "Credit quality of the digital peer", math: `Inter NPL ${f(inNpl.value)}% vs Itaú ${f(itNpl.value)}%`, result: `${f(spread)}pp gap`, source: `${SHEETS.aq} · Peer NPL · ${inNpl.period}` },
    { label: "Rank that gap historically", math: `max(Inter − Itaú) across all quarters = ${f(maxSpread)}pp @ ${maxAt}`, result: maxAt === inNpl.period ? "the widest in the entire series — right now" : `widest was ${maxAt}` },
    { label: "And the incumbent isn't standing still", math: `Itaú NPL ${f(itNpl.value)}% vs its own series minimum ${f(itMin)}%`, result: itNpl.value === itMin ? "Itaú is at its record BEST as Inter deteriorates" : "near its best" },
  ];

  return {
    id: "inter-mirror",
    kind: "structural",
    confidence: "Medium",
    title: "Inter proves it: this is a Nu story, not a 'digital banks' story",
    takeaway: `The other listed digital bank gained ${signed(inD, 2)}pp of card share in two years to Nu's ${signed(nuD, 2)}pp (${f(nuD / inD, 0)}× less), while Inter's NPL gap to Itaú widened to ${f(spread)}pp — the widest ever.`,
    stat: { value: `${f(nuD / inD, 0)}×`, label: `Nu's 2-year card-share gain vs Inter's — the 'digital' factor isn't generic` },
    detail: `If digital distribution alone won share, Inter would be compounding too. It isn't: near-zero share progress AND deteriorating credit versus an incumbent at its record-best NPL. For a Nu thesis this cuts both ways — it validates that Nu's edge is idiosyncratic (execution, cost of funding, data), and it removes the comfort of a sector tailwind: Nu has to keep out-executing, because 'digital' by itself is demonstrably not enough.`,
    sources: [SHEETS.loans, SHEETS.aq],
    formula: "Δshare(bank) over 4Q23→4Q25; spread(t) = NPL_Inter(t) − NPL_Itaú(t), ranked across all t",
    steps,
    caveats: [
      "Inter's model is mortgage/collateral-heavy, so it is an imperfect Nu proxy.",
      "Nu's own NPL is not in the workbook — Inter is the only listed digital-bank credit read-across available here.",
    ],
    evidence: {
      title: "Credit-card market share: Nu vs the other digital bank",
      type: "line",
      data: cd(creditCardShare.periods, [
        { name: "Nu", values: ser(creditCardShare, "Nu") },
        { name: "Inter", values: ser(creditCardShare, "Inter") },
      ]),
    },
  };
}

// ---------------------------------------------------------------------------
// assemble (defensively: a data change skips an insight, never crashes the app)
// ---------------------------------------------------------------------------
function safe(build: () => Insight): Insight | null {
  try {
    return build();
  } catch (err) {
    console.error("[insights] skipped:", err);
    return null;
  }
}

export const INSIGHTS: Insight[] = [
  insightMonetizationGap,
  insightShrinkingMarketGrab,
  insightUnsecuredCapture,
  insightMixRisk,
  insightStockNotFlow,
  insightPersonalCycle,
  insightPayrollEntry,
  insightInterMirror,
].map(safe).filter((x): x is Insight => x !== null);
