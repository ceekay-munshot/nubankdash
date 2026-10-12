# Nubank Brazil dashboard — working rules

## When the user shares a new data file

This is the standing instruction from the dashboard's owner:

1. **Update the dashboard and ALL charts with the latest data** — not only the
   charts the file obviously feeds. After loading the file, also run
   `scratchpad/fetch_ifdata.py` (newer loan quarters straight from BCB IF.data),
   then check every chart's newest period and report, chart by chart, which
   ones moved forward and which could not (and why).
2. **Do not change the UI.** Same charts, layout, titles, views and styling, so
   trends can be studied across refreshes. Only the data, the computed
   verdicts/insights and data-derived copy change. If new data seems to call for
   a new chart or a layout change, propose it and wait for a yes.
3. Never splice two methods into one line: a newer period from a different
   source is only appended after it reproduces the existing periods (see
   `fetch_ifdata.py`'s guard). If it can't, leave the chart at its last period
   and say so.

## Which file goes where

| File | Regenerator | Writes |
|---|---|---|
| `<date>__Nu_Brazil.xlsx` (quarterly, analyst) | `python3 scratchpad/parse.py <file>` | `src/data/datasets.ts`, `src/data/absolutes.ts` |
| `<date> - Bz Central Bank data.xlsx` (monthly BCB NPL) | `python3 scratchpad/parse_bcb.py <file>` | `src/data/bcb.ts` |
| BCB IF.data (online, after either of the above) | `python3 scratchpad/fetch_ifdata.py` | `src/data/ifdata.ts` |

Each regenerator has `--check` to audit without writing. Generated files are
never edited by hand. See the README "Data" section for method notes.

## Verify before shipping

- `npx tsc -b --noEmit` and `npm run build`.
- Run the insight engine (bundle `src/insights/engine.ts` with esbuild, print
  `INSIGHTS`) and read every headline against the new data — the copy is
  data-driven, but thresholds and wording still need a human-eyes check.
- Render the app (`npx vite preview`) and look at the charts.
