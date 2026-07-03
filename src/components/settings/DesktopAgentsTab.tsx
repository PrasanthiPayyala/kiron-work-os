// Kiron Presence Client fleet dashboard for the Settings page.
// Lists every active employee alongside their most recent desktop-agent
// snapshot — device_id, hostname, client_version, last_heartbeat_at.
// HR uses this to spot machines whose agent hasn't checked in for 3+
// days (uninstalled, laptop off, or the app broke).
//
// This tab is HR-only via backend authz + roleNavAccess for the
// Settings NavKey. Renders even when no employee has installed the
// agent yet — HR can tell at a glance who's covered vs. who needs the
// installer nudge.
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CompanyBadge } from "@/components/CompanyBadge";
import { Loader2, RefreshCw, Laptop } from "lucide-react";
import { toast } from "sonner";

type AgentRow = Awaited<ReturnType<typeof api.listDesktopAgents>>[number];

// A heartbeat within this many minutes counts the agent as "live" — green
// dot. Between this and the stale threshold = yellow. Older = red.
const LIVE_MIN = 15;
const STALE_MIN = 60;
const NEVER_LABEL = "Never installed";

const fmtRelative = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = Date.now();
  const s = Math.max(0, Math.floor((now - d.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const days = Math.floor(s / 86400);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
};

const statusFor = (iso: string | null): "live" | "recent" | "stale" | "never" => {
  if (!iso) return "never";
  const age = Date.now() - new Date(iso).getTime();
  if (age < LIVE_MIN * 60 * 1000) return "live";
  if (age < STALE_MIN * 60 * 1000) return "recent";
  return "stale";
};

const dotClass = (s: ReturnType<typeof statusFor>) => {
  switch (s) {
    case "live":   return "bg-emerald-500";
    case "recent": return "bg-yellow-500";
    case "stale":  return "bg-destructive";
    default:       return "bg-muted-foreground/40";
  }
};

export function DesktopAgentsTab() {
  const [rows, setRows] = useState<AgentRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.listDesktopAgents();
      setRows(data);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't load desktop agents");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  const summary = rows ? {
    total: rows.length,
    live: rows.filter((r) => statusFor(r.last_heartbeat_at) === "live").length,
    stale: rows.filter((r) => statusFor(r.last_heartbeat_at) === "stale").length,
    never: rows.filter((r) => statusFor(r.last_heartbeat_at) === "never").length,
  } : null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold">
            <Laptop className="h-4 w-4" /> Desktop agents
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Presence client fleet — one row per active employee with their most recent heartbeat.
            {summary && (
              <>
                {" · "}
                <span className="text-emerald-600">{summary.live} live</span>
                {summary.stale > 0 && <> · <span className="text-destructive">{summary.stale} stale</span></>}
                {summary.never > 0 && <> · <span className="text-muted-foreground">{summary.never} never installed</span></>}
              </>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {rows === null ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No active employees.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Employee</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Last heartbeat</th>
                <th className="p-3 font-medium">Hostname</th>
                <th className="p-3 font-medium">Version</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const s = statusFor(r.last_heartbeat_at);
                return (
                  <tr key={r.id} className="hover:bg-surface-muted/60">
                    <td className="p-3">
                      <div className="font-medium">{r.full_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.designation || "—"}
                        {r.home_company_id && <> · <CompanyBadge id={r.home_company_id} /></>}
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className="gap-1.5 text-[11px]">
                        <span className={`h-1.5 w-1.5 rounded-full ${dotClass(s)}`} />
                        {s === "live" && "Live"}
                        {s === "recent" && "Recent"}
                        {s === "stale" && "Stale"}
                        {s === "never" && "Never"}
                      </Badge>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {r.last_heartbeat_at ? fmtRelative(r.last_heartbeat_at) : NEVER_LABEL}
                    </td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">
                      {r.hostname || "—"}
                    </td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">
                      {r.client_version || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
