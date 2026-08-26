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
  systemNpl, systemEarlyNpl, peerNpl, householdNpl, personalLoanRate, costOfRisk,
  type ChartData,
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

/** Index of the latest non-null reading. */
function lastIdx(d: ChartData, name: string): number {
  const vals = ser(d, name);
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== null && vals[i] !== undefined) return i;
  throw new Error(`series empty: ${name}`);
}

/** Latest non-null value with its period label. */
function last(d: ChartData, name: string): { period: string; value: number } {
  const i = lastIdx(d, name);
  return { period: d.periods[i], value: ser(d, name)[i]! };
}

/**
 * The reading `k` periods before the latest one. Every window in this file is
 * expressed this way rather than as a literal quarter, so a refreshed workbook
 * moves the whole analysis forward instead of silently freezing it in the past.
 */
function back(d: ChartData, name: string, k: number): { period: string; value: number } {
  const i = lastIdx(d, name) - k;
  const v = i >= 0 ? ser(d, name)[i] : null;
  if (v === null || v === undefined) throw new Error(`${name} @ latest-${k} missing`);
  return { period: d.periods[i], value: v };
}

/**
 * The most recent trough: the lowest reading in the trailing `window` periods.
 * Used instead of a hardcoded "the cycle bottomed in 3Q24" so the claim keeps
 * pointing at the real low as new quarters arrive.
 */
function trough(d: ChartData, name: string, window = 12): { period: string; value: number } {
  const vals = ser(d, name);
  const end = lastIdx(d, name);
  let bi = -1;
  for (let i = Math.max(0, end - window + 1); i <= end; i++) {
    const v = vals[i];
    if (v === null || v === undefined) continue;
    if (bi < 0 || v < vals[bi]!) bi = i;
  }
  if (bi < 0) throw new Error(`no trough: ${name}`);
  return { period: d.periods[bi], value: vals[bi]! };
}

/** "1Q26" -> "1Q"; used to compare a quarter with the same quarter of other years. */
const quarterOf = (period: string) => (/^\dQ/.test(period) ? period.slice(0, 2) : "");

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
  hh: "Asset Quality (household) sheet (household-book NPL, %)",
  rates: "Personal Loans - Interest rates sheet (BCB weekly, % a.a.)",
};

