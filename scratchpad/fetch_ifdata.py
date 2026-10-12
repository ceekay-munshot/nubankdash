#!/usr/bin/env python3
"""Extend the quarterly loan series past the Nu_Brazil workbook, from BCB IF.data.

Usage:
    python3 scratchpad/fetch_ifdata.py [--check] [--cache DIR]

Why this exists: the Nu_Brazil workbook's Loans sheet IS IF.data report 11
("Carteira de credito ativa Pessoa Fisica - modalidade e prazo de vencimento"),
pulled by the analyst. IF.data publishes each quarter about three months after
it ends - often before the next workbook edition arrives - so this script
appends the quarters the workbook does not have yet, straight from the source,
and writes them to src/data/ifdata.ts. src/data/loans.ts then serves the
workbook's series with those quarters appended; the workbook always wins for
any quarter it covers, so a newer edition simply supersedes what is fetched.

Same method as parse.py: balances in R$ mn per prudential conglomerate, System
= the sum over every institution in the report (the "Total" row the workbook
carries), share = balance / System. Shares are computed with parse.py's own
loan_shares(), so the rounding is identical.

Guard: before writing, the script re-derives the workbook's NEWEST quarter from
IF.data and compares it bank by bank (the 08.24.2026 edition matches 1Q26 and
4Q25 to the R$ mn). A gap above 2% on any series means the mapping below no
longer describes the workbook - a conglomerate re-coded, a column renamed - and
the script stops WITHOUT writing: appending numbers built a different way would
put a fake break in every share chart. Smaller gaps are IF.data restatements
and are printed as an FYI.

--cache DIR keeps the downloaded reports (~28 MB per quarter) for re-runs.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parse import LOAN_ORDER, SHARE_ORDER, chart, detect_spikes, loan_shares  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ABSOLUTES = ROOT / "src" / "data" / "absolutes.ts"
OUT = ROOT / "src" / "data" / "ifdata.ts"

API = "https://olinda.bcb.gov.br/olinda/servico/IFDATA/versao/v1/odata"
REPORT = "11"
TIPO = 1  # prudential conglomerates + independent institutions: each lender counted once

# Prudential-conglomerate codes, per dashboard series. Nu has reported as one
# conglomerate since 1Q25 (before that the workbook summed two rows).
CONGLOMERATES = {
    "Nu": "C0084693",
    "Itaú": "C0080099",
    "Bradesco": "C0080075",
    "Santander": "C0080185",
    "Caixa": "C0080738",
    "BB": "C0080329",
    "Inter": "C0080996",
    "XP": "C0082475",
}
# Dashboard section -> IF.data modality group.
SECTIONS = {
    "creditCard": "Cartão de Crédito",
    "unsecured": "Empréstimo sem Consignação em Folha",
    "payroll": "Empréstimo com Consignação em Folha",
}
GUARD_PCT = 2.0
#: Series too small for a % comparison to mean anything (R$ mn).
GUARD_FLOOR = 50.0


def quarter_label(year, q):
    return f"{q}Q{year % 100:02d}"


def parse_quarter(label):
    m = re.fullmatch(r"([1-4])Q(\d{2})", label)
    if not m:
        raise SystemExit(f"workbook's newest loan period {label!r} is not a quarter label")
    return 2000 + int(m.group(2)), int(m.group(1))


def workbook_latest():
    """The workbook's newest quarter and its balances, read off the generated absolutes.ts."""
    ts = ABSOLUTES.read_text(encoding="utf-8")
    out, period = {}, None
    for section, name in (("creditCard", "loanAbsCreditCard"), ("unsecured", "loanAbsUnsecured"), ("payroll", "loanAbsPayroll")):
        m = re.search(r"export const %s: ChartData = \{\s*periods: \[(.*?)\],\s*series: \[(.*?)\n  \]," % name, ts, re.S)
        periods = json.loads("[" + m.group(1) + "]")
        period = periods[-1]
        rows = {}
        for sm in re.finditer(r'name: "(.*?)", values: \[(.*?)\]', m.group(2)):
            rows[json.loads('"' + sm.group(1) + '"')] = json.loads("[" + sm.group(2) + "]")
        out[section] = {"periods": periods, "rows": rows}
    return period, out


def fetch(year, q, cache):
    """-> {group: {CodInst: saldo in R$}} or None if IF.data has not published it."""
    am = f"{year}{3 * q:02d}"
    path = cache / f"r11_{am}_t{TIPO}.json" if cache else None
    if path and path.exists():
        raw = path.read_bytes()
    else:
        params = {"@AnoMes": am, "@TipoInstituicao": str(TIPO), "@Relatorio": f"'{REPORT}'", "$format": "json"}
        url = f"{API}/IfDataValores(AnoMes=@AnoMes,TipoInstituicao=@TipoInstituicao,Relatorio=@Relatorio)?" + urllib.parse.urlencode(params)
        print(f"  downloading IF.data report {REPORT} for {am} ...", flush=True)
        with urllib.request.urlopen(url, timeout=600) as r:
            raw = r.read()
    values = json.loads(raw).get("value", [])
    if not values:
        return None  # never cached: an unpublished quarter must be re-asked next run
    if path and not path.exists():
        path.write_bytes(raw)
    totals = {}
    for v in values:
        if v.get("NomeColuna") == "Total" and v.get("Saldo") is not None:
            totals.setdefault(v.get("Grupo"), {})[v["CodInst"]] = v["Saldo"]
    return totals


