// src/components/states.tsx
import { t } from "../theme";

const wrap: React.CSSProperties = {
  minHeight: 160, height: "100%", display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center", textAlign: "center",
  gap: 8, padding: 24,
};

/** Shimmer skeleton shaped roughly like a chart (bars of varying height). */
export function ChartSkeleton({ height = 260 }: { height?: number }) {
  const heights = [40, 62, 48, 74, 55, 82, 66, 90, 70, 96, 78, 60];
  return (
    <div style={{ padding: 16, height }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: height - 56 }}>
        {heights.map((h, i) => (
          <div key={i} className="shimmer" style={{ flex: 1, height: `${h}%`, borderRadius: 6 }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        {[64, 52, 58, 46].map((w, i) => (
          <div key={i} className="shimmer" style={{ height: 10, width: w }} />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ message, hint, icon = "▢" }: { message: string; hint?: string; icon?: string }) {
  return (
    <div style={wrap}>
      <div
        style={{
          width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center",
          background: t.primaryLight, color: t.primary, fontSize: 18,
        }}
      >
        {icon}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: t.textSecondary }}>{message}</div>
      {hint && <div style={{ fontSize: 12, color: t.textHint, maxWidth: 280 }}>{hint}</div>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div style={wrap}>
      <div
        style={{
          width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center",
          background: t.errorBg, color: t.errorRed, fontSize: 20, fontWeight: 700,
        }}
      >
        !
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: t.textSecondary }}>Something went wrong</div>
      <div style={{ fontSize: 12, color: t.textHint, maxWidth: 300 }}>{message}</div>
      <div style={{ fontSize: 11, color: t.textHint }}>Please try again later.</div>
    </div>
  );
}

/** Non-blocking, in-widget notice while the host session token is still null. */
export function WaitingForSession() {
  return (
    <div style={{ padding: 16, textAlign: "center", color: t.textHint, fontSize: 13 }}>
      Waiting for session…
    </div>
  );
}
