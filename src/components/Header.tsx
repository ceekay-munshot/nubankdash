// src/components/Header.tsx
import { t } from "../theme";

export function TickerPill({ ticker, company }: { ticker: string; company?: string | null }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 10px",
        background: t.primaryLight, color: t.primaryText, borderRadius: 99,
        fontSize: 12, fontWeight: 600, border: `1px solid ${t.primaryBorder}`,
      }}
    >
      <span style={{ width: 6, height: 6, background: t.primary, borderRadius: "50%" }} />
      {ticker}
      {company && <span style={{ color: "#818cf8", fontWeight: 400 }}>· {company}</span>}
    </span>
  );
}

/** Small connection indicator: green once the host session token has arrived. */
function SessionDot({ connected }: { connected: boolean }) {
  return (
    <span
      title={connected ? "Host session connected" : "Waiting for host session…"}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: t.textMuted }}
    >
      <span
        style={{
          width: 8, height: 8, borderRadius: "50%",
          background: connected ? "#16a34a" : "#d1d5db",
          boxShadow: connected ? "0 0 0 3px rgba(22,163,74,0.15)" : "none",
        }}
      />
      {connected ? "Live" : "Offline"}
    </span>
  );
}

function IconButton({ label, onClick, title }: { label: string; onClick?: () => void; title?: string }) {
  return (
    <button
      className="link-btn"
      onClick={onClick}
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px",
        fontSize: 12, fontWeight: 600, color: t.textSecondary, cursor: "pointer",
        background: "#fff", border: `1px solid ${t.borderSolid}`, borderRadius: 8,
      }}
    >
      {label}
    </button>
  );
}

export function Header({
  ticker,
  tickerCompany,
  connected,
  onExport,
}: {
  ticker: string | null;
  tickerCompany: string | null;
  connected: boolean;
  onExport: () => void;
}) {
  return (
    <header
      style={{
        position: "sticky", top: 0, zIndex: 10, display: "flex", alignItems: "center",
        justifyContent: "space-between", padding: "0 24px", height: 48,
        background: t.headerBar, backdropFilter: "blur(8px)",
        borderBottom: `1px solid ${t.borderSolid}`, flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span
          aria-hidden
          style={{
            width: 22, height: 22, borderRadius: 6, background: "#820ad1", color: "#fff",
            display: "grid", placeItems: "center", fontSize: 13, fontWeight: 800, flexShrink: 0,
          }}
        >
          N
        </span>
        <h1 style={{ fontSize: 15, fontWeight: 700, color: t.textPrimary, margin: 0, whiteSpace: "nowrap" }}>
          Nubank Brazil
        </h1>
        <span style={{ fontSize: 12, color: t.textHint, whiteSpace: "nowrap" }}>
          Market share &amp; asset quality
        </span>
        {ticker && <TickerPill ticker={ticker} company={tickerCompany} />}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <SessionDot connected={connected} />
        <IconButton label="Export PNG" onClick={onExport} title="Download a snapshot of the dashboard" />
      </div>
    </header>
  );
}
