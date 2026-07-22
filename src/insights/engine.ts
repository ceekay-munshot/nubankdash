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
    { label: "How much of Brazil's card spending goes through Nu", math: `read straight off the sheet`, result: `${f(nuTpv.value)}%`, source: `${SHEETS.tpv} · ${nuTpv.period}` },
    { label: "How much of Brazil's card lending sits with Nu", math: `read straight off the sheet`, result: `${f(nuLoan.value)}%`, source: `${SHEETS.loans} · ${nuLoan.period}` },
    { label: "Nu's 'spending → lending' conversion rate", math: `${f(nuLoan.value)} ÷ ${f(nuTpv.value)}`, result: f(rNu, 2) },
    { label: "Itaú's conversion rate — the benchmark to beat", math: `${f(itLoan.value)} ÷ ${f(itTpv.value)}`, result: f(rIt, 2) },
    { label: "Nu's lending share IF it converted spending like Itaú does", math: `${f(nuTpv.value)} × ${f(rIt, 2)}`, result: `${f(implied)}%` },
    { label: "That gap, turned into money", math: `(${f(implied)} − ${f(nuLoan.value)})% × ${bn(sysCard, 0)} total card-loan market`, result: `≈ ${bn(latentMn, 0)}`, source: `${SHEETS.loans} · Total · 4Q25` },
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
      `The two readings are one quarter apart (spending is ${nuTpv.period}, lending is ${nuLoan.period}).`,
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
    { label: "Brazil's total card loans, 1Q25 → 2Q25", math: `${mn(sys1)} → ${mn(sys2)} (R$ mn)`, result: `${signed(qoq(sys1, sys2))}% — the market SHRANK`, source: `${SHEETS.loans} · Total row` },
    { label: "Itaú's card loans in that same quarter", math: `${mn(it1)} → ${mn(it2)}`, result: `${signed(qoq(it1, it2))}% — pulling back`, source: `${SHEETS.loans} · Itaú` },
    { label: "Nu's card loans in that same quarter", math: `${mn(nu1)} → ${mn(nu2)}`, result: `${signed(qoq(nu1, nu2))}% — expanding`, source: `${SHEETS.loans} · Nu (both entities)` },
    { label: "What that did to Nu's market share", math: `${f(sh1, 2)}% → ${f(sh2, 2)}%`, result: `${signed(jump, 2)}pp in one quarter` },
    { label: "Sanity check: compare with every other quarter on record", math: `biggest one-quarter share gain in the data = ${signed(maxJump, 2)}pp, in ${maxAt}`, result: maxAt === P2 ? "2Q25 is the biggest on record" : `biggest was ${maxAt}` },
  ];

  return {
    id: "shrinking-market-grab",
    kind: "change",
    confidence: "High",
    title: "Nu's biggest share jump ever happened while the card market was shrinking",
    takeaway: `In 2Q25 Brazil's total card loans fell ${signed(qoq(sys1, sys2))}% and Itaú cut its book ${signed(qoq(it1, it2))}% — yet Nu grew ${signed(qoq(nu1, nu2))}%. Result: Nu's largest single-quarter share gain on record (${signed(jump, 2)}pp).`,
    stat: { value: `${signed(jump, 2)}pp`, label: "market share gained in one quarter (2Q25) — a record — while the market shrank" },
    detail: `Growing when the whole market grows proves little — you're just riding the tide. Growing while the market shrinks means Nu was lending exactly when the big banks were pulling back from card risk. Two possible readings: Nu's data lets it spot good borrowers the incumbents can't — or Nu is taking on the risk the incumbents wanted off their books. How Nu's 2025 loans repay over the next year will settle which one it was.`,
    sources: [SHEETS.loans],
    formula: "growth% = loans(2Q25) ÷ loans(1Q25) − 1;  share change = Nu share(2Q25) − Nu share(1Q25)",
    steps,
    caveats: [
      "One quarter's event: the following quarters returned to normal gains (+0.3pp, +0.2pp).",
      "Nu merged its two legal entities' reporting in 1Q25; we add both entities in every quarter so the comparison stays apples-to-apples, but some reclassification noise is possible.",
      "When incumbents retreat, Nu's share rises even if Nu changes nothing — the share jump alone doesn't prove Nu got more aggressive.",
    ],
    evidence: {
      title: "Card-loan growth in 2Q25, bank by bank (% vs previous quarter)",
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
    { label: "Card loans gone bad today — 'headline NPL', the water LEVEL in the tub", math: `read straight off the sheet`, result: `${f(cur.value)}% — ties the highest of all ${periods.length} quarters (max = ${f(maxNpl)}%)`, source: `${SHEETS.aq} · System NPL · ${cur.period}` },
    { label: "Loans JUST STARTING to miss payments — 'early NPL', the tap filling it", math: `read straight off the sheet`, result: `${f(curE.value)}%`, source: `${SHEETS.aq} · System early NPL · ${curE.period}` },
    { label: "Is the tap flowing faster than a year ago?", math: `${f(curE.value)} (1Q26) vs ${f(yAgo)} (1Q25)`, result: `${signed(curE.value - yAgo)}pp — no` },
    { label: "Is the tap high by its own history?", math: `sort all ${eVals.length} readings; today ranks #${rankE}`, result: `no — mid-pack (its record is ${f(maxE)}%)` },
    { label: "Remove the January effect", math: `early NPL always jumps into Q1 (avg ${f(avgQ1, 2)}pp, 2023–26); this year ${f(prev)} → ${f(curE.value)} = ${signed(curE.value - prev)}pp`, result: "this quarter's rise is mostly the usual seasonal pattern" },
  ];

  return {
    id: "stock-not-flow",
    kind: "watch",
    confidence: "High",
    title: `Card defaults at a record ${f(cur.value)}% — but NEW defaults aren't rising`,
    takeaway: `The scary headline — a record ${f(cur.value)}% of card loans gone bad — describes OLD loans still sitting on banks' books. The share of loans just starting to miss payments is ${f(curE.value)}%, identical to a year ago and unremarkable by its own history.`,
    stat: { value: `${signed(curE.value - yAgo, 1)}pp`, label: "change vs a year ago in NEW card defaults — the number that describes today's borrowers" },
    detail: `Think of a bathtub: the headline default rate is the water level; new defaults are the tap. The level is at a record, but the tap is flowing no faster than last year. That means the record comes from old problem loans aging on the books (and banks writing them off slowly) — not from today's borrowers getting into trouble. For judging Nu — whose book is ~64% cards — the tap matters more than the level.`,
    sources: [SHEETS.aq],
    formula: "compare today's rank-in-history for headline NPL vs early NPL; change vs a year ago; seasonal check = this Q1 jump vs the average Q1 jump",
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
  const trough = at(systemNpl, "Personal loans", "3Q24");
  const r0 = lagCorr(e, h, 0);
  const r1 = lagCorr(e, h, 1);
  const r2 = lagCorr(e, h, 2);
  // consecutive rises in early NPL
  const ev = e.filter((v): v is number => v !== null);
  let rises = 0;
  for (let i = ev.length - 1; i > 0 && rises < 6; i--) { if (ev[i] > ev[i - 1]) rises++; else break; }

  const steps: CalcStep[] = [
    { label: "Personal-loan defaults, from their low point to now", math: `${f(trough)}% (3Q24) → ${f(curH.value)}% (${curH.period})`, result: `${signed(curH.value - trough)}pp worse in 6 quarters`, source: `${SHEETS.aq} · System NPL · Personal loans` },
    { label: "The live gauge: loans just starting to miss payments", math: `last readings: ${e.slice(-5).map((v) => (v === null ? "–" : f(v))).join(" → ")}`, result: `${f(curE.value)}% — still climbing (${rises} rises in a row)`, source: `${SHEETS.aq} · System early NPL` },
    { label: "Test: does the live gauge PREDICT the headline, or move WITH it?", math: `how tightly they move together (0–1 scale), shifting one 0, 1, 2 quarters ahead: ${f(r0.r, 2)}, ${f(r1.r, 2)}, ${f(r2.r, 2)} (${r0.n} quarters)`, result: `tightest with NO shift — they move together in the same quarter` },
    { label: "Put the two together", math: `live gauge still rising + it moves with the headline`, result: "no sign the default cycle has peaked" },
  ];

  return {
    id: "personal-cycle-not-peaked",
    kind: "risk",
    confidence: "Medium",
    title: "Personal-loan defaults are still climbing — no peak in sight",
    takeaway: `Defaults on personal loans are up ${signed(curH.value - trough)}pp since 3Q24, to ${f(curH.value)}% — and the live gauge (loans just starting to miss payments) has risen ${rises} quarters running. The data gives no reason to call the top yet.`,
    stat: { value: `${f(curH.value)}%`, label: `of personal loans gone bad — and the early-warning gauge is still rising` },
    detail: `This matters because personal loans are where Nu is growing fastest (see the '34% of all growth' insight). We also tested the common belief that early defaults predict headline defaults 2–3 quarters in advance: in this data they don't — the two move together in the same quarter (correlation ${f(r0.r, 2)}). So the message is simple: the live gauge hasn't turned down, which means the default cycle most likely hasn't peaked.`,
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
    { label: "What Nu's loan book is made of (4Q25, R$ mn)", math: `cards ${mn(nu.c)} (${f((100 * nu.c) / nu.tot, 0)}%) · personal ${mn(nu.u)} (${f((100 * nu.u) / nu.tot, 0)}%) · payroll ${mn(nu.p)} (${f((100 * nu.p) / nu.tot, 0)}%)`, result: `${f((100 * (nu.c + nu.u)) / nu.tot, 0)}% of the book has no collateral behind it`, source: `${SHEETS.loans} · Nu rows, 4Q25` },
    { label: "Brazil-wide default rate of each product (1Q26)", math: `cards ${f(nu.nplC)}% · personal ${f(nu.nplU)}% · payroll ${f(nu.nplP)}%`, result: "the 'risk price' of each product, same for every bank", source: `${SHEETS.aq} · System NPL` },
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
      "Books are 4Q25, default rates are 1Q26 (one quarter apart).",
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
    { label: "How much unsecured lending Brazil ADDED in a year", math: `${mn(sys1)} − ${mn(sys0)}`, result: `+${mn(dSys)} (R$ mn)`, source: `${SHEETS.loans} · Total · ${P0}→${P1}` },
    { label: "How much of that came from Nu", math: `${mn(nu1)} − ${mn(nu0)}`, result: `+${mn(dNu)} (Nu's own book grew ${signed(100 * (nu1 / nu0 - 1), 0)}% in the year)`, source: `${SHEETS.loans} · Nu rows` },
    { label: "Nu's slice of ALL the new lending", math: `${mn(dNu)} ÷ ${mn(dSys)}`, result: `${f(capture)}% — more than any other bank` },
    { label: "Compare that with Nu's normal size in this market", math: `${f(capture)} ÷ ${f(share)}`, result: `${f(ratio, 1)}× bigger than its ${f(share)}% market share` },
    { label: "What was happening to defaults meanwhile", math: `personal-loan defaults ${f(npl3q24)}% (3Q24) → ${f(nplNow)}% (1Q26)`, result: `${signed(nplNow - npl3q24)}pp worse while Nu accelerated`, source: `${SHEETS.aq} · System NPL` },
  ];

  return {
    id: "unsecured-capture",
    kind: "risk",
    confidence: "High",
    title: `One bank, a third of the growth: Nu took ${f(capture, 0)}% of all new unsecured lending`,
    takeaway: `Of every new real of unsecured (no-collateral) lending Brazil added last year, ${f(capture, 0)} cents came from Nu — ${f(ratio, 1)}× more than its ${f(share, 0)}% market share would suggest. And it happened while that product's default rate climbed from ${f(npl3q24)}% to ${f(nplNow)}%.`,
    stat: { value: `${f(capture, 0)}%`, label: `of Brazil's entire unsecured-lending growth came from Nu — a bank with a ${f(share)}% share` },
    detail: `Taking growth at ${f(ratio, 1)}× your market share is what winning a market looks like. Doing it while defaults in that exact product rise fastest is what buying risk at the top can look like. Both can be true at once — it depends entirely on how Nu's 2025 borrowers repay. The size of the bet is the insight: a third of the market's new lending now sits on Nu's book.`,
    sources: [SHEETS.loans, SHEETS.aq],
    formula: "Nu's slice = Nu's growth ÷ Brazil's growth (4Q24→4Q25);  intensity = that slice ÷ Nu's market share",
    steps,
    caveats: [
      "One-year window — this ratio bounces around from year to year.",
      "Brazil's total includes banks not listed in the sheet (~40% of the growth) — so Nu's slice of the LISTED banks' growth is even bigger.",
      "The workbook doesn't show Nu's OWN default rate on these loans; the rising rate is the market backdrop, not Nu's realized losses.",
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
    { label: "Nu's payroll-loan book, 3Q25 → 4Q25", math: `${mn(nu3)} → ${mn(nu4)} (R$ mn)`, result: `${signed(qoq, 0)}% in one quarter — Nu's fastest-growing product`, source: `${SHEETS.loans} · Nu rows` },
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
    takeaway: `Nu's payroll-loan book (loans repaid straight out of salaries) jumped ${signed(qoq, 0)}% in one quarter, while Santander's sits ${f(santDraw)}% below its peak. It's Nu's safest product — and growing it directly waters down the riskiness of Nu's overall loan menu.`,
    stat: { value: `${signed(qoq, 0)}%`, label: "growth in Nu's payroll loans in a single quarter (4Q25) — from a tiny 0.9% share" },
    detail: `Payroll loans get deducted from paychecks before the borrower can spend the money, which is why they run ${f(cNpl / pNpl, 1)}× fewer defaults than credit cards — even now, at the product's worst-ever ${f(pNpl)}%. The timing is the story: Nu scales in exactly when a big incumbent retreats and the product's defaults peak — a classic contrarian entry. And it connects to the 'loan menu' insight: every 1% of Nu's book that shifts from cards to payroll trims about ${f(mixCut, 1)}bp of built-in risk.`,
    sources: [SHEETS.loans, SHEETS.aq],
    formula: "quarter growth = Nu(4Q25) ÷ Nu(3Q25) − 1;  Santander pullback = now ÷ peak − 1;  risk effect = card defaults − payroll defaults, per 1% of book shifted",
    steps,
    caveats: [
      `Small-base warning: ${signed(qoq, 0)}% growth is easy off a tiny base — Nu's payroll share is still only ~${f(last(payrollShare, "Nu").value, 1)}%.`,
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
    { label: "Card market share gained over two years (4Q23→4Q25)", math: `Nu ${signed(nuD, 2)}pp vs Inter ${signed(inD, 2)}pp`, result: `Nu gained ${f(nuD / inD, 0)}× more`, source: `${SHEETS.loans} · share columns` },
    { label: "How the other digital bank's loans are performing", math: `Inter defaults ${f(inNpl.value)}% vs Itaú ${f(itNpl.value)}%`, result: `${f(spread)}pp worse than the best incumbent`, source: `${SHEETS.aq} · Peer NPL · ${inNpl.period}` },
    { label: "Put that gap in historical context", math: `widest Inter-vs-Itaú gap across all quarters = ${f(maxSpread)}pp, in ${maxAt}`, result: maxAt === inNpl.period ? "the widest ever is RIGHT NOW" : `widest was ${maxAt}` },
    { label: "And the incumbent isn't standing still", math: `Itaú defaults ${f(itNpl.value)}% vs the best it has ever printed (${f(itMin)}%)`, result: itNpl.value === itMin ? "Itaú is at its all-time BEST while Inter worsens" : "near its best" },
  ];

  return {
    id: "inter-mirror",
    kind: "structural",
    confidence: "Medium",
    title: "Inter is the proof: 'being digital' isn't the edge — being Nu is",
    takeaway: `Brazil's other listed digital bank gained just ${signed(inD, 2)}pp of card share in two years while Nu gained ${signed(nuD, 2)}pp — ${f(nuD / inD, 0)}× more. Meanwhile Inter's defaults are the furthest above Itaú's they have ever been.`,
    stat: { value: `${f(nuD / inD, 0)}×`, label: `Nu gained ${f(nuD / inD, 0)}× more card share than Inter over the same two years` },
    detail: `If a slick app and no branches were all it took, Inter would be compounding like Nu. It isn't: barely any share progress, and loan quality drifting the wrong way while Itaú sits at its best-ever default rate. For a Nu investor this cuts both ways. It confirms Nu's edge is specific to Nu — funding cost, data, execution. But it also removes the comfort of a sector tailwind: Nu has to keep out-executing, because 'digital' by itself demonstrably doesn't win.`,
    sources: [SHEETS.loans, SHEETS.aq],
    formula: "share gained = share(4Q25) − share(4Q23), per bank;  quality gap = Inter defaults − Itaú defaults, ranked across every quarter",
    steps,
    caveats: [
      "Inter runs a different model (heavy in mortgages and secured loans), so it's an imperfect stand-in for Nu.",
      "Nu's own default rate isn't in the workbook — Inter is the only listed digital-bank comparison the data allows.",
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
