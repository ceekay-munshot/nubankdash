# Nubank Brazil — Market Share & Asset Quality

An embedded Munshot financial dashboard tracking Nubank's position in the
Brazilian banking system and the macro credit cycle behind it. It runs inside
the Munshot host as an iframe and connects through the **Munshot Dashboard
SDK** (session token + selected ticker are supplied by the host).

## What it shows

**Market share** (Nu vs Brazilian banks, time series)

- **Credit-card loans** — Nu ~16% of the system (1Q26), from ~3% in 2019
- **Card TPV** — Nu is the #2 issuer by payment volume (~24%)
- **Unsecured loans** — Nu's fastest-growing book (~15%)
- **Payroll loans** — Nu's newest entry, still well under 1% of a bank-dominated market

**Asset quality** (system credit cycle & peer risk, NPL %, trend charts)

- **System NPL by product** — BCB monthly series since Mar 2011; in Aug 2026
  card, personal-loan, payroll and household NPL are all at their worst on record
- **System early NPL by product** — the leading indicator (15–90-day arrears)
- **Payroll NPL by borrower** — the "safe" product split three ways: private-sector
  workers (~10.6%, now above credit cards) vs public employees and INSS
  retirees (~2–3%)
- **Payroll early NPL by borrower** — the pipeline into the chart above
- **Peer NPL ratio — whole bank** — Nu vs Itaú / Santander / Bradesco / Inter
- **Peer NPL ratio — household books only** — the like-for-like read. Nu lends
  almost only to households; the incumbents' whole-bank ratio is diluted by
  mortgages and corporate loans, which is worth ~1.6pp of the apparent gap

**Credit risk, checked four more ways** (bank by bank — same question as
above, measured differently, so every credit-risk series in the workbook has
a chart)

- **Early NPL (peer)** — the leading-indicator version of the peer NPL ratio,
  by bank rather than by product; flags trouble before it's 90 days overdue
- **NPL over 15 days (peer)** — a wider net than the 90-day ratio; reads
  higher for every bank, so the ranking is the useful part, not the level
- **Stage 3 (peer)** — each bank's own IFRS9 "credit-impaired" classification,
  a forward-looking flag rather than a days-overdue count
- **Write-offs (peer)** — loans a bank has fully given up on and booked as a
  realised loss, the step that comes after cost of risk (below)

**Pricing** (what each bank charges, and what the lending costs)

- **Personal-loan interest rate** — BCB weekly rate on non-payroll, pre-fixed
  personal loans (% a.a.), averaged into quarters
- **Cost of risk** — annualised provisions ÷ loans (% a.a.), the same unit as the
  rate above, which is what makes the price-of-risk comparison possible

Every chart has a view toggle (**Chart / Table**, or **Trend / Bars / Table** on
the asset-quality and pricing charts — the accessible table view is also the relief channel
for low-contrast series), a crosshair tooltip, and a legend that shows each
entity's latest value.

## Insights tab

The header's **Overview | Insights** switch opens a second view: nuanced,
buy-side-oriented findings computed at load time by the insight engine
([`src/insights/engine.ts`](src/insights/engine.ts)) from the same bundled
series — e.g. the TPV-vs-credit monetization gap, the record share grab in a
shrinking market, mix-weighted NPL exposure vs incumbents, the like-for-like
household default premium, the pricing-vs-cost-of-risk premium pair, the
measured (not assumed) early-NPL lead-lag, and the private-sector payroll
default surge. Clicking any card opens a transparency modal with
the source sheets, every arithmetic step shown with the real values, the one-line
formula, an evidence chart, and the caveats.

No insight number is hardcoded, and neither is any **period**: every window is
expressed relative to the newest reading (`last`, `back(n)`, `trough`), and the
"record share grab" insight locates its own record quarter and skips itself if
that quarter no longer happened in a shrinking market. If the data changes, the
insights recompute; an insight whose inputs disappear is skipped rather than
crashing the app.

## Data

The series come from two workbooks, each with its own regenerator; the edition
stamps are derived, not typed.

| Workbook | Feeds | Regenerator | Output |
|---|---|---|---|
| `Nu_Brazil.xlsx` (08.24.2026), quarterly | loan & TPV share, peer NPL / early NPL / 15-day / Stage 3 / write-offs, household-book NPL, cost of risk, personal-loan rates | `scratchpad/parse.py` | [`src/data/datasets.ts`](src/data/datasets.ts), [`src/data/absolutes.ts`](src/data/absolutes.ts) |
| `Bz Central Bank data.xlsx` (08.10.2026), monthly | system NPL & early NPL by product, payroll NPL & early NPL by borrower | `scratchpad/parse_bcb.py` | [`src/data/bcb.ts`](src/data/bcb.ts) |

