import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { LeaveStatusBadge } from "@/components/StatusBadges";
import { UserAvatar } from "@/components/UserAvatar";
import { useDataStore } from "@/lib/dataStore";
import { supabase } from "@/integrations/supabase/client";
import { Plane, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

const LEAVE_TYPE_DB: Record<string, string> = {
  casual: "casual_leave", sick: "sick_leave", loss_of_pay: "loss_of_pay",
  wfh: "work_from_home", comp_off: "comp_off", optional_holiday: "optional_holiday",
};

export default function Leave() {
  const { user } = useAuth();
  const { leaveRequests, getUser, refresh } = useDataStore();
  const [type, setType] = useState("casual");
  const [days, setDays] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");

  const myLeaves = leaveRequests.filter((l) => l.userId === user?.id);
  const isHR = user?.role === "hr_admin" || user?.role === "super_admin";

  const submit = async () => {
    if (!user || !from || !to) { toast.error("From and To dates required"); return; }
    const { error } = await supabase.from("leave_requests").insert({
      user_id: user.id,
      leave_type: LEAVE_TYPE_DB[type] as any,
      start_date: from, end_date: to,
      days, reason, status: "pending",
    });
    if (error) toast.error(error.message);
    else { toast.success("Leave submitted"); setFrom(""); setTo(""); setReason(""); refresh(); }
  };

  const decide = async (id: string, status: "approved" | "rejected") => {
    if (!user) return;
    const { error } = await supabase.from("leave_requests").update({
      status, hr_approver_id: user.id, decided_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(`Leave ${status}`); refresh(); }
  };

  return (
    <div>
      <PageHeader title="Leave" description="Apply, track, and approve time off." icon={<Plane className="h-5 w-5" />} actions={<Button size="sm" onClick={submit}><Plus className="h-4 w-4 mr-1.5" /> Apply leave</Button>} />
      <div className="space-y-6 p-6">
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Casual remaining" value={8} accent="primary" />
          <StatCard label="Sick remaining" value={5} accent="info" />
          <StatCard label="Comp off" value={2} accent="accent" />
          <StatCard label="Pending requests" value={leaveRequests.filter((l) => l.status === "pending").length} accent="warning" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <h3 className="font-display text-sm font-semibold">Apply for leave</h3>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Leave type</label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="casual">Casual</SelectItem>
                      <SelectItem value="sick">Sick</SelectItem>
                      <SelectItem value="loss_of_pay">Loss of Pay</SelectItem>
                      <SelectItem value="wfh">WFH</SelectItem>
                      <SelectItem value="comp_off">Comp Off</SelectItem>
                      <SelectItem value="optional_holiday">Optional Holiday</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><label className="text-xs text-muted-foreground">Days</label><Input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 mt-1" /></div>
                <div><label className="text-xs text-muted-foreground">From</label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 mt-1" /></div>
                <div><label className="text-xs text-muted-foreground">To</label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 mt-1" /></div>
              </div>
              <div><label className="text-xs text-muted-foreground">Reason</label><textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm" rows={3} /></div>
              <Button onClick={submit}>Submit request</Button>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface shadow-card">
            <div className="border-b border-border p-4"><h3 className="font-display text-sm font-semibold">My leave history</h3></div>
            <ul className="divide-y divide-border">
              {myLeaves.length === 0 && <p className="p-6 text-sm text-muted-foreground">No leaves yet.</p>}
              {myLeaves.map((l) => (
                <li key={l.id} className="flex items-center gap-3 p-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium capitalize">{l.type.replace("_"," ")} · {l.days}d</p>
                    <p className="text-xs text-muted-foreground">{l.fromDate} → {l.toDate}</p>
                  </div>
                  <LeaveStatusBadge status={l.status} />
                </li>
              ))}
            </ul>
          </div>
        </div>

        {isHR && (
          <div className="rounded-xl border border-border bg-surface shadow-card">
            <div className="border-b border-border p-4"><h3 className="font-display text-sm font-semibold">HR approval queue</h3></div>
            <Tabs defaultValue="pending" className="p-4">
              <TabsList><TabsTrigger value="pending">Pending</TabsTrigger><TabsTrigger value="approved">Approved</TabsTrigger><TabsTrigger value="rejected">Rejected</TabsTrigger></TabsList>
              {(["pending","approved","rejected"] as const).map((s) => (
                <TabsContent key={s} value={s}>
                  <ul className="divide-y divide-border">
                    {leaveRequests.filter((l) => l.status === s).map((l) => (
                      <li key={l.id} className="flex items-center gap-3 py-3">
                        <UserAvatar userId={l.userId} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{getUser(l.userId)?.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">{l.type.replace("_"," ")} · {l.fromDate} → {l.toDate} · {l.reason}</p>
                        </div>
                        {s === "pending" && (<><Button size="sm" variant="outline" onClick={() => decide(l.id, "rejected")}>Reject</Button><Button size="sm" onClick={() => decide(l.id, "approved")}>Approve</Button></>)}
                      </li>
                    ))}
                  </ul>
                </TabsContent>
              ))}
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}
