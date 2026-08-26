#!/usr/bin/env python3
"""Regenerate src/data/datasets.ts and src/data/absolutes.ts from the Nu Brazil workbook.

Usage:
    python3 scratchpad/parse.py path/to/Nu_Brazil.xlsx [--check]

Method (unchanged from the original generation, see README "Data"):
  * Nu is the SUM of its two Brazilian legal entities in every Loans section.
    The workbook keeps two rows per section ("Nu ." / "Nu " and "Nubank");
    which row carries the balance moved around in 1Q25, so we always add both.
  * Loan market share = entity balance / the sheet's own Total row (IF.data's
    independent system total, never a sum of the listed banks).
  * TPV share       = issuer card TPV / the sum of the 8 tracked issuers.
  * Asset-quality   = the published ratios, x100.
  * Interest rates  = BCB weekly "crédito pessoal não-consignado - pré-fixado"
    rates (% a.a.), averaged into calendar quarters.

De-spiking: source cells that are physically impossible for a loan STOCK are
nulled rather than plotted (see SPIKES below and the README). `--check` re-runs
the spike detector over the whole workbook and reports anything unlisted, so a
new bad cell in a refreshed workbook cannot slip through unnoticed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data"

# --- workbook geometry ------------------------------------------------------

# Loans sheet: (section key, header row, first data row, last data row incl. Total)
LOAN_SECTIONS = {
    "household": (5, 6, 16),
    "creditCard": (21, 22, 32),
    "unsecured": (37, 38, 48),
    "payroll": (53, 54, 64),
}
# Sheet label -> series name on the dashboard. Every other row is ignored.
BANK_LABELS = {
    "itaú": "Itaú",
    "bradesco": "Bradesco",
    "santader brasil": "Santander",
    "caixa": "Caixa",
    "bb": "BB",
    "inter": "Inter",
    "xp": "XP",
    "total": "System",
}
LOAN_ORDER = ["Nu", "Itaú", "Bradesco", "Santander", "Caixa", "BB", "Inter", "XP", "System"]
SHARE_ORDER = ["Nu", "Itaú", "Bradesco", "Santander", "Caixa", "BB", "Inter"]

# Documented de-spikes: (section, series, period) -> reason.
# These are source keystroke errors that survive in the 08.24.2026 workbook.
SPIKES = {
    ("creditCard", "Inter", "2018"): "source keyed 417,390 between 172 and 9,287",
    ("creditCard", "Inter", "2019"): "source cell duplicates Nu's 2019 balance (9,287.34)",
    ("creditCard", "Caixa", "2Q25"): "5,692 then 6,194, rebounding to 22,149 — a stock cannot round-trip",
    ("creditCard", "Caixa", "3Q25"): "see 2Q25",
    ("unsecured", "Itaú", "3Q23"): "source keyed 47,307 — an exact duplicate of BB's 3Q23 cell",
    ("unsecured", "BB", "2017"): "source keyed 24.3 for ~26,000",
}

# Asset quality sheet: block label -> (header row for periods, {series: row}).
# NB the period header on the System blocks is itself typo'd (3Q23 keyed as
# 4Q23), so every block reuses the canonical header in row 4.
AQ_PERIOD_ROW = 4
AQ_BLOCKS = {
    "peerNpl": [("Itaú", 6), ("Santander Brasil", 7), ("Bradesco", 5), ("Inter", 8), ("Nu", 9)],
    "systemNpl": [("Credit card loans", 33), ("Personal loans", 34), ("Payroll loans", 35), ("Household loans", 36)],
    "systemEarlyNpl": [("Credit card loans", 39), ("Personal loans", 40), ("Payroll loans", 41), ("Household loans", 42)],
    # Annualised credit-loss provisions / loans, i.e. what the risk actually
    # costs each bank per year - the only series here that is directly
    # comparable with an interest rate.
    "costOfRisk": [("Nu", 49), ("Itaú", 46), ("Santander Brasil", 47), ("Bradesco", 45), ("Inter", 48)],
}
# Household-segment sheet: its own period header, per block.
HH_BLOCKS = {
    # Inter's rows on this sheet are the bank-total ratio copied in, not a
    # household-segment ratio, so they are deliberately not carried over.
    "householdNpl": (10, [("Nu", 11), ("Itaú", 13), ("Bradesco", 12), ("Santander", 14)]),
    "householdEarlyNpl": (4, [("Nu", 5), ("Itaú", 7), ("Bradesco", 6), ("Santander", 8)]),
}

TPV_SHEET = "TPV_Market share "
TPV_PERIOD_ROW = 4
TPV_ROWS = [("Nu", 11), ("Itaú", 7), ("BB", 5), ("Bradesco", 6), ("Santander", 8), ("Caixa", 9), ("Inter", 10), ("XP", 12)]

RATE_SHEET = "Personal Loans - Interest rates"
RATE_PERIOD_ROW = 125
RATE_ROWS = [("Nu", 130), ("Itaú", 127), ("Bradesco", 126), ("Santander", 128), ("Caixa", 129)]


# --- helpers ----------------------------------------------------------------

def num(v):
    """Workbook cell -> float or None. '-' and stray text are holes, not zeros."""
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def r2(v):
    return None if v is None else round(v, 2)


def r1(v):
    return None if v is None else round(v, 1)


def periods_from(ws, row, first_col=3):
    """Read a period header row -> (labels, column indices)."""
    labels, cols = [], []
    for c in range(first_col, ws.max_column + 1):
        v = ws.cell(row, c).value
        if v is None:
            continue
        labels.append(str(v).strip())
        cols.append(c)
    return labels, cols


def fill_interior_zeros(values):
    """A loan STOCK that reads 0 between two non-zero balances is a data hole.

    Only an isolated zero counts: its IMMEDIATE neighbours must both be present
    and non-zero. A run of zeros is the bank genuinely not being in the product
    yet (or having exited), which is real data and stays plotted at zero.
    """
    out = list(values)
    for i, v in enumerate(out):
        if v != 0 or i == 0 or i == len(out) - 1:
            continue
        prev, nxt = out[i - 1], out[i + 1]
        if prev not in (None, 0) and nxt not in (None, 0):
            out[i] = None
    return out


def detect_spikes(section, name, periods, values, floor=100.0):
    """Flag balances that cannot belong to a loan STOCK.

    A keystroke error is an EXCURSION: the value sits far off on the same side
    of both the reading before it and the reading after it. Steady growth never
    does that (it is above the past and below the future), so a fast-ramping
    young book is not flagged. Neighbours are the nearest non-null, non-zero
    readings, and periods smaller than `floor` R$ mn either side are ignored -
    sub-R$100mn wobbles cannot distort a share of a R$700bn market.
    """
    found = []
    idx = [i for i, v in enumerate(values) if v not in (None, 0)]
    for pos, i in enumerate(idx):
        if pos == 0 or pos == len(idx) - 1:
            continue
        prev, cur, nxt = values[idx[pos - 1]], values[i], values[idx[pos + 1]]
        if max(prev, nxt) < floor:
            continue
        up, down = cur / prev, cur / nxt
        if (up > 1.6 and down > 1.6) or (up < 0.62 and down < 0.62):
            found.append((section, name, periods[i], prev, cur, nxt))
    return found


# --- extraction -------------------------------------------------------------

def read_loans(wb, report):
    ws = wb["Loans"]
    out = {}
    for section, (hdr, first, last) in LOAN_SECTIONS.items():
        labels, cols = periods_from(ws, hdr)
        # Only the left-hand (absolute balance) block; the sheet repeats the
        # section as pre-computed shares from column Y onward.
        keep = [(l, c) for l, c in zip(labels, cols) if c <= 23]
        labels = [l for l, _ in keep]
        cols = [c for _, c in keep]

        rows: dict[str, list] = {}
        nu = [None] * len(cols)
        for r in range(first, last + 1):
            raw = ws.cell(r, 2).value
            if raw is None:
                continue
            label = str(raw).strip().rstrip(".").strip()
            vals = [num(ws.cell(r, c).value) for c in cols]
            if label.lower().startswith("nu"):
                for i, v in enumerate(vals):
                    if v is not None:
                        nu[i] = (nu[i] or 0) + v
                continue
            name = BANK_LABELS.get(label.lower())
            if name:
                rows[name] = vals
        rows["Nu"] = nu

        for name in list(rows):
            rows[name] = fill_interior_zeros(rows[name])
            for i, p in enumerate(labels):
                if (section, name, p) in SPIKES:
                    rows[name][i] = None
            # Detector runs on the CORRECTED series: its contract is that no
            # implausible stock survives into the dashboard.
            report.extend(detect_spikes(section, name, labels, rows[name]))

        out[section] = {"periods": labels, "rows": rows}
    return out


def loan_shares(section):
    """balance / the sheet's own Total row, in %."""
    total = section["rows"]["System"]
    shares = {}
    for name in SHARE_ORDER:
        vals = section["rows"][name]
        shares[name] = [
            r2(100 * v / t) if v is not None and t not in (None, 0) else None
            for v, t in zip(vals, total)
        ]
    return {"periods": section["periods"], "rows": shares}


