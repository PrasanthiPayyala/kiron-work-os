import { PageHeader } from "@/components/PageHeader";
import { ApprovalStateBadge } from "@/components/StatusBadges";
import { UserAvatar } from "@/components/UserAvatar";
import { useDataStore } from "@/lib/dataStore";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function Approvals() {
  const { approvals, getUser, refresh } = useDataStore();
  const { user } = useAuth();

  const decide = async (id: string, status: "approved" | "rejected" | "returned") => {
    if (!user) return;
    const { error } = await supabase
      .from("approvals")
      .update({ status, decided_at: new Date().toISOString(), approver_id: user.id })
      .eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(`Approval ${status}`); refresh(); }
  };

  const groups = {
    pending: approvals.filter((a) => a.state === "pending"),
    approved: approvals.filter((a) => a.state === "approved"),
    rejected: approvals.filter((a) => a.state === "rejected"),
    returned: approvals.filter((a) => a.state === "returned"),
  };
  const routeLabel: Record<string, string> = { domain_only: "Domain only", domain_plus_manager: "Domain + Manager", domain_plus_founder: "Domain + Founder (critical)" };

  return (
    <div>
      <PageHeader title="Approvals" description="Tasks, content, projects, and leave routes." icon={<ShieldCheck className="h-5 w-5" />} />
      <div className="p-6">
        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Pending ({groups.pending.length})</TabsTrigger>
            <TabsTrigger value="approved">Approved ({groups.approved.length})</TabsTrigger>
            <TabsTrigger value="rejected">Rejected ({groups.rejected.length})</TabsTrigger>
            <TabsTrigger value="returned">Returned ({groups.returned.length})</TabsTrigger>
          </TabsList>
          {(Object.keys(groups) as (keyof typeof groups)[]).map((k) => (
            <TabsContent key={k} value={k} className="rounded-xl border border-border bg-surface shadow-card">
              <ul className="divide-y divide-border">
                {groups[k].length === 0 && <p className="p-6 text-sm text-muted-foreground">Nothing here.</p>}
                {groups[k].map((a) => (
                  <li key={a.id} className="flex items-center gap-3 p-4 hover:bg-surface-muted/40">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><span className="rounded-md bg-surface-muted px-2 py-0.5 text-xs capitalize">{a.kind.replace("_"," ")}</span>{a.route && <span className="rounded-md border border-border px-2 py-0.5 text-xs">{routeLabel[a.route]}</span>}<ApprovalStateBadge state={a.state} /></div>
                      <p className="mt-1 text-sm font-medium">{a.refLabel}</p>
                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><UserAvatar userId={a.requestedById} size="xs" /> {getUser(a.requestedById)?.name}</span>
                        <span>→</span>
                        <span className="flex items-center gap-1"><UserAvatar userId={a.approverId} size="xs" /> {getUser(a.approverId)?.name}</span>
                        <span>· {a.createdAt}</span>
                      </div>
                      {a.note && <p className="mt-1 text-xs italic text-muted-foreground">"{a.note}"</p>}
                    </div>
                    {k === "pending" && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => decide(a.id, "returned")}>Return</Button>
                        <Button size="sm" variant="outline" className="text-destructive" onClick={() => decide(a.id, "rejected")}>Reject</Button>
                        <Button size="sm" onClick={() => decide(a.id, "approved")}>Approve</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
