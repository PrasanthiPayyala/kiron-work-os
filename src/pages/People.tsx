import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { CompanyBadge } from "@/components/CompanyBadge";
import { useDataStore } from "@/lib/dataStore";
import { roleLabel } from "@/lib/auth";
import { Users, LayoutGrid, Table as TableIcon } from "lucide-react";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNavigate } from "react-router-dom";

export default function People() {
  const navigate = useNavigate();
  const { users, getUser, companies } = useDataStore();
  const [view, setView] = useState<"cards"|"table">("cards");
  const [q, setQ] = useState("");
  const [company, setCompany] = useState("all");

  const filtered = useMemo(() => users.filter((u) =>
    (company === "all" || u.homeCompanyId === company) &&
    (!q || u.name.toLowerCase().includes(q.toLowerCase()) || u.designation.toLowerCase().includes(q.toLowerCase()))
  ), [q, company]);

  return (
    <div>
      <PageHeader title="People" description="Directory across all Kiron Group companies." icon={<Users className="h-5 w-5" />} />
      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-card">
          <Input placeholder="Search by name or role..." value={q} onChange={(e) => setQ(e.target.value)} className="h-9 max-w-xs" />
          <Select value={company} onValueChange={setCompany}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.shortName}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
            <button onClick={() => setView("cards")} className={`flex h-7 items-center gap-1.5 rounded px-2 text-xs ${view === "cards" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}><LayoutGrid className="h-3.5 w-3.5" /> Cards</button>
            <button onClick={() => setView("table")} className={`flex h-7 items-center gap-1.5 rounded px-2 text-xs ${view === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}><TableIcon className="h-3.5 w-3.5" /> Table</button>
          </div>
        </div>

        {view === "cards" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((u) => (
              <button key={u.id} onClick={() => navigate(`/people/${u.id}`)} className="rounded-xl border border-border bg-surface p-4 text-left shadow-card transition hover:border-primary/40">
                <div className="flex items-center gap-3"><UserAvatar userId={u.id} size="lg" /><div className="min-w-0"><p className="truncate font-display font-semibold">{u.name}</p><p className="truncate text-xs text-muted-foreground">{u.designation}</p></div></div>
                <div className="mt-3 flex items-center justify-between"><CompanyBadge companyId={u.homeCompanyId} size="xs" /><span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">{u.productivityScore}%</span></div>
                <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">{roleLabel(u.role)}</p>
              </button>
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Name</th><th className="px-4 py-2.5 font-medium">Designation</th><th className="px-4 py-2.5 font-medium">Company</th><th className="px-4 py-2.5 font-medium">Manager</th><th className="px-4 py-2.5 font-medium">Score</th>
              </tr></thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted/40" onClick={() => navigate(`/people/${u.id}`)}>
                    <td className="px-4 py-2.5"><div className="flex items-center gap-2"><UserAvatar userId={u.id} size="sm" /><span className="font-medium">{u.name}</span></div></td>
                    <td className="px-4 py-2.5">{u.designation}</td>
                    <td className="px-4 py-2.5"><CompanyBadge companyId={u.homeCompanyId} size="xs" /></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{getUser(u.reportingManagerId)?.name ?? "—"}</td>
                    <td className="px-4 py-2.5"><span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">{u.productivityScore ?? "—"}%</span></td>
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