def read_tpv(wb):
    ws = wb[TPV_SHEET]
    labels, cols = periods_from(ws, TPV_PERIOD_ROW)
    raw = {name: [num(ws.cell(r, c).value) for c in cols] for name, r in TPV_ROWS}

    def reported(name, i):
        """Has this issuer ever reported before period i? (0 = pre-launch, not a hole.)"""
        return any(v not in (None, 0) for v in raw[name][:i])

    # A tracked issuer that reported before but has no value now is a HOLE in
    # the workbook. It matters twice over: the issuer's own share is unknown,
    # and - because the denominator is the sum of the tracked issuers - every
    # other issuer's share would be silently inflated by the missing volume.
    #
    # So: the issuer's own point stays null (we never plot a number we do not
    # have), while the DENOMINATOR is repaired by linear interpolation between
    # the readings either side. That keeps the seven issuers who did report on
    # their true shares instead of pushing all eight off by ~10%. A hole with
    # no later reading to interpolate from cannot be repaired, and voids the
    # whole period.
    holes, voided, hole_at = [], set(), set()
    filled = {name: list(vals) for name, vals in raw.items()}
    for name, _ in TPV_ROWS:
        for i, p in enumerate(labels):
            if raw[name][i] not in (None, 0) or not reported(name, i):
                continue
            holes.append((p, name))
            hole_at.add((p, name))
            prev = next((j for j in range(i - 1, -1, -1) if raw[name][j] not in (None, 0)), None)
            nxt = next((j for j in range(i + 1, len(labels)) if raw[name][j] not in (None, 0)), None)
            if prev is None or nxt is None:
                voided.add(p)
                continue
            span = nxt - prev
            filled[name][i] = raw[name][prev] + (raw[name][nxt] - raw[name][prev]) * (i - prev) / span

    shares = {name: [] for name, _ in TPV_ROWS}
    for i, p in enumerate(labels):
        total = sum(v for v in (filled[n][i] for n, _ in TPV_ROWS) if v is not None)
        for name, _ in TPV_ROWS:
            v = raw[name][i]  # never the interpolated value - only the reported one is plotted
            missing = p in voided or (p, name) in hole_at or v is None or not total
            shares[name].append(None if missing else r2(100 * v / total))

    # Drop trailing periods that carry no share at all (a quarter the workbook
    # has only partially filled in).
    while labels and all(shares[n][-1] is None for n, _ in TPV_ROWS):
        labels.pop()
        for n, _ in TPV_ROWS:
            shares[n].pop()

    return {"periods": labels, "rows": shares}, holes


