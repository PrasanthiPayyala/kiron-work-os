import { PageHeader } from "@/components/PageHeader";
import { Crown, Briefcase, Trophy, FileSignature, ClipboardList, ScrollText, AlertCircle, FolderOpen, Bell, Lock } from "lucide-react";
import { StatCard } from "@/components/StatCard";

const sections = [
  { key: "bids", title: "Bids", icon: Briefcase, items: [
    { name: "MoHFW Hospital Tech RFP", status: "Drafting", due: "in 4 days" },
    { name: "TN Tourism vendor bid", status: "Submitted", due: "evaluating" },
  ]},
  { key: "hackathons", title: "Hackathons", icon: Trophy, items: [
    { name: "Smart India Hackathon 2025", status: "Team confirmed", due: "Sep 12" },
    { name: "TANCAM Wellness Hack", status: "Idea phase", due: "Oct 02" },
  ]},
  { key: "registrations", title: "Registrations", icon: ClipboardList, items: [
    { name: "Startup India recognition — Glowgevity", status: "In review", due: "—" },
    { name: "MSME Udyam — Tranquila360", status: "Approved", due: "✓" },
  ]},
  { key: "applications", title: "Applications", icon: FolderOpen, items: [
    { name: "NIDHI EIR — Innomax Startup", status: "Submitted", due: "Aug 25" },
  ]},
  { key: "mou", title: "MoUs", icon: FileSignature, items: [
    { name: "Apollo Healtour partnership", status: "v3 in legal", due: "Aug 20" },
    { name: "SGH–Tropica package", status: "Signed", due: "✓" },
  ]},
  { key: "compliance", title: "Compliance deadlines", icon: ScrollText, items: [
    { name: "GST September filing", status: "On track", due: "in 3 days" },
    { name: "ROC annual return — 4 entities", status: "Pending", due: "Sep 30" },
  ]},
  { key: "escalations", title: "Escalation tracker", icon: AlertCircle, items: [
    { name: "SGH-018 vendor delay", status: "Escalated to Founders", due: "today" },
  ]},
  { key: "docs", title: "Documentation queue", icon: FolderOpen, items: [
    { name: "Q3 strategy deck", status: "Awaiting Founder review", due: "in 2 days" },
  ]},
  { key: "reminders", title: "Founder reminders", icon: Bell, items: [
    { name: "Investor call · Wednesday 11:00", status: "Calendar set", due: "Wed" },
  ]},
  { key: "private", title: "Private planning", icon: Lock, items: [
    { name: "FY26 expansion plan", status: "Confidential", due: "—" },
  ]},
];

export default function FounderOffice() {
  return (
    <div>
      <PageHeader title="Founder Office Control Center" description="Restricted to Founders, Coordinator, and Support." icon={<Crown className="h-5 w-5" />} />
      <div className="space-y-4 p-6">
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Open bids" value={2} accent="primary" />
          <StatCard label="Active MoUs" value={2} accent="accent" />
          <StatCard label="Compliance due (7d)" value={3} accent="warning" />
          <StatCard label="Escalations" value={1} accent="destructive" />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.key} className="rounded-xl border border-border bg-surface p-4 shadow-card">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-soft text-primary"><Icon className="h-4 w-4" /></span>
                  <h3 className="font-display text-sm font-semibold">{s.title}</h3>
                </div>
                <ul className="divide-y divide-border">
                  {s.items.map((it, idx) => (
                    <li key={idx} className="flex items-center justify-between py-2">
                      <div className="min-w-0"><p className="truncate text-sm font-medium">{it.name}</p><p className="text-xs text-muted-foreground">{it.status}</p></div>
                      <span className="text-xs text-muted-foreground">{it.due}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