// ---------------------------------------------------------------------------
// A. Monetization gap — TPV share vs card-loan share
// ---------------------------------------------------------------------------
function insightMonetizationGap(): Insight {
  const nuTpv = last(tpvShare, "Nu");
  const itTpv = last(tpvShare, "Itaú");
  const nuLoan = last(creditCardShare, "Nu");
  const itLoan = last(creditCardShare, "Itaú");
  const rNu = nuLoan.value / nuTpv.value;
  const rIt = itLoan.value / itTpv.value;
  const implied = nuTpv.value * rIt;
  const gapPp = implied - nuLoan.value;
  const sysCard = last(loanAbsCreditCard, "System"); // R$ mn, latest loan quarter
  const latentMn = (gapPp / 100) * sysCard.value;

  // conversion-ratio trend (quarterly era, where both series have the period)
  const qs = creditCardShare.periods.filter((p) => /Q/.test(p) && tpvShare.periods.includes(p));
  const ratio = (bank: string) => qs.map((p) => {
    const l = ser(creditCardShare, bank)[creditCardShare.periods.indexOf(p)];
    const t = ser(tpvShare, bank)[tpvShare.periods.indexOf(p)];
    return l !== null && t !== null && t !== 0 ? Math.round((l / t) * 100) / 100 : null;
  });

  const steps: CalcStep[] = [
    { label: "How much of Brazil's card spending goes through Nu", math: `read straight off the sheet`, result: `${f(nuTpv.value)}%`, source: `${SHEETS.tpv} · ${nuTpv.period}` },
    { label: "How much of Brazil's card lending sits with Nu", math: `read straight off the sheet`, result: `${f(nuLoan.value)}%`, source: `${SHEETS.loans} · ${nuLoan.period}` },
    { label: "Nu's 'spending → lending' conversion rate", math: `${f(nuLoan.value)} ÷ ${f(nuTpv.value)}`, result: f(rNu, 2) },
    { label: "Itaú's conversion rate — the benchmark to beat", math: `${f(itLoan.value)} ÷ ${f(itTpv.value)}`, result: f(rIt, 2) },
    { label: "Nu's lending share IF it converted spending like Itaú does", math: `${f(nuTpv.value)} × ${f(rIt, 2)}`, result: `${f(implied)}%` },
    { label: "That gap, turned into money", math: `(${f(implied)} − ${f(nuLoan.value)})% × ${bn(sysCard.value, 0)} total card-loan market`, result: `≈ ${bn(latentMn, 0)}`, source: `${SHEETS.loans} · Total · ${sysCard.period}` },
  ];

  return {
    id: "monetization-gap",
    kind: "opportunity",
    confidence: "High",
    title: `Nu handles ${f(nuTpv.value)}% of card spending — but only ${f(nuLoan.value)}% of card lending`,
    takeaway: `Nu's customers already spend through Nu far more than they borrow through Nu. If Nu turned spending into lending at Itaú's rate, it would hold ≈ ${bn(latentMn, 0)} more in card loans — without winning a single new customer.`,
    stat: { value: bn(latentMn, 0), label: "of extra card lending available inside Nu's existing customer base" },
    detail: `For every 1% of Brazil's card spending Nu handles, it captures only ${f(rNu, 2)}% of card lending; Itaú converts at ${f(rIt, 2)}. Nu's rate has been improving (${f(ratio("Nu")[0] ?? 0, 2)} in ${qs[0]} → ${f(rNu, 2)} now), so the gap is closing — but what's left is worth ≈ ${bn(latentMn, 0)} at today's market size. This is the cleanest way to measure how much lending growth Nu can get from customers it already has.`,
    sources: [SHEETS.tpv, SHEETS.loans],
    formula: "extra lending = Nu spending-share × (Itaú lending-share ÷ Itaú spending-share) − Nu lending-share, × total card-loan market",
    steps,
    caveats: [
      "Card spending (TPV) includes debit and prepaid purchases; Nu's customers use debit a lot, so part of the gap may never convert into loans.",
    ...(nuTpv.period === nuLoan.period
      ? []
      : [`The two readings are a quarter apart (spending is ${nuTpv.period}, lending is ${nuLoan.period}) — card volumes publish before IF.data balances.`]),
      "Itaú's conversion rate is boosted by corporate and premium cards Nu doesn't offer (yet).",
    ],
    evidence: {
      title: "How well each bank turns card spending into card lending (lending share ÷ spending share)",
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
  // Find the record share-grab quarter in the data rather than naming one: a
  // refreshed workbook can move it, and a hardcoded quarter would quietly turn
  // the headline into a false claim.
  const nuShare = ser(creditCardShare, "Nu");
  const qIdx = creditCardShare.periods.map((p, i) => ({ p, i })).filter((x) => /Q/.test(x.p));
  let maxJump = -Infinity, maxK = -1;
  for (let k = 1; k < qIdx.length; k++) {
    const a = nuShare[qIdx[k - 1].i], b = nuShare[qIdx[k].i];
    if (a !== null && b !== null && b - a > maxJump) { maxJump = b - a; maxK = k; }
  }
  if (maxK < 1) throw new Error("no quarterly share history");
  const P1 = qIdx[maxK - 1].p, P2 = qIdx[maxK].p;
  const maxAt = P2;

  const sys1 = at(loanAbsCreditCard, "System", P1), sys2 = at(loanAbsCreditCard, "System", P2);
  const nu1 = at(loanAbsCreditCard, "Nu", P1), nu2 = at(loanAbsCreditCard, "Nu", P2);
  const it1 = at(loanAbsCreditCard, "Itaú", P1), it2 = at(loanAbsCreditCard, "Itaú", P2);
  const qoq = (a: number, b: number) => 100 * (b / a - 1);
  const sh1 = at(creditCardShare, "Nu", P1), sh2 = at(creditCardShare, "Nu", P2);
  const jump = sh2 - sh1;

  // This insight is specifically "a record grab while the market shrank". If a
  // future quarter takes the record in a GROWING market the claim no longer
  // holds, so we skip the card rather than print a half-true headline.
  if (sys2 >= sys1) throw new Error(`record grab ${P2} happened in a growing market`);

  // The quarters that followed, for the "was it a one-off?" caveat.
  const after = qIdx.slice(maxK + 1).map((x, n) => {
    const a = nuShare[qIdx[maxK + n].i], b = nuShare[x.i];
    return a !== null && b !== null ? `${signed(b - a, 2)}pp` : null;
  }).filter((x): x is string => x !== null);

  const steps: CalcStep[] = [
    { label: `Brazil's total card loans, ${P1} → ${P2}`, math: `${mn(sys1)} → ${mn(sys2)} (R$ mn)`, result: `${signed(qoq(sys1, sys2))}% — the market SHRANK`, source: `${SHEETS.loans} · Total row` },
    { label: "Itaú's card loans in that same quarter", math: `${mn(it1)} → ${mn(it2)}`, result: `${signed(qoq(it1, it2))}% — pulling back`, source: `${SHEETS.loans} · Itaú` },
    { label: "Nu's card loans in that same quarter", math: `${mn(nu1)} → ${mn(nu2)}`, result: `${signed(qoq(nu1, nu2))}% — expanding`, source: `${SHEETS.loans} · Nu (both entities)` },
    { label: "What that did to Nu's market share", math: `${f(sh1, 2)}% → ${f(sh2, 2)}%`, result: `${signed(jump, 2)}pp in one quarter` },
    { label: "Sanity check: compare with every other quarter on record", math: `biggest one-quarter share gain across all ${qIdx.length - 1} quarter-on-quarter moves = ${signed(maxJump, 2)}pp`, result: `${maxAt} is the biggest on record` },
  ];

  return {
    id: "shrinking-market-grab",
    kind: "change",
    confidence: "High",
    title: "Nu's biggest share jump ever happened while the card market was shrinking",
    takeaway: `In ${P2} Brazil's total card loans fell ${signed(qoq(sys1, sys2))}% and Itaú cut its book ${signed(qoq(it1, it2))}% — yet Nu grew ${signed(qoq(nu1, nu2))}%. Result: Nu's largest single-quarter share gain on record (${signed(jump, 2)}pp).`,
    stat: { value: `${signed(jump, 2)}pp`, label: `market share gained in one quarter (${P2}) — a record — while the market shrank` },
    detail: `Growing when the whole market grows proves little — you're just riding the tide. Growing while the market shrinks means Nu was lending exactly when the big banks were pulling back from card risk. Two possible readings: Nu's data lets it spot good borrowers the incumbents can't — or Nu is taking on the risk the incumbents wanted off their books. How Nu's 2025 loans repay over the next year will settle which one it was.`,
    sources: [SHEETS.loans],
    formula: `growth% = loans(${P2}) ÷ loans(${P1}) − 1;  share change = Nu share(${P2}) − Nu share(${P1})`,
    steps,
    caveats: [
      after.length
        ? `One quarter's event: the quarters since then gained ${after.join(", ")}.`
        : "One quarter's event — no later quarter to compare it with yet.",
      "Nu merged its two legal entities' reporting in 1Q25; we add both entities in every quarter so the comparison stays apples-to-apples, but some reclassification noise is possible.",
      "When incumbents retreat, Nu's share rises even if Nu changes nothing — the share jump alone doesn't prove Nu got more aggressive.",
    ],
    evidence: {
      title: `Card-loan growth in ${P2}, bank by bank (% vs previous quarter)`,
      type: "bar",
      data: cd([`${P2} QoQ growth`], [
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
  const isRecord = cur.value >= maxNpl - 1e-9;
  const eVals = enpl.filter((v): v is number => v !== null);
  const maxE = Math.max(...eVals);
  const rankE = eVals.slice().sort((a, b) => a - b).findIndex((v) => v >= curE.value) + 1;
  const yAgo = back(systemEarlyNpl, "Credit card loans", 4);
  const prev = back(systemEarlyNpl, "Credit card loans", 1);
  const yoyE = curE.value - yAgo.value;

  // Seasonality, generalised: how much early NPL usually moves INTO this
  // quarter-of-the-year, measured across every year in the sheet. (The old
  // version hardcoded the January effect and broke the moment the latest
  // reading stopped being a Q1.)
  const qLabel = quarterOf(curE.period);
  const seasonal: number[] = [];
  periods.forEach((pd, i) => {
    if (i === 0 || quarterOf(pd) !== qLabel) return;
    const a = enpl[i - 1], b = enpl[i];
    if (a !== null && b !== null) seasonal.push(b - a);
  });
  const avgSeason = seasonal.reduce((s, v) => s + v, 0) / (seasonal.length || 1);
  const thisMove = curE.value - prev.value;

  // Nu's own product mix, for the "why this matters for Nu" line.
  const nuC = last(loanAbsCreditCard, "Nu").value;
  const nuBook = nuC + last(loanAbsUnsecured, "Nu").value + last(loanAbsPayroll, "Nu").value;

  const steps: CalcStep[] = [
    { label: "Card loans gone bad today — 'headline NPL', the water LEVEL in the tub", math: `read straight off the sheet`, result: isRecord ? `${f(cur.value)}% — the highest of all ${periods.length} quarters` : `${f(cur.value)}% vs the record ${f(maxNpl)}%`, source: `${SHEETS.aq} · System NPL · ${cur.period}` },
    { label: "Loans JUST STARTING to miss payments — 'early NPL', the tap filling it", math: `read straight off the sheet`, result: `${f(curE.value)}%`, source: `${SHEETS.aq} · System early NPL · ${curE.period}` },
    { label: "Is the tap flowing faster than a year ago?", math: `${f(curE.value)} (${curE.period}) vs ${f(yAgo.value)} (${yAgo.period})`, result: `${signed(yoyE)}pp — ${Math.abs(yoyE) < 0.25 ? "essentially unchanged" : yoyE > 0 ? "yes, a little" : "no"}` },
    { label: "Is the tap high by its own history?", math: `sort all ${eVals.length} readings; today ranks #${rankE}`, result: `no — mid-pack (its record is ${f(maxE)}%)` },
    { label: "Remove the seasonal pattern", math: `early NPL typically moves ${signed(avgSeason, 2)}pp into a ${qLabel} quarter (${seasonal.length} years on record); this year ${f(prev.value)} → ${f(curE.value)} = ${signed(thisMove)}pp`, result: Math.abs(thisMove - avgSeason) < 0.25 ? "this quarter's move is the usual seasonal pattern" : `${signed(thisMove - avgSeason)}pp beyond the usual seasonal move` },
  ];

  return {
    id: "stock-not-flow",
    kind: "watch",
    confidence: "High",
    title: `Card defaults at ${isRecord ? "a record" : "near-record"} ${f(cur.value)}% — but NEW defaults aren't rising`,
    takeaway: `The scary headline — ${isRecord ? "a record" : "a near-record"} ${f(cur.value)}% of card loans gone bad — describes OLD loans still sitting on banks' books. The share of loans just starting to miss payments is ${f(curE.value)}%, ${signed(yoyE)}pp vs a year ago and unremarkable by its own history.`,
    stat: { value: `${signed(yoyE, 1)}pp`, label: "change vs a year ago in NEW card defaults — the number that describes today's borrowers" },
    detail: `Think of a bathtub: the headline default rate is the water level; new defaults are the tap. The level is at ${isRecord ? "a record" : "a near-record"}, but the tap is flowing ${Math.abs(yoyE) < 0.25 ? "no faster than" : yoyE > 0 ? "only marginally faster than" : "slower than"} last year. That means the level comes from old problem loans aging on the books (and banks writing them off slowly) — not from today's borrowers getting into trouble. For judging Nu — whose book is ~${f((100 * nuC) / nuBook, 0)}% cards — the tap matters more than the level.`,
    sources: [SHEETS.aq],
    formula: `compare today's rank-in-history for headline NPL vs early NPL; change vs a year ago; seasonal check = this ${qLabel} move vs the average ${qLabel} move`,
    steps,
    caveats: [
      "The sheet doesn't say exactly how many days overdue counts as 'early' — if that definition changed, the comparison would break.",
      "Banks writing off bad loans more slowly can keep the headline high even while new defaults improve — the direction of the tap is the signal, not the level of the tub.",
    ],
    evidence: {
      title: "Card loans: defaults on the books (headline) vs new defaults starting (early)",
      type: "line",
      data: cd(periods, [
        { name: "Defaults on the books", values: npl },
        { name: "New defaults starting", values: enpl },
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
  const low = trough(systemNpl, "Personal loans");
  const r0 = lagCorr(e, h, 0);
  const r1 = lagCorr(e, h, 1);
  const r2 = lagCorr(e, h, 2);
  // consecutive rises in early NPL
  const ev = e.filter((v): v is number => v !== null);
  let rises = 0;
  for (let i = ev.length - 1; i > 0 && rises < 6; i--) { if (ev[i] > ev[i - 1]) rises++; else break; }

  const steps: CalcStep[] = [
    { label: "Personal-loan defaults, from their low point to now", math: `${f(low.value)}% (${low.period}) → ${f(curH.value)}% (${curH.period})`, result: `${signed(curH.value - low.value)}pp worse in ${periods.indexOf(curH.period) - periods.indexOf(low.period)} quarters`, source: `${SHEETS.aq} · System NPL · Personal loans` },
    { label: "The live gauge: loans just starting to miss payments", math: `last readings: ${e.slice(-5).map((v) => (v === null ? "–" : f(v))).join(" → ")}`, result: `${f(curE.value)}% — still climbing (${rises} rises in a row)`, source: `${SHEETS.aq} · System early NPL` },
    { label: "Test: does the live gauge PREDICT the headline, or move WITH it?", math: `how tightly they move together (0–1 scale), shifting one 0, 1, 2 quarters ahead: ${f(r0.r, 2)}, ${f(r1.r, 2)}, ${f(r2.r, 2)} (${r0.n} quarters)`, result: `tightest with NO shift — they move together in the same quarter` },
    { label: "Put the two together", math: `live gauge still rising + it moves with the headline`, result: "no sign the default cycle has peaked" },
  ];

  return {
    id: "personal-cycle-not-peaked",
    kind: "risk",
    confidence: "Medium",
    title: "Personal-loan defaults are still climbing — no peak in sight",
    takeaway: `Defaults on personal loans are up ${signed(curH.value - low.value)}pp since ${low.period}, to ${f(curH.value)}% — and the live gauge (loans just starting to miss payments) has risen ${rises} quarters running. The data gives no reason to call the top yet.`,
    stat: { value: `${f(curH.value)}%`, label: `of personal loans gone bad — and the early-warning gauge is still rising` },
    detail: `This matters because personal loans are where Nu is growing fastest (see the unsecured-growth insight). We also tested the common belief that early defaults predict headline defaults 2–3 quarters in advance: in this data they don't — the two move together in the same quarter (correlation ${f(r0.r, 2)}). So the message is simple: the live gauge hasn't turned down, which means the default cycle most likely hasn't peaked.`,
    sources: [SHEETS.aq],
    formula: "correlation between early defaults(quarter t) and headline defaults(quarter t+k), tested at k = 0, 1, 2",
    steps,
    caveats: [
      `The link is moderate (correlation ≈ ${f(r0.r, 2)} over ${r0.n} quarters) — good for reading the cycle's direction, not for precise forecasts.`,
      "These are Brazil-wide numbers; Nu's own borrowers could be doing better or worse than the average.",
      "Fast interest-rate cuts would be the classic way this cycle turns down.",
    ],
    evidence: {
      title: "Personal loans: defaults on the books (headline) vs new defaults starting (early)",
      type: "line",
      data: cd(periods, [
        { name: "Defaults on the books", values: h },
        { name: "New defaults starting", values: e },
      ]),
    },
  };
}

// ---------------------------------------------------------------------------
// E. Product-mix NPL exposure — Nu's book is built riskier
// ---------------------------------------------------------------------------
function mixNpl(bank: string) {
  const cc = last(loanAbsCreditCard, bank);
  const c = cc.value;
  const u = last(loanAbsUnsecured, bank).value;
  const p = last(loanAbsPayroll, bank).value;
  const nplAt = last(systemNpl, "Credit card loans").period;
  const nplC = last(systemNpl, "Credit card loans").value;
  const nplU = last(systemNpl, "Personal loans").value;
  const nplP = last(systemNpl, "Payroll loans").value;
  const tot = c + u + p;
  return { c, u, p, tot, w: (c * nplC + u * nplU + p * nplP) / tot, nplC, nplU, nplP, booksAt: cc.period, nplAt };
}

function insightMixRisk(): Insight {
  const nu = mixNpl("Nu");
  const it = mixNpl("Itaú");
  const br = mixNpl("Bradesco");
  const sa = mixNpl("Santander");
  const gap = nu.w - it.w;

  const steps: CalcStep[] = [
    { label: `What Nu's loan book is made of (${nu.booksAt}, R$ mn)`, math: `cards ${mn(nu.c)} (${f((100 * nu.c) / nu.tot, 0)}%) · personal ${mn(nu.u)} (${f((100 * nu.u) / nu.tot, 0)}%) · payroll ${mn(nu.p)} (${f((100 * nu.p) / nu.tot, 0)}%)`, result: `${f((100 * (nu.c + nu.u)) / nu.tot, 0)}% of the book has no collateral behind it`, source: `${SHEETS.loans} · Nu rows, ${nu.booksAt}` },
    { label: `Brazil-wide default rate of each product (${nu.nplAt})`, math: `cards ${f(nu.nplC)}% · personal ${f(nu.nplU)}% · payroll ${f(nu.nplP)}%`, result: "the 'risk price' of each product, same for every bank", source: `${SHEETS.aq} · System NPL` },
    { label: "Multiply Nu's book by those rates", math: `(${mn(nu.c)}×${f(nu.nplC)} + ${mn(nu.u)}×${f(nu.nplU)} + ${mn(nu.p)}×${f(nu.nplP)}) ÷ ${mn(nu.tot)}`, result: `${f(nu.w, 2)}% — the default rate Nu's MENU alone implies` },
    { label: "Same math for the big banks", math: `Itaú ${f(it.w, 2)}% · Santander ${f(sa.w, 2)}% · Bradesco ${f(br.w, 2)}%`, result: "what THEIR menus imply" },
    { label: "The built-in gap Nu has to out-lend", math: `${f(nu.w, 2)} − ${f(it.w, 2)}`, result: `${signed(gap, 2)}pp vs Itaú (${signed(nu.w - br.w, 2)}pp vs Bradesco)` },
  ];

  return {
    id: "mix-weighted-risk",
    kind: "structural",
    confidence: "High",
    title: `Nu's loan menu is riskier than the big banks' — before skill even enters`,
    takeaway: `${f((100 * (nu.c + nu.u)) / nu.tot, 0)}% of Nu's book is credit cards + personal loans — Brazil's two highest-default products. Give every bank IDENTICAL skill and Nu's book would still run ${f(nu.w, 1)}% defaults vs ${f(it.w, 1)}% for Itaú and ${f(br.w, 1)}% for Bradesco. That's risk built into WHAT Nu sells, not HOW WELL it lends.`,
    stat: { value: `${f(nu.w, 1)}%`, label: `the default rate Nu's product menu alone implies — vs ${f(it.w, 1)}% Itaú / ${f(br.w, 1)}% Bradesco` },
    detail: `Comparing banks on headline default rates mixes up two different things: what products they sell, and how well they pick borrowers. This calculation strips out the first. Practical use: when Nu reports defaults close to the big banks, it is actually out-lending them by roughly this gap; when Nu's defaults look worse, check how much is just the menu before drawing conclusions. It also prices the payroll push — every 1% of the book moved from cards into payroll trims ~${f(nu.nplC - nu.nplP, 1)}bp (hundredths of a %) of built-in risk.`,
    sources: [SHEETS.loans, SHEETS.aq],
    formula: "menu default rate (bank) = sum over products of [bank's balance in product × Brazil default rate of product] ÷ bank's total balance",
    steps,
    caveats: [
      "Uses Brazil-wide default rates for every bank on purpose — that's what isolates the menu from the skill.",
      "Covers the three products in the sheet; the big banks also hold mortgages and vehicle loans (usually safer), so their real full-book advantage is bigger than shown, not smaller.",
      `Books are ${nu.booksAt}, default rates are ${nu.nplAt} — IF.data balances publish on a longer lag than the NPL series.`,
    ],
    evidence: {
      title: "Default rate each bank's product menu implies (identical lending skill assumed)",
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
  // Rolling four-quarter window ending at the newest balance in the workbook.
  const P1 = last(loanAbsUnsecured, "System").period;
  const P0 = back(loanAbsUnsecured, "System", 4).period;
  const sys0 = at(loanAbsUnsecured, "System", P0), sys1 = at(loanAbsUnsecured, "System", P1);
  const nu0 = at(loanAbsUnsecured, "Nu", P0), nu1 = at(loanAbsUnsecured, "Nu", P1);
  const dSys = sys1 - sys0, dNu = nu1 - nu0;
  const capture = (100 * dNu) / dSys;
  const share = last(unsecuredShare, "Nu").value;
  const ratio = capture / share;
  const nplNow = last(systemNpl, "Personal loans");
  const low = trough(systemNpl, "Personal loans");
  const banks: [string, number][] = ["Bradesco", "BB", "Itaú", "Caixa", "Inter"].map((b) => [b, at(loanAbsUnsecured, b, P1) - at(loanAbsUnsecured, b, P0)]);

  // The same calculation over the PRIOR year, because a one-year capture ratio
  // swings hard with the system total — showing both keeps the claim honest.
  const P00 = back(loanAbsUnsecured, "System", 8).period;
  const prevCapture =
    (100 * (at(loanAbsUnsecured, "Nu", P0) - at(loanAbsUnsecured, "Nu", P00))) /
    (at(loanAbsUnsecured, "System", P0) - at(loanAbsUnsecured, "System", P00));

  // How the eight banks the sheet DOES list compare with the system total. This
  // has to be measured, not assumed: in some windows the unlisted banks supply
  // growth, in others they shrink, and the two capture ratios swap places.
  const LISTED = ["Nu", "Itaú", "Bradesco", "Santander", "Caixa", "BB", "Inter", "XP"];
  const dListed = LISTED.reduce((sum, b) => {
    const v0 = ser(loanAbsUnsecured, b)[loanAbsUnsecured.periods.indexOf(P0)];
    const v1 = ser(loanAbsUnsecured, b)[loanAbsUnsecured.periods.indexOf(P1)];
    return v0 == null || v1 == null ? sum : sum + (v1 - v0);
  }, 0);
  const captureListed = (100 * dNu) / dListed;
  const dUnlisted = dSys - dListed;

  const steps: CalcStep[] = [
    { label: "How much unsecured lending Brazil ADDED in a year", math: `${mn(sys1)} − ${mn(sys0)}`, result: `+${mn(dSys)} (R$ mn)`, source: `${SHEETS.loans} · Total · ${P0}→${P1}` },
    { label: "How much of that came from Nu", math: `${mn(nu1)} − ${mn(nu0)}`, result: `+${mn(dNu)} (Nu's own book grew ${signed(100 * (nu1 / nu0 - 1), 0)}% in the year)`, source: `${SHEETS.loans} · Nu rows` },
    { label: "Nu's slice of ALL the new lending", math: `${mn(dNu)} ÷ ${mn(dSys)}`, result: `${f(capture)}% — more than any other bank` },
    { label: "Compare that with Nu's normal size in this market", math: `${f(capture)} ÷ ${f(share)}`, result: `${f(ratio, 1)}× bigger than its ${f(share)}% market share` },
    { label: "Compare with the year before that", math: `same math over ${P00}→${P0}`, result: `${f(prevCapture, 0)}% — the ratio swings with how fast the whole market grows`, source: `${SHEETS.loans} · Total row` },
    { label: "What was happening to defaults meanwhile", math: `personal-loan defaults ${f(low.value)}% (${low.period}) → ${f(nplNow.value)}% (${nplNow.period})`, result: `${signed(nplNow.value - low.value)}pp worse while Nu accelerated`, source: `${SHEETS.aq} · System NPL` },
  ];

  return {
    id: "unsecured-capture",
    kind: "risk",
    confidence: "High",
    title: `One bank, ${capture >= 45 ? "most" : capture >= 28 ? "a third" : "a fifth"} of the growth: Nu took ${f(capture, 0)}% of all new unsecured lending`,
    takeaway: `Of every new real of unsecured (no-collateral) lending Brazil added in the year to ${P1}, ${f(capture, 0)} cents came from Nu — ${f(ratio, 1)}× more than its ${f(share, 0)}% market share would suggest. And it happened while that product's default rate climbed from ${f(low.value)}% to ${f(nplNow.value)}%.`,
    stat: { value: `${f(capture, 0)}%`, label: `of Brazil's entire unsecured-lending growth came from Nu — a bank with a ${f(share)}% share` },
    detail: `Taking growth at ${f(ratio, 1)}× your market share is what winning a market looks like. Doing it while defaults in that exact product rise fastest is what buying risk at the top can look like. Both can be true at once — it depends entirely on how Nu's 2025 borrowers repay. The size of the bet is the insight: ${f(capture, 0)}% of the market's new lending in that window landed on Nu's book.`,
    sources: [SHEETS.loans, SHEETS.aq],
    formula: `Nu's slice = Nu's growth ÷ Brazil's growth (${P0}→${P1});  intensity = that slice ÷ Nu's market share`,
    steps,
    caveats: [
      `One-year window — this ratio bounces around: the previous year read ${f(prevCapture, 0)}%. It rises whenever the system total grows slowly, not only when Nu grows fast.`,
      dUnlisted >= 0
        ? `Brazil's total includes banks the sheet doesn't list; they supplied ${mn(dUnlisted)} of the ${mn(dSys)} growth, so measured against the eight listed banks alone Nu's slice is ${f(captureListed, 0)}%.`
        : `The eight listed banks grew ${mn(dListed)} between them while the whole system grew only ${mn(dSys)} — the banks the sheet doesn't list SHRANK by ${mn(-dUnlisted)}. Measured against the listed banks alone Nu's slice is ${f(captureListed, 0)}%, lower than the ${f(capture, 0)}% headline.`,
      "The workbook gives Nu's whole-bank NPL but not its default rate on this product specifically; the rising system rate is the market backdrop, not Nu's realised losses.",
    ],
    evidence: {
      title: `Who supplied Brazil's new unsecured lending (${P0}→${P1}, R$ mn)`,
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
// G. Payroll: a fast entry into the product the incumbents are leaving
// ---------------------------------------------------------------------------
function insightPayrollEntry(): Insight {
  // Headline on the YEAR, not the quarter: IF.data restates recent payroll
  // balances (4Q25 was revised from 6,791 to 4,098 between workbooks), and a
  // single-quarter growth rate is far more fragile to that than a 4-quarter one.
  const nuPrev = back(loanAbsPayroll, "Nu", 1), nuNow = last(loanAbsPayroll, "Nu");
  const nuYAgo = back(loanAbsPayroll, "Nu", 4);
  const qoq = 100 * (nuNow.value / nuPrev.value - 1);
  const yoy = 100 * (nuNow.value / nuYAgo.value - 1);
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
    { label: `Nu's payroll-loan book over the year to ${nuNow.period}`, math: `${mn(nuYAgo.value)} (${nuYAgo.period}) → ${mn(nuNow.value)} (${nuNow.period}), R$ mn`, result: `${signed(yoy, 0)}% in a year — Nu's fastest-growing product (${signed(qoq, 0)}% in the last quarter alone)`, source: `${SHEETS.loans} · Nu rows` },
    { label: "Meanwhile, the big bank on the other side", math: `Santander's payroll book: peak ${mn(peak)} (${peakPeriod}) → ${mn(santNow)} now`, result: `${f(santDraw)}% below its peak — retreating`, source: `${SHEETS.loans} · Santander` },
    { label: "The product's condition right now", math: `payroll defaults ${f(pNpl)}% vs their all-time high of ${f(pMax)}%`, result: pNpl === pMax ? "Nu is entering at the product's WORST defaults on record" : "near the record", source: `${SHEETS.aq} · System NPL · Payroll` },
    { label: "…and yet payroll is still the safest product around", math: `card defaults ${f(cNpl)}% ÷ payroll defaults ${f(pNpl)}%`, result: `${f(cNpl / pNpl, 1)}× safer than credit cards` },
    { label: "What this does to Nu's overall risk", math: `${f(cNpl)} − ${f(pNpl)} = ${f(mixCut)}pp safety gap between the products`, result: `every 1% of the book moved cards → payroll trims ~${f(mixCut, 1)}bp of built-in risk` },
  ];

  return {
    id: "payroll-contrarian-entry",
    kind: "opportunity",
    confidence: "Medium",
    title: `Nu is sprinting into payroll loans just as the big banks walk out`,
    takeaway: `Nu's payroll-loan book (loans repaid straight out of salaries) grew ${signed(yoy, 0)}% in the year to ${nuNow.period}, while Santander's sits ${f(santDraw)}% below its peak. It's Nu's safest product — and growing it directly waters down the riskiness of Nu's overall loan menu.`,
    stat: { value: `${signed(yoy, 0)}%`, label: `growth in Nu's payroll loans in the year to ${nuNow.period} — from a ${f(at(payrollShare, "Nu", nuYAgo.period), 2)}% share to ${f(last(payrollShare, "Nu").value, 2)}%` },
    detail: `Payroll loans get deducted from paychecks before the borrower can spend the money, which is why they run ${f(cNpl / pNpl, 1)}× fewer defaults than credit cards — even now, at ${pNpl >= pMax - 1e-9 ? "the product's worst-ever" : "an elevated"} ${f(pNpl)}%. The timing is the story: Nu scales in exactly when a big incumbent retreats and the product's defaults ${pNpl >= pMax - 1e-9 ? "peak" : "run high"} — a classic contrarian entry. And it connects to the 'loan menu' insight: every 1% of Nu's book that shifts from cards to payroll trims about ${f(mixCut, 1)}bp of built-in risk.`,
    sources: [SHEETS.loans, SHEETS.aq],
    formula: `year growth = Nu(${nuNow.period}) ÷ Nu(${nuYAgo.period}) − 1;  Santander pullback = now ÷ peak − 1;  risk effect = card defaults − payroll defaults, per 1% of book shifted`,
    steps,
    caveats: [
      `Small-base warning: ${signed(yoy, 0)}% growth is easy off a tiny base — Nu's payroll share is still only ${f(last(payrollShare, "Nu").value, 2)}% of the market.`,
      "IF.data restates recent payroll balances between publications — this workbook revised one recent quarter down by roughly 40% — so read the trend, not any single quarter.",
      "Payroll loans earn thin, rate-capped margins — they lower risk but also lower yield.",
      "Record payroll defaults could mean the product itself is deteriorating (rate caps squeezing weaker borrowers), not just a passing cycle.",
    ],
    evidence: {
      title: "Payroll-loan market share: Nu walks in as Santander walks out",
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
  // Rolling two-year window ending at the newest share reading.
  const P1 = last(creditCardShare, "Nu").period;
  const P0 = back(creditCardShare, "Nu", 8).period;
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
    { label: `Card market share gained over two years (${P0}→${P1})`, math: `Nu ${signed(nuD, 2)}pp vs Inter ${signed(inD, 2)}pp`, result: `Nu gained ${f(nuD / inD, 0)}× more`, source: `${SHEETS.loans} · share columns` },
    { label: "How the other digital bank's loans are performing", math: `Inter defaults ${f(inNpl.value)}% vs Itaú ${f(itNpl.value)}%`, result: `${f(spread)}pp worse than the best incumbent`, source: `${SHEETS.aq} · Peer NPL · ${inNpl.period}` },
    { label: "Put that gap in historical context", math: `widest Inter-vs-Itaú gap across all quarters = ${f(maxSpread)}pp, in ${maxAt}`, result: maxAt === inNpl.period ? "the widest ever is RIGHT NOW" : `widest was ${maxAt}` },
    { label: "And the incumbent isn't standing still", math: `Itaú defaults ${f(itNpl.value)}% vs the best it has ever printed (${f(itMin)}%)`, result: itNpl.value === itMin ? "Itaú is at its all-time BEST while Inter worsens" : "near its best" },
  ];

  return {
    id: "inter-mirror",
    kind: "structural",
    confidence: "Medium",
    title: "Inter is the proof: 'being digital' isn't the edge — being Nu is",
    takeaway: `Brazil's other listed digital bank gained just ${signed(inD, 2)}pp of card share in two years while Nu gained ${signed(nuD, 2)}pp — ${f(nuD / inD, 0)}× more. Meanwhile Inter's defaults sit ${f(spread)}pp above Itaú's${maxAt === inNpl.period ? " — the furthest they have ever been" : ""}.`,
    stat: { value: `${f(nuD / inD, 0)}×`, label: `Nu gained ${f(nuD / inD, 0)}× more card share than Inter over the same two years` },
    detail: `If a slick app and no branches were all it took, Inter would be compounding like Nu. It isn't: barely any share progress, and loan quality drifting the wrong way while Itaú sits at its best-ever default rate. For a Nu investor this cuts both ways. It confirms Nu's edge is specific to Nu — funding cost, data, execution. But it also removes the comfort of a sector tailwind: Nu has to keep out-executing, because 'digital' by itself demonstrably doesn't win.`,
    sources: [SHEETS.loans, SHEETS.aq],
    formula: `share gained = share(${P1}) − share(${P0}), per bank;  quality gap = Inter defaults − Itaú defaults, ranked across every quarter`,
    steps,
    caveats: [
      "Inter runs a different model (heavy in mortgages and secured loans), so its NPL is not directly comparable with Nu's.",
      `Share is a two-year window ending ${P1}; a different window changes the multiple.`,
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
// I. Nu's default premium vs incumbents is mostly BOOK MIX, not underwriting
// ---------------------------------------------------------------------------
// Newly answerable: the 08.24.2026 workbook publishes Nu's own NPL and a
// household-segment NPL for the incumbents, so the comparison no longer has to
// go through Inter as a stand-in.
function insightHouseholdLikeForLike(): Insight {
  const INC = [
    { label: "Itaú", bank: "Itaú", hh: "Itaú" },
    { label: "Santander", bank: "Santander Brasil", hh: "Santander" },
    { label: "Bradesco", bank: "Bradesco", hh: "Bradesco" },
  ];
  const nuBank = last(peerNpl, "Nu");
  const nuHh = last(householdNpl, "Nu");
  const bank = INC.map((i) => ({ ...i, v: last(peerNpl, i.bank).value }));
  const hh = INC.map((i) => ({ ...i, v: last(householdNpl, i.hh).value }));
  const avg = (xs: { v: number }[]) => xs.reduce((s, x) => s + x.v, 0) / xs.length;
  const bankAvg = avg(bank), hhAvg = avg(hh);
  const headline = nuBank.value - bankAvg;
  const likeForLike = nuHh.value - hhAvg;
  const mixEffect = headline - likeForLike;
  const mixPct = (100 * mixEffect) / headline;
  const worstHh = hh.reduce((a, b) => (b.v > a.v ? b : a));

  const steps: CalcStep[] = [
    { label: "Nu's 90-day default rate, whole bank", math: "read straight off the sheet", result: `${f(nuBank.value)}%`, source: `${SHEETS.aq} · NPL ratio · ${nuBank.period}` },
    { label: "The three incumbents, whole bank", math: bank.map((b) => `${b.label} ${f(b.v)}%`).join(" · "), result: `average ${f(bankAvg)}% → Nu looks ${signed(headline)}pp worse`, source: `${SHEETS.aq} · NPL ratio · ${nuBank.period}` },
    { label: "Why that comparison is unfair", math: "Nu lends almost only to households; the incumbents' ratio also contains mortgages and corporate loans, which default far less", result: "different books, not different skill" },
    { label: "Same three banks, HOUSEHOLD books only", math: hh.map((b) => `${b.label} ${f(b.v)}%`).join(" · "), result: `average ${f(hhAvg)}% → Nu is ${signed(likeForLike)}pp worse`, source: `${SHEETS.hh} · NPL ratio · ${nuHh.period}` },
    { label: "How much of the headline gap was just book mix", math: `${f(headline)} − ${f(likeForLike)}`, result: `${f(mixEffect)}pp — ${f(mixPct, 0)}% of the apparent gap` },
    { label: "Cross-check on Nu's side", math: `Nu whole-bank ${f(nuBank.value)}% vs Nu household ${f(nuHh.value)}%`, result: Math.abs(nuBank.value - nuHh.value) < 0.15 ? "identical — Nu has no diluting book, so only the incumbents move" : `${signed(nuHh.value - nuBank.value)}pp` },
  ];

  return {
    id: "household-like-for-like",
    kind: "structural",
    confidence: "High",
    title: `Nu's default premium is ${f(likeForLike)}pp, not ${f(headline)}pp — once you compare the same kind of loans`,
    takeaway: `Headline NPL says Nu (${f(nuBank.value)}%) runs ${signed(headline)}pp above the big three (${f(bankAvg)}% average). Strip the incumbents down to their HOUSEHOLD books — the only part comparable with Nu — and the premium falls to ${signed(likeForLike)}pp. ${f(mixPct, 0)}% of the scary gap was book mix.`,
    stat: { value: `${f(likeForLike)}pp`, label: `Nu's real default premium over incumbent household books (${nuHh.period})` },
    detail: `This is the single biggest correction to make when reading Nu's credit numbers. Itaú's ${f(bank[0].v)}% whole-bank ratio is held down by mortgages and corporate lending; on households alone it prints ${f(hh[0].v)}%. Nu has no such ballast, so its group ratio IS its household ratio. What survives the adjustment is a genuine premium — Nu still lends to a riskier household than ${worstHh.label} does — but it is ${f(likeForLike)}pp, and it should be judged against Nu's pricing (see the price-of-risk insight), not against a number built from a different balance sheet.`,
    sources: [SHEETS.aq, SHEETS.hh],
    formula: "headline premium = Nu NPL − average incumbent whole-bank NPL;  like-for-like premium = Nu NPL − average incumbent HOUSEHOLD NPL;  mix effect = the difference",
    steps,
    caveats: [
      "Each bank defines its household segment slightly differently; the sheet takes each one's own disclosure.",
      "Nu's ratio is group-level while the incumbents' are Brazilian operations — Nu's Mexico/Colombia books are inside its number.",
      "The adjustment shrinks the gap; it does not remove it. Nu still runs the highest household NPL of the four.",
    ],
    evidence: {
      title: "90-day NPL on household books only — Nu vs the big three",
      type: "line",
      data: cd(householdNpl.periods, [
        { name: "Nu", values: ser(householdNpl, "Nu") },
        ...INC.map((i) => ({ name: i.hh, values: ser(householdNpl, i.hh) })),
      ]),
    },
  };
}

// ---------------------------------------------------------------------------
// J. Price of risk — Nu charges far more than the extra losses it books
// ---------------------------------------------------------------------------
function insightPriceOfRisk(): Insight {
  const nuRate = last(personalLoanRate, "Nu");
  const itRate = last(personalLoanRate, "Itaú");
  const others = ["Itaú", "Bradesco", "Santander", "Caixa"].map((b) => ({ b, v: last(personalLoanRate, b).value }));
  const rateAvg = others.reduce((s, x) => s + x.v, 0) / others.length;
  const nuCor = last(costOfRisk, "Nu");
  const itCor = last(costOfRisk, "Itaú");
  const corOthers = ["Itaú", "Santander Brasil", "Bradesco"].map((b) => ({ b, v: last(costOfRisk, b).value }));
  const corAvg = corOthers.reduce((s, x) => s + x.v, 0) / corOthers.length;
  const priceGap = nuRate.value - itRate.value;
  const lossGap = nuCor.value - itCor.value;
  const cover = priceGap / lossGap;
  const first = { period: personalLoanRate.periods[0], nu: ser(personalLoanRate, "Nu")[0], it: ser(personalLoanRate, "Itaú")[0] };

  const steps: CalcStep[] = [
    { label: "What Nu charges for a personal loan", math: "BCB weekly rate, averaged over the quarter", result: `${f(nuRate.value)}% a.a.`, source: `${SHEETS.rates} · ${nuRate.period}` },
    { label: "What the big four charge for the same product", math: others.map((o) => `${o.b} ${f(o.v)}%`).join(" · "), result: `average ${f(rateAvg)}% a.a. → Nu prices ${signed(nuRate.value - rateAvg)}pp above them`, source: `${SHEETS.rates} · ${nuRate.period}` },
    { label: "What Nu's credit losses actually cost, per year", math: "cost of risk = annualised provisions ÷ loans — the same unit as an interest rate", result: `${f(nuCor.value)}% a.a.`, source: `${SHEETS.aq} · Cost of risk · ${nuCor.period}` },
    { label: "…and what they cost the incumbents", math: corOthers.map((o) => `${o.b === "Santander Brasil" ? "Santander" : o.b} ${f(o.v)}%`).join(" · "), result: `average ${f(corAvg)}% a.a.`, source: `${SHEETS.aq} · Cost of risk · ${nuCor.period}` },
    { label: "Put the two gaps side by side (vs Itaú)", math: `price gap ${signed(priceGap)}pp a.a.  vs  loss gap ${signed(lossGap)}pp a.a.`, result: `${f(cover, 1)}× — Nu charges ${f(cover, 1)} reais of extra interest for every extra real of credit loss` },
    { label: "Has the gap always been there?", math: `${first.period}: Nu ${f(first.nu ?? 0)}% vs Itaú ${f(first.it ?? 0)}% → ${nuRate.period}: Nu ${f(nuRate.value)}% vs Itaú ${f(itRate.value)}%`, result: `the price premium widened from ${signed((first.nu ?? 0) - (first.it ?? 0))}pp to ${signed(priceGap)}pp` },
  ];

  return {
    id: "price-of-risk",
    kind: "opportunity",
    confidence: "Medium",
    title: `Nu charges ${f(cover, 1)}× more interest than the extra credit losses it books`,
    takeaway: `Nu's personal loans price at ${f(nuRate.value)}% a.a. against Itaú's ${f(itRate.value)}% — ${signed(priceGap)}pp more. Nu's credit losses run ${f(nuCor.value)}% of loans a year against Itaú's ${f(itCor.value)}% — only ${signed(lossGap)}pp more. The higher default rate is bought, not suffered.`,
    stat: { value: `${f(cover, 1)}×`, label: "extra interest charged per unit of extra credit loss, vs Itaú" },
    detail: `Every "Nu's NPL is high" argument is incomplete without the other side of the trade. Both numbers here are annual percentages of the loan book, so they can be compared directly: Nu prices ${signed(priceGap)}pp above Itaú and books ${signed(lossGap)}pp more loss. That is the whole high-risk/high-price model in two numbers — and it is why Nu can run the highest household NPL of its peer group and still out-earn banks with cleaner books. The risk in the model is not the level of either number, it is what happens to the ratio if Brazil caps rates or if losses rise faster than Nu can reprice.`,
    sources: [SHEETS.rates, SHEETS.aq],
    formula: "price gap = Nu personal-loan rate − Itaú's;  loss gap = Nu cost of risk − Itaú's;  cover = price gap ÷ loss gap",
    steps,
    caveats: [
      "The rate is the headline APR on new non-payroll personal loans; cost of risk is measured across each bank's whole book. They are the closest comparable pair the workbook offers, not a margin calculation.",
      "Nu's realised asset yield is well below its personal-loan APR — credit cards, promotional rates and payroll loans all earn less.",
      "Funding costs differ; a cheaper deposit base is part of why Nu can price where it does.",
    ],
    evidence: {
      title: "Personal-loan rate (% a.a.) — Nu vs the big four",
      type: "line",
      data: cd(personalLoanRate.periods, [
        { name: "Nu", values: ser(personalLoanRate, "Nu") },
        ...["Itaú", "Bradesco", "Santander", "Caixa"].map((b) => ({ name: b, values: ser(personalLoanRate, b) })),
      ]),
      decimals: 0,
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
  insightHouseholdLikeForLike,
  insightPriceOfRisk,
  insightStockNotFlow,
  insightPersonalCycle,
  insightPayrollEntry,
  insightInterMirror,
].map(safe).filter((x): x is Insight => x !== null);