```bash
python3 -m pip install -r scratchpad/requirements.txt          # once
python3 scratchpad/parse.py path/to/Nu_Brazil.xlsx             # rewrite datasets.ts + absolutes.ts
python3 scratchpad/parse.py path/to/Nu_Brazil.xlsx --check     # audit only
python3 scratchpad/parse_bcb.py "path/to/<date> - Bz Central Bank data.xlsx"          # rewrite bcb.ts
python3 scratchpad/parse_bcb.py "path/to/<date> - Bz Central Bank data.xlsx" --check  # audit only
```

Handing `parse.py` the BCB workbook stops with a pointer to `parse_bcb.py`.

The workbook **edition** is derived at generation time (from the filename, or
the document's own last-modified date) and emitted as `WORKBOOK` /
`BCB_WORKBOOK`, which the provenance card and the insight modal import — a
refresh cannot leave the dashboard describing new data as though it came from
the previous workbook.

### The BCB workbook (monthly system NPL)

Two sheets, `NPL` (90+ days overdue) and `Early NPL` (15–90 days), each with
a product block (household, non-payroll personal, payroll, credit card) and a
payroll-by-borrower block (private-sector, public-sector, INSS). Columns are
found by their header labels, and the SGS code printed above each one is
emitted as `BCB_CODES` for the provenance card. Notes on method:

- **Monthly, not quarterly.** The axis is a contiguous month range; a month
  the sheet skips is `null` rather than closed up. Everything that steps back
  "a year" or compares "the same season" (KPI deltas, verdicts, insights)
  reads the frequency off the period labels via
  [`src/lib/periods.ts`](src/lib/periods.ts) — 12 months back here, 4
  quarters back on the Nu_Brazil series.
- **One copy of each series.** The Nu_Brazil workbook's `Asset quality` sheet
  carries the same BCB product series sampled at quarter ends (rows 33–42).
  They match to rounding, but the monthly file runs a quarter or more ahead,
  so `parse.py` no longer emits them and the dashboard reads system NPL only
  from `bcb.ts`. (The 2Q26 values did move: e.g. card NPL 9.6% in the old
  copy, 9.1% for Jun 2026 here.)
- **"All household loans" is a different series** from the household line the
  dashboard used to chart: it is BCB's all-household total (21084 / 21005),
  mortgages, vehicle and rural credit included. Its 90-day reading runs below
  the old line (5.4% vs 7.2% for 1Q26) and its early reading above it, so it
  carries a new name rather than silently replacing the old one.
- **Payroll appears twice** (once in each block). The product block's copy is
  used everywhere so the line reads the same in both charts; `--check` prints
  any month where the two copies disagree (this edition: May 2026 early NPL,
  2.83 vs 2.84).
- **Trusted as uploaded.** A one-month-excursion scan prints FYIs (this
  edition: public-sector payroll early NPL in Mar 2019, INSS in Feb 2014) but
  never edits or blocks — monthly arrears can genuinely jump for a month, e.g.
  when a state pays its payroll late.

### The Nu_Brazil workbook (quarterly)

The workbook is **trusted as uploaded** — `parse.py` never refuses to
write. It does run a plausibility scan for loan-stock excursions (a balance far
off on the same side of both neighbouring quarters) and prints anything it
notices under `--check` or on a normal run, purely as an FYI; nothing in this
script blocks or exits non-zero because of what that scan finds. If a future
workbook contains a genuine keying error, add it to `SPIKES` (with a reason) so
the fix is documented, the same as the six corrections already there.

Notes on method:

- **Nu** is the sum of its two Brazilian legal entities (Nu Pagamentos + Nu
  Financeira) in every loan section. Which of the two rows carries the balance
  moved in 1Q25, so the parser always adds both.
- **Loan share** = entity balance ÷ the sheet's own system total (IF.data), never
  a sum of the listed banks — so one bad cell cannot move Nu's share.
- **TPV share** = issuer card TPV (R$ bn) ÷ the 8 tracked issuers.
- **Asset-quality** series are the published peer NPL ratios (%), plus four
  more per-bank views (early NPL, NPL over 15 days, Stage 3, write-offs)
  extracted the same way — see `AQ_BLOCKS` in `scratchpad/parse.py` for what
  each row measures. System NPL by product comes from the BCB workbook (above).
- **Rates** are the BCB weekly personal-loan series, averaged into calendar
  quarters. A quarter is dropped if it holds fewer than 6 weekly readings, and a
  lender's own value is dropped if *that lender* reported fewer than 6 times in
  it — an otherwise complete quarter can still be near-empty for one bank.
- Source keystroke outliers (an unsecured balance keyed as `24` for ~26,000, a
  credit-card balance of `417390`, a cell duplicated from the row above) are
  de-spiked to `null`. The detector re-runs over the whole workbook on every
  invocation and each documented de-spike is independently re-detected when
  removed from the list, so the list cannot rot and a new bad cell cannot slip
  through silently.
- Where the workbook is **missing** one tracked issuer's card TPV for a quarter
  (Caixa, 3Q25 and 2Q26 in this edition), that issuer's own share is `null` and
  the denominator is repaired by interpolation — otherwise the missing ~9% of
  volume would silently inflate all seven issuers that did report. A quarter with
  no later reading to interpolate from is dropped entirely. The parser emits what
  it did as `tpvHoles`, and the in-app "Sources & method" card reports it from
  there — a dropped quarter is invisible if you try to re-derive it from the
  published shares.

### Deliberately not wired

Two things on the `Personal Loans - Interest rates` sheet are left out, both
found while checking the workbook for anything missing from the dashboard —
see `read_rates()` in `scratchpad/parse.py` for the full reasoning:

- A second block that restates the same 5-bank rates as a monthly-equivalent
  figure (`((1 + rate) ^ (1/12)) - 1`). Same numbers, different unit — charting
  it too would just show the same fact twice under a different label.
- The sheet's own "Average of % a.a." row, which looks like a genuine
  ~120-lender market average. It was, historically, but the underlying
  per-lender table stopped being updated for most lenders after 4Q24: in the
  newest quarter this workbook covers, only 7 of ~120 rows still report, one of
  which (Banco BMG) prints ~495% a.a. Publishing that under a "market average"
  label in the newest, most-relevant quarters would be misleading, not merely
  incomplete, so it's left off.

### Restatements in this edition vs the 05.20.2026 workbook

- System **personal-loan** NPL and early-NPL were restated across the whole
  history (+0.4 to +0.8pp on the 90-day series); household early NPL was restated
  down in the pre-2020 years.
- Nu's **payroll** balance for 4Q25 was revised from 6,791 to 4,098 R$ mn — which
  is why the payroll insight now headlines a four-quarter growth rate rather than
  a single quarter.
- Card TPV values moved by ~0.1pp across most quarters.
- Nu's pre-2019 loan shares are now `null` rather than `0`: the workbook reports
  `-` for those years, and `0` asserted something the source does not say.

## Munshot SDK / host integration

The host handshake follows `auth-standards.md` exactly:

- The SDK is loaded as a **classic blocking `<script>`** in `index.html` `<head>`.
- [`src/lib/sdk.ts`](src/lib/sdk.ts) creates **one** client at module load (its
  `message` listener is live before `host:init` can arrive). `autoReady` is left
  at its default; `sdk.ready()` is **never** called manually.
- [`src/hooks/useHostContext.ts`](src/hooks/useHostContext.ts) reads context via
  `getContext()` and re-syncs on every `onMessage`.
- The dashboard registers the two host request handlers —
  `dashboard.capture.visual` (returns a PNG `Blob` of `#dashboard-main`) and
  `dashboard.capture.snapshot` (returns bounded, cloneable `{ context, selection,
  data }`). Both are wrapped so they never throw.
- The one authenticated call — the watchlist widget's `GET /portfolio/list` —
  sends `Authorization: Bearer ${session.token}` and shows an in-widget
  "Waiting for session…" state until the token arrives.

Outside the host (e.g. `npm run preview`) the SDK falls back to a faithful no-op
client, so the dashboard still renders from its bundled data.

## Develop

```bash
npm install
npm run dev       # vite dev server
npm run build     # tsc -b && vite build  (type-check + production build)
npm run preview   # serve the production build
```

## Deploy note

The host forwards the session token regardless of the dashboard's domain, but the
deployed domain must be **CORS-allowlisted on the Munshot APIs** for authenticated
requests (the watchlist widget) to succeed — coordinate with the platform team.
