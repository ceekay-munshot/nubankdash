// src/insights/engine.ts
//
// The insight engine. Every insight below is COMPUTED at module load from the
// bundled workbook series (src/data/datasets.ts + absolutes.ts from the
// Nu_Brazil workbook, src/data/bcb.ts from the BCB credit workbook), and
// each one carries its own step-by-step calculation trail built from the very
// same intermediate values that are displayed — so what you read on a card and
// what you see in the "how we got this" modal can never diverge.
//
// House rules for this file:
//  - No number is hardcoded; everything derives from the datasets.
//  - Every step's `math` string shows the real inputs, not placeholders.
//  - If the data can't support a claim, the insight states the honest version
//    (e.g. how far early NPL leads headline NPL is measured from the data and
//    reported with its correlations, not assumed from folklore).
//  - Never assume a frequency: the system NPL series are MONTHLY (BCB workbook)
//    while the bank series are quarterly, so "a year back" is perYear(d) steps.

import {
  tpvShare,
  peerNpl, householdNpl, personalLoanRate, costOfRisk,
  type ChartData,
} from "../data/datasets";
import { systemNpl, systemEarlyNpl, payrollNpl, payrollEarlyNpl } from "../data/bcb";
import {
  creditCardShare, unsecuredShare, payrollShare,
  loanAbsCreditCard, loanAbsUnsecured, loanAbsPayroll,
} from "../data/loans";
import { isMonthly, perYear, seasonOf, stepName, steps as nSteps } from "../lib/periods";
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

/** The same reading one year earlier (12 months or 4 quarters back, per the data). */
function yearAgo(d: ChartData, name: string): { period: string; value: number } {
  return back(d, name, perYear(d));
}

/**
 * The most recent trough: the lowest reading in the trailing `window` periods
 * (default: three years at the data's own frequency). Used instead of a
 * hardcoded "the cycle bottomed in 3Q24" so the claim keeps pointing at the
 * real low as new readings arrive.
 */
