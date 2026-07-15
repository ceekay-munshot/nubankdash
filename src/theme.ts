// src/theme.ts
//
// Design tokens from the Munshot dashboard UI standards (light theme) plus the
// data-viz categorical palette. Colors were validated with the data-viz palette
// validator (CVD adjacency + normal-vision floor) on the light surface; the
// remaining sub-3:1 fills (magenta / yellow / aqua) are relieved by direct
// end-labels and the per-chart table view.

/** UI chrome tokens — the only colors used for shell, cards, and text. */
export const t = {
  primary: "#4f46e5",
  primaryLight: "#eef2ff",
  primaryBorder: "#e0e7ff",
  primaryText: "#4338ca",
  pageBg: "linear-gradient(to bottom, rgba(249,250,251,0.8), #ffffff)",
  cardBg: "rgba(255,255,255,0.9)",
  cardHeader: "rgba(255,255,255,0.95)",
  cardBodyBg: "rgba(249,250,251,0.5)",
  headerBar: "rgba(255,255,255,0.95)",
  border: "rgba(229,231,235,0.8)",
  borderSolid: "#e5e7eb",
  borderHover: "rgba(79,70,229,0.2)",
  textPrimary: "#111827",
  textSecondary: "#374151",
  textMuted: "#6b7280",
  textHint: "#9ca3af",
  errorRed: "#ef4444",
  errorBg: "#fef2f2",
  gridline: "#eef0f2",
} as const;

export const font =
  'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const transition = "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)";

/**
 * Fixed entity -> color map. Color follows the entity across every chart, never
 * its rank (data-viz non-negotiable). Nu is the brand-purple hero; the peer
 * banks map to the validated all-pairs-safe four (blue / green / magenta /
 * yellow) so the 4-line peer chart passes, and orange/violet stay away from
 * green/yellow in legend order so the 7-8 line charts pass the adjacent pairlist.
 */
export const ENTITY_COLORS: Record<string, string> = {
  Nu: "#820ad1", // Nubank brand purple — hero
  "Itaú": "#2a78d6", // blue
  Bradesco: "#008300", // green
  Santander: "#e87ba4", // magenta
  Inter: "#eda100", // yellow
  Caixa: "#1baf7a", // aqua
  BB: "#eb6834", // orange
  XP: "#4a3aa7", // violet
  "Santander Brasil": "#e87ba4", // alias used by the peer-NPL sheet
};

/** Product series colors for the asset-quality charts (validated first four). */
export const PRODUCT_COLORS: Record<string, string> = {
  "Credit card loans": "#2a78d6", // blue
  "Personal loans": "#008300", // green
  "Payroll loans": "#e87ba4", // magenta
  "Household loans": "#eda100", // yellow
};

export function colorFor(name: string): string {
  return ENTITY_COLORS[name] ?? PRODUCT_COLORS[name] ?? t.textMuted;
}
