import { useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { CompanyBadge } from "@/components/CompanyBadge";
import { ProjectStatusBadge, RiskBadge } from "@/components/StatusBadges";
import { UserAvatar, UserAvatarStack } from "@/components/UserAvatar";
import { useDataStore } from "@/lib/dataStore";
import { FolderKanban, LayoutGrid, Table as TableIcon, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Projects() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { projects, companies, getUser } = useDataStore();
  const [view, setView] = useState<"cards" | "table">("cards");
  const [company, setCompany] = useState<string>(params.get("company") ?? "all");
  const [status, setStatus] = useState<string>("all");
  const [risk, setRisk] = useState<string>("all");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => projects.filter((p) =>
    (company === "all" || p.companyId === company) &&
    (status === "all" || p.status === status) &&
    (risk === "all" || p.risk === risk) &&
    (!q || p.name.toLowerCase().includes(q.toLowerCase()))
  ), [projects, company, status, risk, q]);

  return (
    <div>
      <PageHeader
        title="Projects"
        description="All projects across Kiron Group entities."
        icon={<FolderKanban className="h-5 w-5" />}
        actions={
          <Button size="sm"><Plus className="h-4 w-4 mr-1.5" /> New project</Button>
        }
      />

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-card">
          <Input placeholder="Search projects..." className="h-9 max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={company} onValueChange={setCompany}>
            <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Company" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companies.map((c) => (<SelectItem key={c.id} value={c.id}>{c.shortName}</SelectItem>))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="planning">Planning</SelectItem>
              <SelectItem value="on_hold">On hold</SelectItem>
              <SelectItem value="at_risk">At risk</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={risk} onValueChange={setRisk}>
            <SelectTrigger className="h-9 w-32"><SelectValue placeholder="Risk" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risk</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>

          <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
            <button onClick={() => setView("cards")} className={`flex h-7 items-center gap-1.5 rounded px-2 text-xs ${view === "cards" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}><LayoutGrid className="h-3.5 w-3.5" /> Cards</button>
            <button onClick={() => setView("table")} className={`flex h-7 items-center gap-1.5 rounded px-2 text-xs ${view === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}><TableIcon className="h-3.5 w-3.5" /> Table</button>
          </div>
        </div>

        {view === "cards" ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => {
              const owner = getUser(p.ownerId);
              return (
                <button
                  key={p.id}
                  onClick={() => navigate(`/projects/${p.id}`)}
                  className="rounded-xl border border-border bg-surface p-4 text-left shadow-card transition hover:border-primary/40 hover:shadow-elevated"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CompanyBadge companyId={p.companyId} size="xs" />
                      <h3 className="mt-2 font-display text-base font-semibold leading-tight">{p.name}</h3>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                    </div>
                    <RiskBadge risk={p.risk} />
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <ProjectStatusBadge status={p.status} />
                    <span className="text-xs text-muted-foreground">Due {p.dueDate}</span>
                  </div>
                  <div className="mt-3">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${p.progress}%` }} />
                    </div>
                    <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                      <span>{p.progress}% complete</span>
                      <span>{p.memberIds.length} members</span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <UserAvatar userId={owner?.id} size="xs" />
                      <span className="text-xs text-muted-foreground">{owner?.name}</span>
                    </div>
                    <UserAvatarStack userIds={p.memberIds} max={3} size="xs" />
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 font-medium">Company</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Risk</th>
                  <th className="px-4 py-2.5 font-medium">Owner</th>
                  <th className="px-4 py-2.5 font-medium">Progress</th>
                  <th className="px-4 py-2.5 font-medium">Due</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted/40" onClick={() => navigate(`/projects/${p.id}`)}>
                    <td className="px-4 py-2.5 font-medium">{p.name}</td>
                    <td className="px-4 py-2.5"><CompanyBadge companyId={p.companyId} size="xs" /></td>
                    <td className="px-4 py-2.5"><ProjectStatusBadge status={p.status} /></td>
                    <td className="px-4 py-2.5"><RiskBadge risk={p.risk} /></td>
                    <td className="px-4 py-2.5"><div className="flex items-center gap-2"><UserAvatar userId={p.ownerId} size="xs" /><span className="text-xs">{getUser(p.ownerId)?.name}</span></div></td>
                    <td className="px-4 py-2.5"><div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${p.progress}%` }} /></div><span className="text-xs tabular-nums">{p.progress}%</span></div></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.dueDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