function trough(d: ChartData, name: string, window = 3 * perYear(d)): { period: string; value: number } {
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

/**
 * A cross-entity snapshot taken at ONE period: the latest period where `anchor`
 * reports. Every other entity is read at that same index — never at its own
 * latest — so a ranking or an average can never silently mix quarters. An
 * entity with no reading there is returned in `missing` for disclosure instead
 * of being back-filled from an older quarter.
 */
function panel(d: ChartData, anchor: string, names: string[]) {
  const i = lastIdx(d, anchor);
  const rows: { name: string; value: number }[] = [];
  const missing: string[] = [];
  for (const n of names) {
    const v = ser(d, n)[i];
    if (v === null || v === undefined) missing.push(n);
    else rows.push({ name: n, value: v });
  }
  const mean = rows.length ? rows.reduce((sum, r) => sum + r.value, 0) / rows.length : NaN;
  const of = (name: string) => {
    const r = rows.find((x) => x.name === name);
    if (!r) throw new Error(`${name} @ ${d.periods[i]} missing`);
    return r.value;
  };
  return { period: d.periods[i], rows, missing, mean, of };
}

/** Highest reading in the trailing year (latest included), with its period. */
function yearHigh(d: ChartData, name: string): { period: string; value: number } {
  const vals = ser(d, name);
  const end = lastIdx(d, name);
  let bi = -1;
  for (let i = Math.max(0, end - perYear(d) + 1); i <= end; i++) {
    const v = vals[i];
    if (v !== null && v !== undefined && (bi < 0 || v > vals[bi]!)) bi = i;
  }
  return { period: d.periods[bi], value: vals[bi]! };
}

/** How many readings in a row, ending at the latest, moved in direction `dir`. */
function runAtEnd(d: ChartData, name: string, dir: "up" | "down"): number {
  const vals = ser(d, name).filter((v): v is number => v !== null && v !== undefined);
  let n = 0;
  for (let i = vals.length - 1; i > 0; i--) {
    if (dir === "up" ? vals[i] > vals[i - 1] : vals[i] < vals[i - 1]) n++;
    else break;
  }
  return n;
}

/** `name`'s values re-indexed onto `periods` (null where `d` has no such period). */
function alignTo(d: ChartData, name: string, periods: string[]): (number | null)[] {
  const vals = ser(d, name);
  return periods.map((p) => {
    const i = d.periods.indexOf(p);
    return i >= 0 ? vals[i] : null;
  });
}

const maxOf = (vals: (number | null)[]) => Math.max(...vals.filter((v): v is number => v !== null));

/** "2Q26" -> a sortable number, so two quarter labels can be ordered. */
const quarterIndex = (period: string) => {
  const m = /^(\d)Q(\d{2})$/.exec(period);
  return m ? Number(m[2]) * 4 + Number(m[1]) : NaN;
};

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
  bcb: "BCB credit data workbook (NPL & Early NPL sheets, monthly %)",
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
      : [`The two readings are from different quarters (spending is ${nuTpv.period}, lending is ${nuLoan.period}) — ${quarterIndex(nuTpv.period) > quarterIndex(nuLoan.period) ? "card volumes publish before IF.data balances" : "IF.data balances are published before the issuers' card volumes reach the workbook"}.`]),
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
  const NAME = "Credit card loans";
  const periods = systemNpl.periods;
  const npl = ser(systemNpl, NAME);
  const enpl = alignTo(systemEarlyNpl, NAME, periods);
  const cur = last(systemNpl, NAME);
  const curE = last(systemEarlyNpl, NAME);
  const nplCount = npl.filter((v) => v !== null).length;
  const maxNpl = maxOf(npl);
  const isRecord = cur.value >= maxNpl - 1e-9;
  const eVals = ser(systemEarlyNpl, NAME).filter((v): v is number => v !== null);
  const maxE = maxOf(eVals);
  // Share of the gauge's own history that sits BELOW today's reading.
  const pctBelow = (100 * eVals.filter((v) => v < curE.value).length) / eVals.length;
  const yAgo = yearAgo(systemEarlyNpl, NAME);
  const prev = back(systemEarlyNpl, NAME, 1);
  const yoyE = curE.value - yAgo.value;
  // The insight IS "new defaults aren't the problem"; if the tap is clearly
  // running faster than a year ago, that claim is false and the card skips.
  if (yoyE >= 0.5) throw new Error(`card early NPL ${signed(yoyE)}pp YoY — new defaults are rising`);
  const unit = stepName(systemEarlyNpl);
  const dp = isMonthly(curE.period) ? 2 : 1; // monthly moves are hundredths of a point

  // Seasonality, generalised: how much early NPL usually moves INTO this
  // month (or quarter) of the year, measured across every year in the sheet.
  // (The first version hardcoded the January effect and broke the moment the
  // latest reading stopped being a Q1.)
  const season = seasonOf(curE.period);
  const ePeriods = systemEarlyNpl.periods;
  const eSer = ser(systemEarlyNpl, NAME);
  const curIdx = ePeriods.indexOf(curE.period);
  const seasonal: number[] = [];
  ePeriods.forEach((pd, i) => {
    // Skip the reading under test: including its own move in the baseline pulls
    // the benchmark toward the observation and can make an unusual move look
    // ordinary.
    if (i === 0 || i === curIdx || seasonOf(pd) !== season) return;
    const a = eSer[i - 1], b = eSer[i];
    if (a !== null && b !== null) seasonal.push(b - a);
  });
  const avgSeason = seasonal.reduce((s, v) => s + v, 0) / (seasonal.length || 1);
  const thisMove = curE.value - prev.value;
  const seasonName = isMonthly(curE.period) ? season : `a ${season} quarter`;

  // Nu's own product mix, for the "why this matters for Nu" line.
  const nuC = last(loanAbsCreditCard, "Nu").value;
  const nuBook = nuC + last(loanAbsUnsecured, "Nu").value + last(loanAbsPayroll, "Nu").value;

  const tap = Math.abs(yoyE) < 0.25 ? "aren't rising" : yoyE > 0 ? "are only edging up" : "are falling";
  const historyRead =
    pctBelow >= 80
      ? `yes — higher than ${f(pctBelow, 0)}% of its history (record ${f(maxE)}%)`
      : pctBelow >= 50
        ? `middling — above ${f(pctBelow, 0)}% of its history, well short of its ${f(maxE)}% record`
        : `no — lower than most of its history (its record is ${f(maxE)}%)`;

  const steps: CalcStep[] = [
    { label: "Card loans gone bad today — 'headline NPL', the water LEVEL in the tub", math: `read straight off the sheet`, result: isRecord ? `${f(cur.value)}% — the highest of all ${nSteps(systemNpl, nplCount)} since ${periods[0]}` : `${f(cur.value)}% vs the record ${f(maxNpl)}%`, source: `${SHEETS.bcb} · NPL · Credit card loans · ${cur.period}` },
    { label: "Loans JUST STARTING to miss payments — 'early NPL', the tap filling it", math: `read straight off the sheet (15–90 days overdue)`, result: `${f(curE.value)}%`, source: `${SHEETS.bcb} · Early NPL · Credit card loans · ${curE.period}` },
    { label: "Is the tap flowing faster than a year ago?", math: `${f(curE.value, dp)} (${curE.period}) vs ${f(yAgo.value, dp)} (${yAgo.period})`, result: `${signed(yoyE, dp)}pp — ${Math.abs(yoyE) < 0.25 ? "essentially unchanged" : yoyE > 0 ? "yes, a little" : "no"}` },
    { label: "Is the tap high by its own history?", math: `sort all ${eVals.length} ${unit}ly readings; today's sits above ${f(pctBelow, 0)}% of them`, result: historyRead },
    { label: "Remove the seasonal pattern", math: `early NPL typically moves ${signed(avgSeason, 2)}pp into ${seasonName} (${seasonal.length} earlier years, this one excluded); this year ${f(prev.value, dp)} → ${f(curE.value, dp)} = ${signed(thisMove, dp)}pp`, result: Math.abs(thisMove - avgSeason) < 0.25 ? `this ${unit}'s move is the usual seasonal pattern` : `${signed(thisMove - avgSeason, dp)}pp beyond the usual seasonal move` },
  ];

  return {
    id: "stock-not-flow",
    kind: "watch",
    confidence: "High",
    title: `Card defaults at ${isRecord ? "a record" : "near-record"} ${f(cur.value)}% — but NEW defaults ${tap}`,
    takeaway: `The scary headline — ${isRecord ? "a record" : "a near-record"} ${f(cur.value)}% of card loans gone bad — describes OLD loans still sitting on banks' books. The share of loans just starting to miss payments is ${f(curE.value)}%, ${signed(yoyE)}pp vs a year ago and ${pctBelow >= 80 ? "high" : "unremarkable"} by its own history.`,
    stat: { value: `${signed(yoyE, 1)}pp`, label: "change vs a year ago in NEW card defaults — the number that describes today's borrowers" },
    detail: `Think of a bathtub: the headline default rate is the water level; new defaults are the tap. The level is at ${isRecord ? "a record" : "a near-record"}, but the tap is flowing ${Math.abs(yoyE) < 0.25 ? "no faster than" : yoyE > 0 ? "only marginally faster than" : "slower than"} last year. That means the level comes from old problem loans aging on the books (and banks writing them off slowly) — not from today's borrowers getting into trouble. For judging Nu — whose book is ~${f((100 * nuC) / nuBook, 0)}% cards — the tap matters more than the level.`,
    sources: [SHEETS.bcb],
    formula: `compare today's rank-in-history for headline NPL vs early NPL; change vs a year ago; seasonal check = this ${season} move vs the average ${season} move`,
    steps,
    caveats: [
      `${isMonthly(curE.period) ? "Monthly" : "Single"} readings are noisy — the year-on-year comparison is the signal, not the latest ${unit}'s move.`,
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
// D. Personal-loan cycle — is it peaking? Measured, not assumed
// ---------------------------------------------------------------------------
function insightPersonalCycle(): Insight {
  const NAME = "Personal loans";
  const periods = systemNpl.periods;
  const h = ser(systemNpl, NAME);
  const e = alignTo(systemEarlyNpl, NAME, periods);
  const curH = last(systemNpl, NAME);
  const curE = last(systemEarlyNpl, NAME);
  const low = trough(systemNpl, NAME);
  const isRecord = curH.value >= maxOf(h) - 1e-9;
  const unit = stepName(systemNpl);
  const dp = isMonthly(curE.period) ? 2 : 1;
  const yoyE = curE.value - yearAgo(systemEarlyNpl, NAME).value;
  const hi = yearHigh(systemEarlyNpl, NAME);
  const rises = runAtEnd(systemEarlyNpl, NAME, "up");
  const falls = runAtEnd(systemEarlyNpl, NAME, "down");
  // Where the live gauge is in its own cycle:
  //  rising  - at (or within 0.1pp of) its trailing-year high
  //  easing  - has come off that high but is still above a year ago
  //  turned  - already at or below a year ago
  const state: "rising" | "easing" | "turned" =
    yoyE <= 0 ? "turned" : curE.value < hi.value - 0.1 && falls >= 1 ? "easing" : "rising";

  // Lead-lag, tested up to a year ahead at the data's own frequency. The
  // quarterly workbook found the two moved together; monthly data is finer
  // grained, so the answer is computed rather than carried over.
  const maxK = perYear(systemNpl);
  const corr = Array.from({ length: maxK + 1 }, (_, k) => ({ k, ...lagCorr(e, h, k) }));
  const r0 = corr[0];
  const best = corr.reduce((a, b) => (b.r > a.r ? b : a));
  const stride = Math.max(1, Math.round(maxK / 4));
  const shown = corr.filter((c) => c.k % stride === 0 || c.k === best.k);
  const leadText =
    best.k === 0
      ? `tightest with NO shift — they move together in the same ${unit}`
      : `tightest ${nSteps(systemNpl, best.k)} ahead — the gauge leads, ${best.r - r0.r >= 0.05 ? "clearly" : "but only modestly"} (${f(best.r, 2)} vs ${f(r0.r, 2)} with no shift)`;
  const leadSentence =
    best.k === 0
      ? `In this data the two move together in the same ${unit}, so the gauge reads the cycle rather than forecasting it.`
      : `In this data the gauge runs about ${nSteps(systemNpl, best.k)} ahead of the headline, so the headline can keep climbing for a while after the gauge turns.`;

  const recent = ser(systemEarlyNpl, NAME).filter((v): v is number => v !== null).slice(-6);
  const gaugeResult = {
    rising: `${f(curE.value, dp)}% — still climbing (${rises} rise${rises === 1 ? "" : "s"} in a row)`,
    easing: `${f(curE.value, dp)}% — off its ${hi.period} high of ${f(hi.value, dp)}% for ${nSteps(systemEarlyNpl, falls)}, still ${signed(yoyE)}pp on a year ago`,
    turned: `${f(curE.value, dp)}% — ${signed(yoyE)}pp vs a year ago: the gauge has turned`,
  }[state];
  const together = {
    rising: { math: "live gauge still rising + it moves with or ahead of the headline", result: "no sign the default cycle has peaked" },
    easing: { math: `live gauge off its high for ${nSteps(systemEarlyNpl, falls)} + still above a year ago`, result: "the first hint of a turn — not yet a confirmed peak" },
    turned: { math: "live gauge below a year ago", result: "the gauge has peaked; the headline should follow" },
  }[state];
  const title = {
    rising: "Personal-loan defaults are still climbing — no peak in sight",
    easing: `Personal-loan defaults hit ${isRecord ? "a record" : "a cycle high"} — the early-warning gauge has only just started to ease`,
    turned: "Personal-loan defaults are near the top — the early-warning gauge has already turned",
  }[state];
  const gaugeLine = {
    rising: `the live gauge (loans just starting to miss payments) is ${signed(yoyE)}pp on a year ago and has risen ${nSteps(systemEarlyNpl, rises)} running. The data gives no reason to call the top yet.`,
    easing: `the live gauge (loans just starting to miss payments) has eased for ${nSteps(systemEarlyNpl, falls)}, from ${f(hi.value)}% in ${hi.period} to ${f(curE.value)}% — but is still ${signed(yoyE)}pp above a year ago. ${leadSentence}`,
    turned: `the live gauge is already ${signed(yoyE)}pp below a year ago. ${leadSentence}`,
  }[state];

  const steps: CalcStep[] = [
    { label: "Personal-loan defaults, from their low point to now", math: `${f(low.value)}% (${low.period}) → ${f(curH.value)}% (${curH.period})`, result: `${signed(curH.value - low.value)}pp worse in ${nSteps(systemNpl, periods.indexOf(curH.period) - periods.indexOf(low.period))}${isRecord ? ` — the highest since ${periods[0]}` : ""}`, source: `${SHEETS.bcb} · NPL · Unsecured personal loans` },
    { label: "The live gauge: loans just starting to miss payments", math: `last readings: ${recent.map((v) => f(v, dp)).join(" → ")}`, result: gaugeResult, source: `${SHEETS.bcb} · Early NPL · Unsecured personal loans` },
    { label: "Test: does the live gauge PREDICT the headline, or move WITH it?", math: `how tightly they move together (0–1 scale), shifting the gauge ${shown.map((c) => c.k).join(", ")} ${unit}s ahead: ${shown.map((c) => f(c.r, 2)).join(", ")} (${r0.n} ${unit}s)`, result: leadText },
    { label: "Put the two together", ...together },
  ];

  return {
    id: "personal-cycle-not-peaked",
    kind: "risk",
    confidence: "Medium",
    title,
    takeaway: `Defaults on personal loans are up ${signed(curH.value - low.value)}pp since ${low.period}, to ${isRecord ? "a record " : ""}${f(curH.value)}% — and ${gaugeLine}`,
    stat: {
      value: `${f(curH.value)}%`,
      label: {
        rising: "of personal loans gone bad — and the early-warning gauge is still rising",
        easing: `of personal loans gone bad — the early-warning gauge has eased for ${nSteps(systemEarlyNpl, falls)}`,
        turned: "of personal loans gone bad — but the early-warning gauge has already turned",
      }[state],
    },
    detail: `This matters because personal loans are where Nu is growing fastest (see the unsecured-growth insight). We also tested the common belief that early defaults predict headline defaults: ${best.k === 0 ? `in this data they don't — the two move together in the same ${unit} (correlation ${f(r0.r, 2)})` : `on this data they do, by about ${nSteps(systemNpl, best.k)} — though the link is ${best.r - r0.r >= 0.05 ? "only moderate" : "only slightly tighter than reading them side by side"} (correlation ${f(best.r, 2)} vs ${f(r0.r, 2)})`}. ${state === "rising" ? "So the message is simple: the live gauge hasn't turned down, which means the default cycle most likely hasn't peaked." : state === "easing" ? `So: the gauge is the first thing to turn, and it may be turning — but ${nSteps(systemEarlyNpl, falls)} of easing is a hint, not a trend.` : "The gauge has turned; history says the headline follows."}`,
    sources: [SHEETS.bcb],
    formula: `correlation between early defaults(${unit} t) and headline defaults(${unit} t+k), tested at k = 0…${maxK}`,
    steps,
    caveats: [
      `The link is moderate (correlation ≈ ${f(best.r, 2)} over ${best.n} ${unit}s) — good for reading the cycle's direction, not for precise forecasts.`,
      ...(state === "easing" ? [`${isMonthly(curE.period) ? "Monthly" : "Single"} readings are noisy; it takes a few more ${unit}s of easing before a turn is a trend.`] : []),
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
  const privPay = last(payrollNpl, "Private-sector payroll");
  const it = mixNpl("Itaú");
  const br = mixNpl("Bradesco");
  const sa = mixNpl("Santander");
  const gap = nu.w - it.w;

  const steps: CalcStep[] = [
    { label: `What Nu's loan book is made of (${nu.booksAt}, R$ mn)`, math: `cards ${mn(nu.c)} (${f((100 * nu.c) / nu.tot, 0)}%) · personal ${mn(nu.u)} (${f((100 * nu.u) / nu.tot, 0)}%) · payroll ${mn(nu.p)} (${f((100 * nu.p) / nu.tot, 0)}%)`, result: `${f((100 * (nu.c + nu.u)) / nu.tot, 0)}% of the book has no collateral behind it`, source: `${SHEETS.loans} · Nu rows, ${nu.booksAt}` },
    { label: `Brazil-wide default rate of each product (${nu.nplAt})`, math: `cards ${f(nu.nplC)}% · personal ${f(nu.nplU)}% · payroll ${f(nu.nplP)}%`, result: "the 'risk price' of each product, same for every bank", source: `${SHEETS.bcb} · NPL` },
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
    sources: [SHEETS.loans, SHEETS.bcb],
    formula: "menu default rate (bank) = sum over products of [bank's balance in product × Brazil default rate of product] ÷ bank's total balance",
    steps,
    caveats: [
      "Uses Brazil-wide default rates for every bank on purpose — that's what isolates the menu from the skill.",
      "Covers the three products in the sheet; the big banks also hold mortgages and vehicle loans (usually safer), so their real full-book advantage is bigger than shown, not smaller.",
      `Books are ${nu.booksAt}, default rates are ${nu.nplAt} — IF.data balances publish on a longer lag than the NPL series.`,
      `Payroll is priced at the all-payroll rate (${f(nu.nplP)}%), but private-sector payroll alone runs ${f(privPay.value)}% (${privPay.period}). The workbooks don't split Nu's payroll book by borrower, so if it leans private-sector, Nu's built-in risk is understated here.`,
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
    { label: "What was happening to defaults meanwhile", math: `personal-loan defaults ${f(low.value)}% (${low.period}) → ${f(nplNow.value)}% (${nplNow.period})`, result: `${signed(nplNow.value - low.value)}pp worse while Nu accelerated`, source: `${SHEETS.bcb} · NPL · Unsecured personal loans` },
  ];

  return {
    id: "unsecured-capture",
    kind: "risk",
    confidence: "High",
    title: `One bank, ${capture > 50 ? "most" : capture >= 40 ? "nearly half" : capture >= 28 ? "a third" : "a fifth"} of the growth: Nu took ${f(capture, 0)}% of all new unsecured lending`,
    takeaway: `Of every new real of unsecured (no-collateral) lending Brazil added in the year to ${P1}, ${f(capture, 0)} cents came from Nu — ${f(ratio, 1)}× more than its ${f(share, 0)}% market share would suggest. And it happened while that product's default rate climbed from ${f(low.value)}% to ${f(nplNow.value)}%.`,
    stat: { value: `${f(capture, 0)}%`, label: `of Brazil's entire unsecured-lending growth came from Nu — a bank with a ${f(share)}% share` },
    detail: `Taking growth at ${f(ratio, 1)}× your market share is what winning a market looks like. Doing it while defaults in that exact product rise fastest is what buying risk at the top can look like. Both can be true at once — it depends entirely on how Nu's 2025 borrowers repay. The size of the bet is the insight: ${f(capture, 0)}% of the market's new lending in that window landed on Nu's book.`,
    sources: [SHEETS.loans, SHEETS.bcb],
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
  const pMax = maxOf(ser(systemNpl, "Payroll loans"));
  const cNpl = last(systemNpl, "Credit card loans").value;
  const mixCut = cNpl - pNpl;
  // "Payroll" is three products with very different risk; the safety claim
  // only holds for the segments where the paymaster is the state.
  const seg = panel(payrollNpl, "Private-sector payroll", ["Private-sector payroll", "Public-sector payroll", "INSS payroll"]);
  const priv = seg.of("Private-sector payroll"), pub = seg.of("Public-sector payroll"), inss = seg.of("INSS payroll");
  const privAboveCards = priv > cNpl;

  const steps: CalcStep[] = [
    { label: `Nu's payroll-loan book over the year to ${nuNow.period}`, math: `${mn(nuYAgo.value)} (${nuYAgo.period}) → ${mn(nuNow.value)} (${nuNow.period}), R$ mn`, result: `${signed(yoy, 0)}% in a year — Nu's fastest-growing product (${signed(qoq, 0)}% in the last quarter alone)`, source: `${SHEETS.loans} · Nu rows` },
    { label: "Meanwhile, the big bank on the other side", math: `Santander's payroll book: peak ${mn(peak)} (${peakPeriod}) → ${mn(santNow)} now`, result: `${f(santDraw)}% below its peak — retreating`, source: `${SHEETS.loans} · Santander` },
    { label: "The product's condition right now", math: `payroll defaults ${f(pNpl)}% vs their all-time high of ${f(pMax)}%`, result: pNpl === pMax ? "Nu is entering at the product's WORST defaults on record" : "near the record", source: `${SHEETS.bcb} · NPL · Payroll loans` },
    { label: "…and yet payroll is still the safest product around", math: `card defaults ${f(cNpl)}% ÷ payroll defaults ${f(pNpl)}%`, result: `${f(cNpl / pNpl, 1)}× safer than credit cards — on average` },
    { label: "…but 'payroll' is three products", math: `private-sector workers ${f(priv)}% · public employees ${f(pub)}% · INSS retirees ${f(inss)}%`, result: privAboveCards ? "private-sector payroll now defaults MORE than credit cards — the safety depends on whose salary it is" : `private-sector runs ${f(priv / inss, 1)}× INSS — the safety depends on whose salary it is`, source: `${SHEETS.bcb} · NPL · payroll segments · ${seg.period}` },
    { label: "What this does to Nu's overall risk", math: `${f(cNpl)} − ${f(pNpl)} = ${f(mixCut)}pp safety gap between the products`, result: `every 1% of the book moved cards → payroll trims ~${f(mixCut, 1)}bp of built-in risk` },
  ];

  return {
    id: "payroll-contrarian-entry",
    kind: "opportunity",
    confidence: "Medium",
    title: `Nu is sprinting into payroll loans just as the big banks walk out`,
    takeaway: `Nu's payroll-loan book (loans repaid straight out of salaries) grew ${signed(yoy, 0)}% in the year to ${nuNow.period}, while Santander's sits ${f(santDraw)}% below its peak. On the all-payroll average it's Nu's safest product — ${privAboveCards ? `but private-sector payroll now defaults at ${f(priv)}%, above credit cards, so which borrowers Nu lends to decides whether this waters risk down or adds to it.` : "and growing it directly waters down the riskiness of Nu's overall loan menu."}`,
    stat: { value: `${signed(yoy, 0)}%`, label: `growth in Nu's payroll loans in the year to ${nuNow.period} — from a ${f(at(payrollShare, "Nu", nuYAgo.period), 2)}% share to ${f(last(payrollShare, "Nu").value, 2)}%` },
    detail: `Payroll loans get deducted from paychecks before the borrower can spend the money, which is why they run ${f(cNpl / pNpl, 1)}× fewer defaults than credit cards — even now, at ${pNpl >= pMax - 1e-9 ? "the product's worst-ever" : "an elevated"} ${f(pNpl)}%. The timing is the story: Nu scales in exactly when a big incumbent retreats and the product's defaults ${pNpl >= pMax - 1e-9 ? "peak" : "run high"} — a classic contrarian entry. And it connects to the 'loan menu' insight: every 1% of Nu's book that shifts from cards to payroll trims about ${f(mixCut, 1)}bp of built-in risk.`,
    sources: [SHEETS.loans, SHEETS.bcb],
    formula: `year growth = Nu(${nuNow.period}) ÷ Nu(${nuYAgo.period}) − 1;  Santander pullback = now ÷ peak − 1;  risk effect = card defaults − payroll defaults, per 1% of book shifted`,
    steps,
    caveats: [
      `Small-base warning: ${signed(yoy, 0)}% growth is easy off a tiny base — Nu's payroll share is still only ${f(last(payrollShare, "Nu").value, 2)}% of the market.`,
      "IF.data restates recent payroll balances between publications — this workbook revised one recent quarter down by roughly 40% — so read the trend, not any single quarter.",
      "Payroll loans earn thin, rate-capped margins — they lower risk but also lower yield.",
      "Record payroll defaults could mean the product itself is deteriorating (rate caps squeezing weaker borrowers), not just a passing cycle.",
      `The workbooks don't split Nu's payroll book by borrower. The 'safest product' reading holds for public-sector (${f(pub)}%) and INSS (${f(inss)}%) payroll; at ${f(priv)}%, private-sector payroll is not a safe product today.`,
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
// K. Private-sector payroll — the "safe" product's riskiest corner
// ---------------------------------------------------------------------------
// Newly answerable: the BCB workbook splits payroll NPL by who the borrower is.
function insightPrivatePayroll(): Insight {
  const P = "Private-sector payroll";
  const now = last(payrollNpl, P);
  const ago = yearAgo(payrollNpl, P);
  // This card is about the surge; if the line stops rising, it skips.
  if (now.value <= ago.value) throw new Error(`private payroll NPL ${signed(now.value - ago.value)}pp YoY — no surge`);
  const low = trough(payrollNpl, P, perYear(payrollNpl)); // this year's low
  const span = payrollNpl.periods.indexOf(now.period) - payrollNpl.periods.indexOf(low.period);
  const multiple = now.value / low.value;
  const isRecord = now.value >= maxOf(ser(payrollNpl, P)) - 1e-9;
  const seg = panel(payrollNpl, P, ["Public-sector payroll", "INSS payroll", "Payroll loans"]);
  const pub = seg.of("Public-sector payroll"), inss = seg.of("INSS payroll"), all = seg.of("Payroll loans");
  const allAgo = yearAgo(payrollNpl, "Payroll loans");
  const card = at(systemNpl, "Credit card loans", now.period); // same month, same workbook
  const e = last(payrollEarlyNpl, P);
  const eAgo = yearAgo(payrollEarlyNpl, P);
  const eHi = yearHigh(payrollEarlyNpl, P);
  const eCresting = e.value < eHi.value - 0.25;
  const grew = multiple >= 2.05 ? "more than doubled" : multiple >= 1.95 ? "doubled" : `rose ${f(100 * (multiple - 1), 0)}%`;

  const steps: CalcStep[] = [
    { label: "Private-sector payroll defaults, from this year's low to now", math: `${f(low.value)}% (${low.period}) → ${f(now.value)}% (${now.period})`, result: `${f(multiple, 1)}× in ${nSteps(payrollNpl, span)}${isRecord ? ` — the worst since ${payrollNpl.periods[0]}` : ""}`, source: `${SHEETS.bcb} · NPL · Private payroll loans` },
    { label: "Against the riskiest unsecured product", math: `private-sector payroll ${f(now.value)}% vs credit cards ${f(card)}% (${now.period})`, result: now.value > card ? `${signed(now.value - card)}pp ABOVE credit cards` : `${signed(now.value - card)}pp below credit cards`, source: `${SHEETS.bcb} · NPL · Credit card loans` },
    { label: "Against the other two kinds of payroll", math: `public employees ${f(pub)}% · INSS retirees & pensioners ${f(inss)}%`, result: `${f(now.value / inss, 1)}× INSS, ${f(now.value / pub, 1)}× public-sector`, source: `${SHEETS.bcb} · NPL · payroll segments · ${seg.period}` },
    { label: "What the all-payroll average shows", math: `${f(allAgo.value)}% (${allAgo.period}) → ${f(all)}% (${seg.period})`, result: `${signed(all - allAgo.value)}pp — vs ${signed(now.value - ago.value)}pp for private-sector alone` },
    { label: "The pipeline: private-sector loans 15–90 days late", math: `${f(e.value, 2)}% (${e.period}) vs ${f(eAgo.value, 2)}% a year earlier${eCresting ? `; peaked at ${f(eHi.value, 2)}% in ${eHi.period}` : ""}`, result: `${f(e.value / eAgo.value, 1)}× last year's level — ${eCresting ? "off its peak, but still" : "still"} feeding the 90-day ratio`, source: `${SHEETS.bcb} · Early NPL · Private payroll loans` },
  ];

  return {
    id: "private-payroll-surge",
    kind: "risk",
    confidence: "High",
    title: `Private-sector payroll defaults ${grew} in ${nSteps(payrollNpl, span)} — to ${f(now.value)}%, ${now.value > card ? "above credit cards" : `${f(now.value / inss, 1)}× INSS payroll`}`,
    takeaway: `Payroll loans — repaid straight out of salaries — are the textbook safe product, and for public employees (${f(pub)}%) and INSS pensioners (${f(inss)}%) they still are. But private-sector payroll defaults went from ${f(low.value)}% in ${low.period} to ${f(now.value)}% in ${now.period}${now.value > card ? `, above credit cards (${f(card)}%)` : ""}. Its early-warning gauge is ${f(e.value / eAgo.value, 1)}× last year's level, so more is already in the pipeline.`,
    stat: { value: `${f(now.value)}%`, label: `of private-sector payroll loans 90+ days overdue (${now.period}) — vs ${f(card)}% for credit cards` },
    detail: `A payroll deduction is only as good as the payroll behind it. A public salary or an INSS pension keeps paying through a downturn; a private-sector deduction is only there while the borrower keeps the job. That is why the all-payroll average (${f(all)}%) is the wrong number for judging a payroll book: it blends a ${f(inss)}% INSS segment with a ${f(now.value)}% private one. For Nu this matters directly — payroll is its fastest-growing product (see the payroll insight), and whether that growth lowers or raises its risk depends on which of these three lines it is lending into.`,
    sources: [SHEETS.bcb],
    formula: `rise = private payroll NPL(${now.period}) ÷ its low over the past year;  compare with card NPL and the other payroll segments in the same ${stepName(payrollNpl)}`,
    steps,
    caveats: [
      "The workbooks don't split Nu's payroll book by borrower, so Nu's exposure to this line can't be measured here.",
      "A ratio moves with its denominator too: a fast-growing book holds it down while new loans are too young to be 90 days late, then it jumps as they age. Part of this rise may be that seasoning — the workbook has no balances to separate the two.",
    ],
    evidence: {
      title: "90-day NPL: private-sector payroll vs credit cards vs INSS payroll",
      type: "line",
      data: cd(payrollNpl.periods, [
        { name: P, values: ser(payrollNpl, P) },
        { name: "Credit card loans", values: alignTo(systemNpl, "Credit card loans", payrollNpl.periods) },
        { name: "INSS payroll", values: ser(payrollNpl, "INSS payroll") },
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
  const bankPanel = panel(peerNpl, "Nu", INC.map((i) => i.bank));
  const hhPanel = panel(householdNpl, "Nu", INC.map((i) => i.hh));
  const nuBank = last(peerNpl, "Nu");
  const nuHh = last(householdNpl, "Nu");
  const bank = INC.map((i) => ({ ...i, v: bankPanel.of(i.bank) }));
  const hh = INC.map((i) => ({ ...i, v: hhPanel.of(i.hh) }));
  const bankAvg = bankPanel.mean, hhAvg = hhPanel.mean;
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
// J. Price of risk — Nu's loss premium is a fraction of its price premium
// ---------------------------------------------------------------------------
// NOTE ON WHAT THIS DOES NOT CLAIM: the rate is the APR on newly issued
// non-payroll personal loans, while cost of risk is measured across each bank's
// WHOLE book. The two are both annual percentages, but of different portfolios,
// so they are reported side by side and deliberately never divided into a
// "cover ratio" — that number would describe an asset neither bank holds.
function insightPriceOfRisk(): Insight {
  const ratePanel = panel(personalLoanRate, "Nu", ["Itaú", "Bradesco", "Santander", "Caixa"]);
  const corPanel = panel(costOfRisk, "Nu", ["Itaú", "Santander Brasil", "Bradesco"]);
  const nuRate = last(personalLoanRate, "Nu");
  const itRate = { value: ratePanel.of("Itaú"), period: ratePanel.period };
  const others = ratePanel.rows.map((r) => ({ b: r.name, v: r.value }));
  const rateAvg = ratePanel.mean;
  const nuCor = last(costOfRisk, "Nu");
  const itCor = { value: corPanel.of("Itaú"), period: corPanel.period };
  const corOthers = corPanel.rows.map((r) => ({ b: r.name, v: r.value }));
  const corAvg = corPanel.mean;
  const priceGap = nuRate.value - itRate.value;
  const lossGap = nuCor.value - itCor.value;
  const first = { period: personalLoanRate.periods[0], nu: ser(personalLoanRate, "Nu")[0], it: ser(personalLoanRate, "Itaú")[0] };
  const widened = priceGap - ((first.nu ?? 0) - (first.it ?? 0));

  const steps: CalcStep[] = [
    { label: "What Nu charges for a personal loan", math: "BCB weekly rate, averaged over the quarter", result: `${f(nuRate.value)}% a.a.`, source: `${SHEETS.rates} · ${nuRate.period}` },
    { label: "What the big four charge for the same product", math: others.map((o) => `${o.b} ${f(o.v)}%`).join(" · "), result: `average ${f(rateAvg)}% a.a. → Nu prices ${signed(nuRate.value - rateAvg)}pp above them`, source: `${SHEETS.rates} · ${ratePanel.period}${ratePanel.missing.length ? ` (no ${ratePanel.missing.join(", ")} reading this quarter)` : ""}` },
    { label: "What Nu's credit losses cost it, per year", math: "cost of risk = annualised provisions ÷ loans", result: `${f(nuCor.value)}% a.a.`, source: `${SHEETS.aq} · Cost of risk · ${nuCor.period}` },
    { label: "…and what they cost the incumbents", math: corOthers.map((o) => `${o.b === "Santander Brasil" ? "Santander" : o.b} ${f(o.v)}%`).join(" · "), result: `average ${f(corAvg)}% a.a.`, source: `${SHEETS.aq} · Cost of risk · ${corPanel.period}${corPanel.missing.length ? ` (no ${corPanel.missing.join(", ")} reading this quarter)` : ""}` },
    { label: "The two premiums over Itaú, side by side", math: `price ${signed(priceGap)}pp a.a. on personal loans  ·  cost of risk ${signed(lossGap)}pp a.a. on the whole book`, result: `the price premium is the larger of the two, by ${f(priceGap - lossGap)}pp` },
    { label: "Why these are NOT divided into a cover ratio", math: "the rate is one product's APR on new lending; cost of risk spans every product each bank holds", result: "different portfolios — a ratio would describe an asset neither bank has" },
    { label: "Has the price premium always been there?", math: `${first.period}: Nu ${f(first.nu ?? 0)}% vs Itaú ${f(first.it ?? 0)}% → ${nuRate.period}: Nu ${f(nuRate.value)}% vs Itaú ${f(itRate.value)}%`, result: `${widened >= 0 ? "widened" : "narrowed"} from ${signed((first.nu ?? 0) - (first.it ?? 0))}pp to ${signed(priceGap)}pp` },
  ];

  return {
    id: "price-of-risk",
    kind: "opportunity",
    confidence: "Medium",
    title: `Nu prices personal loans ${signed(priceGap)}pp above Itaú, and carries ${signed(lossGap)}pp more cost of risk`,
    takeaway: `On the one product both report comparably, Nu charges ${f(nuRate.value)}% a.a. against Itaú's ${f(itRate.value)}%. Across their whole books, Nu's credit losses run ${f(nuCor.value)}% a year against Itaú's ${f(itCor.value)}%. The pricing premium is the bigger of the two numbers — the higher default rate is bought, not simply suffered.`,
    stat: { value: `${signed(priceGap)}pp`, label: `Nu's personal-loan pricing premium over Itaú (${nuRate.period}), against a ${signed(lossGap)}pp cost-of-risk premium` },
    detail: `Every "Nu's NPL is high" argument is incomplete without the other side of the trade. Nu prices its personal lending far above the incumbents and books far higher credit losses; both are visible here, and the pricing gap is the larger. What this cannot tell you is the margin: the rate is one product's APR on new lending while cost of risk covers each bank's entire book, so the two must be read side by side rather than netted. For the actual spread you would need Nu's realised asset yield, which this workbook does not carry. The structural risk is the same either way — what happens if Brazil caps rates, or if losses rise faster than Nu can reprice.`,
    sources: [SHEETS.rates, SHEETS.aq],
    formula: "price premium = Nu personal-loan rate − Itaú's;  loss premium = Nu cost of risk − Itaú's;  the two are reported separately, not divided",
    steps,
    caveats: [
      "The rate is the headline APR on new non-payroll personal loans; cost of risk is measured across each bank's whole book. They are the closest comparable pair the workbook offers — but they describe different portfolios, so neither their ratio nor their difference is a margin.",
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
  insightPrivatePayroll,
  insightInterMirror,
].map(safe).filter((x): x is Insight => x !== null);
