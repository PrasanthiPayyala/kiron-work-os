// Per-employee monthly hours rollup. Pulls from
// GET /attendance-permissions/hours-summary. Sits at the top of the
// Attendance page (or per-employee detail view in Team Attendance)
// so the worked-vs-expected number is visible without scrolling.
//
// Permissions reduce the expected number — a permitted 1h late doesn't
// show as a shortfall.
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Loader2, TrendingDown, TrendingUp, Plane } from "lucide-react";
import { Button } from "@/components/ui/button";

type Summary = Awaited<ReturnType<typeof api.attendanceHoursSummary>>;

const formatHours = (h: number) => {
  if (!Number.isFinite(h) || h === 0) return "0h";
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins === 0 ? `${whole}h` : `${whole}h ${mins}m`;
};

const monthLabel = (yyyymm: string) => {
  const [y, m] = yyyymm.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
};

export function HoursSummaryCard({
  userId,
  onRequestPermission,
}: {
  userId?: string;
  onRequestPermission?: () => void;
}) {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.attendanceHoursSummary(userId ? { user_id: userId } : undefined);
      setData(r);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't load hours");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [userId]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border bg-surface p-6 shadow-card">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (err) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        Couldn't load hours: {err}
      </div>
    );
  }
  if (!data) return null;

  const hasDeficit = data.net_shortfall_hours > 0;
  const hasSurplus = data.net_surplus_hours > 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-semibold">
            Hours · {monthLabel(data.month)}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {data.from} → {data.to}
          </p>
        </div>
        {onRequestPermission && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onRequestPermission}>
            <Plane className="h-3.5 w-3.5" />
            Request permission
          </Button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Expected" value={formatHours(data.expected_hours)} />
        <Stat label="Worked" value={formatHours(data.actual_hours)} accent="primary" />
        <Stat
          label="Leave + permission"
          value={formatHours(
            data.full_leave_hours + data.permission_minutes / 60,
          )}
          subtle={`${data.permission_minutes}m permission${data.permission_minutes === 1 ? "" : "s"}`}
        />
        <Stat
          label={hasDeficit ? "Shortfall" : "Surplus"}
          value={formatHours(hasDeficit ? data.net_shortfall_hours : data.net_surplus_hours)}
          accent={hasDeficit ? "destructive" : (hasSurplus ? "success" : "muted")}
          icon={hasDeficit ? <TrendingDown className="h-3.5 w-3.5" /> :
                hasSurplus ? <TrendingUp className="h-3.5 w-3.5" /> : null}
        />
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Net expected = work-hours minus approved leaves, half-days, and approved permissions.
        Surplus / shortfall is your worked hours vs that net expected.
      </p>
    </div>
  );
}

function Stat({
  label, value, subtle, accent, icon,
}: {
  label: string; value: string; subtle?: string;
  accent?: "primary" | "destructive" | "success" | "muted";
  icon?: React.ReactNode;
}) {
  const tone =
    accent === "primary" ? "text-primary" :
    accent === "destructive" ? "text-destructive" :
    accent === "success" ? "text-success" :
    accent === "muted" ? "text-muted-foreground" :
    "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-surface-muted/40 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 flex items-center gap-1.5 font-display text-lg font-semibold ${tone}`}>
        {icon}{value}
      </p>
      {subtle && <p className="mt-0.5 text-[10px] text-muted-foreground">{subtle}</p>}
    </div>
  );
}