def read_asset_quality(wb):
    ws = wb["Asset quality "]
    labels, cols = periods_from(ws, AQ_PERIOD_ROW)
    out = {}
    for key, rows in AQ_BLOCKS.items():
        out[key] = {
            "periods": labels,
            "rows": {name: [r1(v * 100) if (v := num(ws.cell(r, c).value)) is not None else None for c in cols]
                     for name, r in rows},
        }
    return out


def read_household(wb):
    ws = wb["Asset Quality (household)"]
    out = {}
    for key, (hdr, rows) in HH_BLOCKS.items():
        labels, cols = periods_from(ws, hdr)
        out[key] = {
            "periods": labels,
            "rows": {name: [r1(v * 100) if (v := num(ws.cell(r, c).value)) is not None else None for c in cols]
                     for name, r in rows},
        }
    return out


def read_rates(wb):
    """Weekly BCB rates (% a.a., as a fraction) -> quarterly averages in %."""
    ws = wb[RATE_SHEET]
    dates, cols = [], []
    for c in range(9, ws.max_column + 1):
        v = ws.cell(RATE_PERIOD_ROW, c).value
        if v is None:
            continue
        dates.append(v)
        cols.append(c)

    quarters: list[str] = []
    buckets: dict[str, list[int]] = {}
    for i, d in enumerate(dates):
        q = f"{(d.month - 1) // 3 + 1}Q{d.year % 100:02d}"
        if q not in buckets:
            buckets[q] = []
            quarters.append(q)
        buckets[q].append(i)

    # A quarter needs enough weekly readings for its mean to mean anything; the
    # workbook's first and last quarters are stubs (1 and 3 weeks).
    quarters = [q for q in quarters if len(buckets[q]) >= 6]

    rows = {}
    for name, r in RATE_ROWS:
        weekly = [num(ws.cell(r, c).value) for c in cols]
        rows[name] = []
        for q in quarters:
            vals = [weekly[i] for i in buckets[q] if weekly[i] is not None]
            rows[name].append(r1(100 * sum(vals) / len(vals)) if vals else None)
    return {"periods": quarters, "rows": rows}


