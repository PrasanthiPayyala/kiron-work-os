import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bell, CheckCheck, AlertTriangle, Clock, ShieldCheck, AtSign,
  Megaphone, RefreshCw, ArrowRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { api, ApiError } from "@/lib/api";
import { toast } from "sonner";
import type { Notification } from "@/types";

type Filter = "all" | "unread" | "tasks" | "approvals" | "mentions" | "system";

const iconFor = (kind: Notification["kind"]) => {
  switch (kind) {
    case "overdue":
    case "due_today":
      return AlertTriangle;
    case "no_update_1d":
    case "no_update_3d":
      return Clock;
    case "pending_approval":
      return ShieldCheck;
    case "mention":
      return AtSign;
    case "announcement":
      return Megaphone;
    case "recurring_upcoming":
      return RefreshCw;
    default:
      return Bell;
  }
};

const accentFor = (kind: Notification["kind"]) => {
  switch (kind) {
    case "overdue":
      return "text-destructive bg-destructive/10";
    case "due_today":
      return "text-warning bg-warning/10";
    case "pending_approval":
      return "text-status-approval bg-status-approval/10";
    case "mention":
      return "text-accent bg-accent/10";
    case "announcement":
      return "text-primary bg-primary-soft";
    default:
      return "text-muted-foreground bg-surface-muted";
  }
};

const groupFor = (n: Notification): Exclude<Filter, "all" | "unread"> => {
  if (n.kind === "pending_approval") return "approvals";
  if (n.kind === "mention") return "mentions";
  if (n.kind === "announcement" || n.kind === "recurring_upcoming") return "system";
  return "tasks";
};

const relative = (iso: string) => {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
};

export default function Notifications() {
  const { user } = useAuth();
  const { notifications, refresh } = useDataStore();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);

  const mine = useMemo(
    () => notifications
      .filter((n) => n.userId === user?.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [notifications, user?.id],
  );

  const counts = useMemo(() => ({
    all: mine.length,
    unread: mine.filter((n) => !n.read).length,
    tasks: mine.filter((n) => groupFor(n) === "tasks").length,
    approvals: mine.filter((n) => groupFor(n) === "approvals").length,
    mentions: mine.filter((n) => groupFor(n) === "mentions").length,
    system: mine.filter((n) => groupFor(n) === "system").length,
  }), [mine]);

  const visible = useMemo(() => mine.filter((n) => {
    if (filter === "all") return true;
    if (filter === "unread") return !n.read;
    return groupFor(n) === filter;
  }), [mine, filter]);

  const markRead = async (n: Notification) => {
    if (n.read) return;
    try {
      await api.markNotificationRead(n.id);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to mark as read");
    }
  };

  const markAllRead = async () => {
    if (!user || counts.unread === 0) return;
    setBusy(true);
    try {
      await api.markAllNotificationsRead();
      toast.success(`Marked ${counts.unread} as read`);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to mark all as read");
    } finally {
      setBusy(false);
    }
  };

  const open = async (n: Notification) => {
    await markRead(n);
    if (n.link) navigate(n.link);
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Every alert routed to you — overdue tasks, approvals, mentions, and announcements."
        icon={<Bell className="h-5 w-5" />}
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={markAllRead}
            disabled={busy || counts.unread === 0}
          >
            <CheckCheck className="mr-1.5 h-4 w-4" />
            Mark all read{counts.unread > 0 ? ` (${counts.unread})` : ""}
          </Button>
        }
      />

      <div className="space-y-4 p-6">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
            <TabsTrigger value="unread">Unread ({counts.unread})</TabsTrigger>
            <TabsTrigger value="tasks">Tasks ({counts.tasks})</TabsTrigger>
            <TabsTrigger value="approvals">Approvals ({counts.approvals})</TabsTrigger>
            <TabsTrigger value="mentions">Mentions ({counts.mentions})</TabsTrigger>
            <TabsTrigger value="system">System ({counts.system})</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="rounded-xl border border-border bg-surface shadow-card">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-sm text-muted-foreground">
              <Bell className="mb-3 h-10 w-10 opacity-30" />
              <p>{filter === "unread" ? "You're all caught up." : "Nothing here."}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((n) => {
                const Icon = iconFor(n.kind);
                return (
                  <li
                    key={n.id}
                    onClick={() => open(n)}
                    className={`flex cursor-pointer items-start gap-3 p-4 transition hover:bg-surface-muted/40 ${
                      !n.read ? "bg-primary-soft/30" : ""
                    }`}
                  >
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${accentFor(n.kind)}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm leading-tight ${!n.read ? "font-semibold" : "font-medium"}`}>
                          {n.title}
                        </p>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{relative(n.createdAt)}</span>
                      </div>
                      {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {n.kind.replace(/_/g, " ")}
                        </span>
                        {n.link && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] text-primary">
                            Open <ArrowRight className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                    </div>
                    {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
