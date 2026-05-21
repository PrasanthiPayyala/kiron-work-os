import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { PageHeader } from "@/components/PageHeader";
import { CompanyBadge } from "@/components/CompanyBadge";
import { TaskStatusBadge, PriorityBadge } from "@/components/StatusBadges";
import { Briefcase } from "lucide-react";
import type { Task } from "@/types";

export default function MyWork() {
  const { user } = useAuth();
  const { tasks } = useDataStore();
  const mine = tasks.filter((t) => t.assigneeId === user?.id);
  const reviews = tasks.filter((t) => t.reviewerId === user?.id && (t.status === "waiting_review" || t.status === "waiting_approval"));

  return (
    <div>
      <PageHeader title="My Work" description="Everything assigned to you across Kiron Group." icon={<Briefcase className="h-5 w-5" />} />
      <div className="space-y-4 p-6">
        <Section title={`Assigned to me (${mine.length})`} items={mine} />
        <Section title={`Awaiting my review (${reviews.length})`} items={reviews} />
      </div>
    </div>
  );
}

function Section({ title, items }: { title: string; items: Task[] }) {
  return (
    <div className="rounded-xl border border-border bg-surface shadow-card">
      <div className="border-b border-border p-4"><h3 className="font-display text-sm font-semibold">{title}</h3></div>
      <ul className="divide-y divide-border">
        {items.length === 0 && <p className="p-6 text-sm text-muted-foreground text-center">Nothing here.</p>}
        {items.map((t) => (
          <li key={t.id} className="flex items-center gap-3 p-3.5 hover:bg-surface-muted/40">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{t.key} · {t.title}</p>
              <div className="mt-1 flex items-center gap-2"><CompanyBadge companyId={t.companyId} size="xs" /><PriorityBadge priority={t.priority} /><TaskStatusBadge status={t.status} /></div>
            </div>
            <span className="text-xs text-muted-foreground">{t.dueDate ?? "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