# --- emit -------------------------------------------------------------------

def js(v):
    return "null" if v is None else json.dumps(v)


def chart(name, data, order, note=""):
    lines = [f"export const {name}: ChartData = {{"]
    lines.append("  periods: [" + ", ".join(json.dumps(p) for p in data["periods"]) + "],")
    lines.append("  series: [")
    for key in order:
        if key not in data["rows"]:
            continue
        vals = ", ".join(js(v) for v in data["rows"][key])
        lines.append(f'    {{ name: {json.dumps(key, ensure_ascii=True)}, values: [{vals}] }},')
    lines.append("  ],")
    lines.append("};")
    return (note + "\n" if note else "") + "\n".join(lines)


HEADER_DATASETS = '''// AUTO-GENERATED from the Nu Brazil workbook (08.24.2026).
// Source sheets: Loans, TPV_Market share, Asset quality, Asset Quality
// (household), Personal Loans - Interest rates. Do not edit by hand;
// regenerate with `python3 scratchpad/parse.py <workbook.xlsx>`.
//
// Market-share % are computed from absolute balances / values:
//  - Loan shares  = (Nu Pagamentos + Nu Financeira) / system total  (IF.data).
//  - TPV share    = bank card TPV (R$ bn) / sum of the 8 tracked issuers. Where
//    the workbook is missing one issuer's volume, that issuer's own share is
//    null and the denominator is repaired by interpolation, so the issuers that
//    DID report keep their true share (see scratchpad/parse.py).
//  - Asset-quality series are the published system / peer NPL ratios (%).
//  - Rates are the BCB weekly personal-loan (non-payroll, pre-fixed) rate,
//    % a.a., averaged over each calendar quarter.
// Nu is the sum of its two Brazilian legal entities across every loan section.
//
// De-spiked share cells (mirror the nulled balances in absolutes.ts, since
// share = balance / system total): unsecuredShare - Itau - 3Q23, and
// creditCardShare - Caixa - 2Q25 & 3Q25. See absolutes.ts for why.

export interface Series {
  /** Legend + entity name; drives the fixed entity->color map. */
  name: string;
  /** One value per period; null = no data reported for that period. */
  values: (number | null)[];
}

export interface ChartData {
  /** Ordered period labels, e.g. "2019", "1Q23". */
  periods: string[];
  series: Series[];
}

/** A tracked issuer the workbook is missing a card-TPV reading for. */
export interface TpvHole {
  period: string;
  issuer: string;
  /**
   * true  - the issuer's own share is null and the denominator was repaired by
   *         interpolation, so the issuers that DID report keep their true share.
   * false - no later reading to interpolate from, so the whole period is absent
   *         from `tpvShare` rather than published with a short denominator.
   */
  repaired: boolean;
}
'''

HEADER_ABSOLUTES = '''// AUTO-GENERATED from the Nu Brazil workbook (08.24.2026) - Loans sheet.
// Absolute loan balances in R$ mn (despiked like the share series). "Nu" is the
// sum of Nu's two Brazilian legal entities; "System" is the sheet's Total row
// (IF.data's independent system total, NOT a sum of the listed banks - so a
// single bank's cell error cannot distort System, Nu's share, or any insight).
// Used by the insight engine so every calculation is reproducible in-app.
// Regenerate with `python3 scratchpad/parse.py <workbook.xlsx>`.
//
// De-spike corrections (source cells that are physically impossible for a loan
// STOCK, so nulled per the README method):
//   - Unsecured - Itau - 3Q23      - source keyed 47,307, an exact duplicate of
//     BB's 3Q23 cell and a lone 2Q23->3Q23->4Q23 spike (22,399 -> 47,307 -> 24,465).
//   - Unsecured - BB - 2017        - source keyed 24.3 for ~26,000.
//   - Credit card - Caixa - 2Q25 & 3Q25 - source keyed 5,692 / 6,194, a -68% drop
//     that rebounds to 22,149 (a stock cannot round-trip like that).
//   - Credit card - Inter - 2018 & 2019 - source keyed 417,390, then a cell that
//     duplicates Nu's 2019 balance.
// None of these cells feed an insight; the fix only removes the visible chart spike.
import type { ChartData } from "./datasets";
'''


