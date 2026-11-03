// scripts/export-insights.mjs
//
// Build-time export of the insight engine's computed cards to a static JSON
// file (public/insights.json -> served at /insights.json on the deployed site).
// This makes the Insights available at a stable, zero-cost URL for the MCP (and
// any other reader) instead of only existing in the browser after the SPA
// loads and runs the engine.
//
// The engine (src/insights/engine.ts) is PURE (no DOM/browser APIs) and
// assembles its INSIGHTS array defensively via safe() — a data gap skips one
// card rather than throwing — so this export can never crash the build; it
// emits exactly the same cards the UI renders.
//
// We bundle the TS engine with esbuild (already present via Vite) into a
// self-contained ESM module in the OS temp dir, import it, and serialise the
// INSIGHTS array. No source files are modified.

import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'src/insights/engine.ts');
const tmpOut = join(tmpdir(), `nubank-insights-${process.pid}-${Date.now()}.mjs`);
const outFile = join(root, 'public', 'insights.json');

// 1) Bundle the pure TS engine to a self-contained ESM file we can import.
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: tmpOut,
  logLevel: 'silent',
});

// 2) Import it and read the computed cards.
const mod = await import(pathToFileURL(tmpOut).href);
const INSIGHTS = mod.INSIGHTS;
if (!Array.isArray(INSIGHTS)) {
  throw new Error('export-insights: engine did not export an INSIGHTS array');
}

// 3) Write a small, self-describing wrapper the MCP can read.
//    (generatedAt lets a reader judge staleness; flip to the bare array in one
//    line here if the MCP would rather consume INSIGHTS directly.)
const payload = {
  generatedAt: new Date().toISOString(),
  source: 'nubankdash/src/insights/engine.ts',
  count: INSIGHTS.length,
  insights: INSIGHTS,
};

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(payload, null, 2) + '\n');
console.log(`export-insights: wrote ${outFile} (${INSIGHTS.length} insights)`);
