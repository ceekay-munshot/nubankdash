# Nubank Brazil — Market Share & Asset Quality

An embedded Munshot financial dashboard tracking Nubank's position in the
Brazilian banking system and the macro credit cycle behind it. It runs inside
the Munshot host as an iframe and connects through the **Munshot Dashboard
SDK** (session token + selected ticker are supplied by the host).

## What it shows

**Market share** (Nu vs Brazilian banks, time series)

- **Credit-card loans** — Nu ~15% of the system, from near-zero in 2018
- **Card TPV** — Nu is the #2 issuer by payment volume (~24%)
- **Unsecured loans** — Nu's fastest-growing book (~14%)
- **Payroll loans** — Nu's newest entry, still <1% of a bank-dominated market

**Asset quality** (system credit cycle & peer risk, NPL %, bar charts)

- **System NPL by product** — card & personal NPLs rising again; payroll structurally clean
- **System early NPL by product** — the leading indicator (short-dated arrears)
- **Peer NPL ratio** — Itaú / Santander / Bradesco / Inter, i.e. are digital banks taking worse risk?

Every chart has a **Chart / Table** toggle (the accessible table view is also the
relief channel for low-contrast series), a crosshair tooltip, and a legend that
shows each entity's latest value.

## Insights tab

The header's **Overview | Insights** switch opens a second view: nuanced,
buy-side-oriented findings computed at load time by the insight engine
([`src/insights/engine.ts`](src/insights/engine.ts)) from the same bundled
series — e.g. the TPV-vs-credit monetization gap, the 2Q25 record share grab in
a shrinking market, mix-weighted NPL exposure vs incumbents, and the measured
(not assumed) early-NPL lead-lag. Clicking any card opens a transparency modal
with the source sheets, every arithmetic step shown with the real values, the
one-line formula, an evidence chart, and the caveats. No insight number is
hardcoded; if the data changes, the insights recompute (and an insight whose
inputs disappear is skipped rather than crashing).

## Data

All series are bundled in [`src/data/datasets.ts`](src/data/datasets.ts),
generated from the `Nu_Brazil.xlsx` (05.20.2026) workbook exports. Notes on method:

- **Nu** is the sum of its two Brazilian legal entities (Nu Pagamentos + Nu
  Financeira) in every loan section — this reproduces the published Nu share.
- **Loan share** = entity balance ÷ system total (IF.data).
- **TPV share** = issuer card TPV (R$ bn) ÷ the 8 tracked issuers.
- **Asset-quality** series are the published system / peer NPL ratios (%).
- Obvious source keystroke outliers (e.g. an unsecured balance keyed as `24` for
  ~24,000, or a credit-card balance of `417390`) are de-spiked to `null` so they
  don't distort the trend. Regenerate with `scratchpad/parse.py` if the workbook
  changes.

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