def tpv_holes_ts(holes, periods):
    """Emit the TPV holes as data so the provenance UI reports what really happened."""
    rows = ",\n".join(
        f'  {{ period: {json.dumps(p)}, issuer: {json.dumps(n, ensure_ascii=True)}, repaired: {"true" if p in periods else "false"} }}'
        for p, n in holes
    )
    return "export const tpvHoles: TpvHole[] = [\n" + rows + "\n];" if rows else "export const tpvHoles: TpvHole[] = [];"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    check = "--check" in sys.argv
    wb = openpyxl.load_workbook(args[0], data_only=True)

    report: list = []
    loans = read_loans(wb, report)
    tpv, holes = read_tpv(wb)
    aq = read_asset_quality(wb)
    hh = read_household(wb)
    rates = read_rates(wb)

    def report_survivors():
        print(f"implausible stocks surviving the documented fixes: {len(report)}")
        for r in report:
            print(f"  {r[0]:11s} {r[1]:10s} {r[2]:5s}  {r[3]:,.0f} -> {r[4]:,.0f} -> {r[5]:,.0f}")
        if report:
            print(
                "\nEach line is a balance the parser believes cannot belong to a loan stock.\n"
                "Add it to SPIKES (with the reason) if it is a source error, or widen\n"
                "detect_spikes if it is genuine. Refusing to write until then."
            )

    if check:
        print("documented de-spikes applied:")
        for (sec, nm, per), why in SPIKES.items():
            print(f"  {sec:11s} {nm:10s} {per:5s}  {why}")
        print()
        report_survivors()
        print(f"TPV holes (issuer nulled, denominator interpolated): {holes or 'none'}")
        return 1 if report else 0

    # Never serialise a value the parser already knows is implausible: it would
    # flow straight into the published shares and every insight built on them.
    if report:
        report_survivors()
        return 1

    ds = [HEADER_DATASETS]
    ds.append(chart("creditCardShare", loan_shares(loans["creditCard"]), SHARE_ORDER))
    ds.append(chart("tpvShare", tpv, [n for n, _ in TPV_ROWS]))
    ds.append(tpv_holes_ts(holes, set(tpv["periods"])))
    ds.append(chart("unsecuredShare", loan_shares(loans["unsecured"]), SHARE_ORDER))
    ds.append(chart("payrollShare", loan_shares(loans["payroll"]), SHARE_ORDER))
    ds.append(chart("systemNpl", aq["systemNpl"], [n for n, _ in AQ_BLOCKS["systemNpl"]]))
    ds.append(chart("systemEarlyNpl", aq["systemEarlyNpl"], [n for n, _ in AQ_BLOCKS["systemEarlyNpl"]]))
    ds.append(chart("peerNpl", aq["peerNpl"], [n for n, _ in AQ_BLOCKS["peerNpl"]]))
    ds.append(chart("costOfRisk", aq["costOfRisk"], [n for n, _ in AQ_BLOCKS["costOfRisk"]]))
    ds.append(chart("householdNpl", hh["householdNpl"], [n for n, _ in HH_BLOCKS["householdNpl"][1]]))
    ds.append(chart("householdEarlyNpl", hh["householdEarlyNpl"], [n for n, _ in HH_BLOCKS["householdEarlyNpl"][1]]))
    ds.append(chart("personalLoanRate", rates, [n for n, _ in RATE_ROWS]))
    (OUT / "datasets.ts").write_text("\n\n".join(ds) + "\n", encoding="utf-8")

    ab = [HEADER_ABSOLUTES]
    for key, name in (("creditCard", "loanAbsCreditCard"), ("unsecured", "loanAbsUnsecured"), ("payroll", "loanAbsPayroll")):
        ab.append(chart(name, {"periods": loans[key]["periods"], "rows": {k: [None if v is None else round(v) for v in vs] for k, vs in loans[key]["rows"].items()}}, LOAN_ORDER))
    (OUT / "absolutes.ts").write_text("\n\n".join(ab) + "\n", encoding="utf-8")

    print(f"wrote {OUT/'datasets.ts'} and {OUT/'absolutes.ts'}")
    if holes:
        print(f"note: TPV holes (issuer nulled, denominator interpolated): {holes}")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