def balances(totals):
    """-> {section: {series: R$ mn}}"""
    out = {}
    for section, group in SECTIONS.items():
        g = totals.get(group, {})
        rows = {name: g.get(code, 0) / 1e6 for name, code in CONGLOMERATES.items()}
        rows["System"] = sum(g.values()) / 1e6
        out[section] = rows
    return out


def main():
    check = "--check" in sys.argv
    cache = None
    if "--cache" in sys.argv:
        cache = Path(sys.argv[sys.argv.index("--cache") + 1])
        cache.mkdir(parents=True, exist_ok=True)

    wb_period, wb = workbook_latest()
    year, q = parse_quarter(wb_period)
    print(f"workbook's newest loan quarter: {wb_period}")

    # 1. Guard: IF.data must reproduce the workbook's newest quarter.
    overlap = fetch(year, q, cache)
    if overlap is None:
        raise SystemExit(f"IF.data has no data for {wb_period}; cannot validate the mapping")
    mine = balances(overlap)
    broken, restated = [], []
    for section in SECTIONS:
        for name in LOAN_ORDER:
            w = wb[section]["rows"][name][-1]
            m = mine[section][name]
            if w is None or max(abs(w), abs(m)) < GUARD_FLOOR:
                continue
            gap = 100 * (m / w - 1) if w else float("inf")
            if abs(gap) > GUARD_PCT:
                broken.append(f"{section:10s} {name:10s} workbook {w:12,.0f}  IF.data {m:12,.0f}  ({gap:+.1f}%)")
            elif abs(m - w) >= 1:
                restated.append(f"{section:10s} {name:10s} workbook {w:12,.0f}  IF.data {m:12,.0f}  ({gap:+.2f}%)")
    print(f"overlap check on {wb_period}: {'OK' if not broken else 'FAILED'}")
    for r in restated:
        print(f"  FYI restated: {r}")
    if broken:
        for b in broken:
            print(f"  MISMATCH: {b}")
        raise SystemExit("IF.data no longer reproduces the workbook - fix CONGLOMERATES/SECTIONS before appending. Nothing written.")

    # 2. Every published quarter after the workbook's newest.
    today = dt.date.today()
    newest_possible = (today.year, (today.month - 1) // 3)  # the quarter that has already ended
    if newest_possible[1] == 0:
        newest_possible = (today.year - 1, 4)
    found = []
    y, qq = year, q
    while True:
        y, qq = (y + 1, 1) if qq == 4 else (y, qq + 1)
        if (y, qq) > newest_possible:
            break
        totals = fetch(y, qq, cache)
        if totals is None:
            print(f"  {quarter_label(y, qq)}: not published yet")
            break
        found.append((quarter_label(y, qq), balances(totals)))

    labels = [p for p, _ in found]
    print(f"quarters to append: {labels or 'none'}")
    for p, b in found:
        for section in SECTIONS:
            print(f"  {p} {section:10s} " + "  ".join(f"{n} {b[section][n]:,.0f}" for n in LOAN_ORDER))

    # FYI only, like parse.py: does a new quarter look like a keying error
    # against the workbook's history?
    for section in SECTIONS:
        for name in LOAN_ORDER:
            series = wb[section]["rows"][name] + [b[section][name] for _, b in found]
            periods = wb[section]["periods"] + labels
            for hit in detect_spikes(section, name, periods, series):
                if hit[2] in labels or periods.index(hit[2]) == len(wb[section]["periods"]) - 1:
                    print(f"  FYI excursion: {hit[0]} {hit[1]} {hit[2]}: {hit[3]:,.0f} -> {hit[4]:,.0f} -> {hit[5]:,.0f}")
    if check:
        return 0

    parts = [HEADER.replace("{fetched}", today.isoformat()).replace("{quarters}", json.dumps(labels)).replace("{validated}", wb_period)]
    for section, abs_name, share_name in (
        ("creditCard", "loanAbsCreditCardExt", "creditCardShareExt"),
        ("unsecured", "loanAbsUnsecuredExt", "unsecuredShareExt"),
        ("payroll", "loanAbsPayrollExt", "payrollShareExt"),
    ):
        rows = {name: [b[section][name] for _, b in found] for name in LOAN_ORDER}
        data = {"periods": labels, "rows": rows}
        parts.append(chart(share_name, loan_shares(data), SHARE_ORDER))
        parts.append(chart(abs_name, {"periods": labels, "rows": {k: [round(v) for v in vs] for k, vs in rows.items()}}, LOAN_ORDER))
    OUT.write_text("\n\n".join(parts) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")
    return 0


HEADER = '''// AUTO-GENERATED by scratchpad/fetch_ifdata.py from BCB IF.data report 11
// (fetched {fetched}). Do not edit by hand; re-run the script.
//
// Loan quarters NEWER than the Nu_Brazil workbook, taken straight from the
// workbook's own source. Same method as parse.py: R$ mn per prudential
// conglomerate, System = every institution in the report, share = balance /
// System. Before writing, the script re-derived the workbook's newest quarter
// ({validated}) from IF.data and required it to match bank by bank.
// src/data/loans.ts appends these to the workbook's series; the workbook wins
// for any quarter it covers.
import type { ChartData } from "./datasets";

/** Quarters this file adds beyond the workbook (empty when the workbook is current). */
export const IFDATA_QUARTERS: string[] = {quarters};
/** When IF.data was queried. */
export const IFDATA_FETCHED = "{fetched}";
'''


if __name__ == "__main__":
    sys.exit(main() or 0)
