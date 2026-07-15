// src/components/WatchlistWidget.tsx
//
// Context widget that reads the user's portfolio from the host session. It is
// the one authenticated call in the dashboard: GET /portfolio/list with the
// host JWT (Bearer). Everything else renders from bundled workbook data, so
// this widget degrades to a friendly "Waiting for session…" outside the host.
import { useEffect, useState } from "react";
import { fetchPortfolio, type PortfolioItem } from "../lib/api";
import { t } from "../theme";
import { WidgetCard } from "./WidgetCard";
import { EmptyState, ErrorState, WaitingForSession } from "./states";

const NU_TICKERS = ["NU", "NUBR33", "ROXO34"];

export function WatchlistWidget({ token }: { token: string | null }) {
  const [items, setItems] = useState<PortfolioItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetchPortfolio(token, ctrl.signal)
      .then((rows) => setItems(Array.isArray(rows) ? rows : []))
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(String(e instanceof Error ? e.message : e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [token]);

  const hasNu = !!items?.some((i) => NU_TICKERS.includes((i.ticker || "").toUpperCase()));

  return (
    <WidgetCard
      title="Your watchlist"
      subtitle="From your Munshot session"
      category="tools"
      bodyMinHeight={160}
    >
      {!token ? (
        <WaitingForSession />
      ) : loading && !items ? (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="shimmer" style={{ height: 26 }} />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} />
      ) : !items || items.length === 0 ? (
        <EmptyState
          message="No watchlist items"
          hint="Add tickers in Munshot to see them here."
          icon="☆"
        />
      ) : (
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, height: "100%", overflow: "auto" }}>
          {hasNu && (
            <div
              style={{
                fontSize: 12, fontWeight: 600, color: "#6b21a8", background: "#faf5ff",
                border: "1px solid #e9d5ff", borderRadius: 8, padding: "6px 10px",
              }}
            >
              ★ Nubank is on your watchlist
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {items.slice(0, 24).map((i) => {
              const isNu = NU_TICKERS.includes((i.ticker || "").toUpperCase());
              return (
                <span
                  key={i.id}
                  title={i.company_name ?? undefined}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: "3px 9px", borderRadius: 99,
                    background: isNu ? "#820ad1" : "#f3f4f6",
                    color: isNu ? "#fff" : t.textSecondary,
                    border: `1px solid ${isNu ? "#820ad1" : t.borderSolid}`,
                  }}
                >
                  {i.ticker}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </WidgetCard>
  );
}
