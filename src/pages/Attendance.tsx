import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { AttendanceBadge } from "@/components/StatusBadges";
import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { supabase } from "@/integrations/supabase/client";
import { CalendarCheck, LogIn, LogOut, Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import { UserAvatar } from "@/components/UserAvatar";
import { toast } from "sonner";

export default function Attendance() {
  const { user } = useAuth();
  const { attendance, users, refresh } = useDataStore();
  const today = new Date().toISOString().slice(0, 10);
  const myLogs = useMemo(() => attendance.filter((a) => a.userId === user?.id), [attendance, user]);
  const present = myLogs.filter((l) => l.status === "present").length;
  const todayLog = myLogs.find((l) => l.date === today);
  const checkedIn = !!todayLog?.checkIn && !todayLog?.checkOut;

  const handleCheckIn = async () => {
    if (!user) return;
    const now = new Date().toISOString();
    const { error } = await supabase.from("attendance_logs").insert({
      user_id: user.id, work_date: today, check_in_at: now,
      status: "present", source: "self_checkin",
    });
    if (error) toast.error(error.message);
    else { toast.success("Checked in"); refresh(); }
  };

  const handleCheckOut = async () => {
    if (!user || !todayLog) return;
    const now = new Date().toISOString();
    const { error } = await supabase.from("attendance_logs")
      .update({ check_out_at: now })
      .eq("id", todayLog.id);
    if (error) toast.error(error.message);
    else { toast.success("Checked out"); refresh(); }
  };

  // Build last 30-day grid
  const grid = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (29 - i));
    const ds = d.toISOString().slice(0, 10);
    const log = myLogs.find((l) => l.date === ds);
    return { date: ds, status: log?.status ?? "absent" };
  });

  const colorFor = (s: string) => {
    if (s === "present") return "bg-success/70";
    if (s === "wfh") return "bg-accent/70";
    if (s === "half_day") return "bg-warning/70";
    if (s === "leave") return "bg-status-hold/70";
    if (s === "weekly_off") return "bg-muted";
    return "bg-destructive/40";
  };

  return (
    <div>
      <PageHeader title="Attendance" description="Self check-in, calendar, and team summary." icon={<CalendarCheck className="h-5 w-5" />} />
      <div className="space-y-6 p-6">
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Days present (30d)" value={present} accent="accent" />
          <StatCard label="WFH days" value={myLogs.filter((l) => l.status === "wfh").length} accent="info" />
          <StatCard label="Leaves" value={myLogs.filter((l) => l.status === "leave").length} accent="warning" />
          <StatCard label="Avg hours" value="8.4h" accent="primary" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-5 shadow-card lg:col-span-1">
            <h3 className="font-display text-sm font-semibold">Today · {today}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Self check-in</p>
            <div className="mt-4 flex items-center gap-2">
              {!checkedIn ? (
                <Button onClick={handleCheckIn} className="gap-1.5"><LogIn className="h-4 w-4" /> Check in</Button>
              ) : (
                <Button variant="outline" onClick={handleCheckOut} className="gap-1.5"><LogOut className="h-4 w-4" /> Check out</Button>
              )}
              <span className="text-sm text-muted-foreground">
                {todayLog?.checkIn ? `Checked in at ${todayLog.checkIn}` : "Not checked in"}
                {todayLog?.checkOut ? ` · Out ${todayLog.checkOut}` : ""}
              </span>
            </div>
            <div className="mt-4 rounded-md border border-dashed border-border bg-surface-muted p-3 text-xs text-muted-foreground">
              <Fingerprint className="mb-1 inline h-3.5 w-3.5" /> Biometric integration coming in next phase.
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5 shadow-card lg:col-span-2">
            <h3 className="font-display text-sm font-semibold">Last 30 days</h3>
            <div className="mt-3 grid grid-cols-10 gap-1.5">
              {grid.map((g) => (
                <div key={g.date} title={`${g.date} · ${g.status}`} className={`aspect-square rounded ${colorFor(g.status)}`} />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-success/70" /> Present</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-accent/70" /> WFH</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-warning/70" /> Half day</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-status-hold/70" /> Leave</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-muted" /> Weekly off</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface shadow-card">
          <div className="border-b border-border p-4"><h3 className="font-display text-sm font-semibold">Team attendance — today</h3></div>
          <ul className="divide-y divide-border">
            {users.slice(0, 8).map((u) => {
              const log = attendance.find((a) => a.userId === u.id && a.date === today);
              return (
                <li key={u.id} className="flex items-center gap-3 p-3">
                  <UserAvatar userId={u.id} size="sm" />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{u.name}</p><p className="text-xs text-muted-foreground">{u.designation}</p></div>
                  <AttendanceBadge status={log?.status ?? "absent"} />
                  {log?.checkIn && <span className="ml-3 hidden text-xs text-muted-foreground md:inline">{log.checkIn} → {log.checkOut ?? "—"}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
