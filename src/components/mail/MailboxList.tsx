import { cn } from "@/lib/utils";
import { Inbox, Send, FileEdit, Star, Archive, Trash2, Folder } from "lucide-react";
import { CompanyBadge } from "@/components/CompanyBadge";
import type { EmailAccount, EmailFolder } from "@/lib/mail/types";

interface Props {
  accounts: EmailAccount[];
  folders: EmailFolder[];
  selectedAccount: string | null;
  selectedFolder: string | null;
  onSelectAccount: (id: string) => void;
  onSelectFolder: (id: string | null) => void;
}

function folderIcon(role: string | null, name: string) {
  const r = (role || name).toLowerCase();
  if (r.includes("inbox")) return Inbox;
  if (r.includes("sent")) return Send;
  if (r.includes("draft")) return FileEdit;
  if (r.includes("star") || r.includes("flag")) return Star;
  if (r.includes("archive")) return Archive;
  if (r.includes("trash") || r.includes("bin")) return Trash2;
  return Folder;
}

export function MailboxList({
  accounts, folders, selectedAccount, selectedFolder, onSelectAccount, onSelectFolder,
}: Props) {
  return (
    <aside className="flex h-full min-h-0 flex-col overflow-y-auto bg-surface">
      <div className="border-b border-border p-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Mailboxes</p>
        <ul className="space-y-0.5">
          {accounts.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => onSelectAccount(a.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition",
                  selectedAccount === a.id ? "bg-primary-soft text-primary" : "hover:bg-muted",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{a.display_name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{a.email}</p>
                </div>
                {a.company_id && <CompanyBadge companyId={a.company_id} size="xs" />}
                <span className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  a.status === "connected" ? "bg-emerald-500" :
                  a.status === "syncing" ? "bg-blue-500 animate-pulse" :
                  a.status === "failed" || a.status === "needs_reauth" ? "bg-red-500" :
                  "bg-muted-foreground"
                )} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex-1 p-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Folders</p>
        {folders.length === 0 && (
          <p className="text-xs text-muted-foreground">No folders synced yet.</p>
        )}
        <ul className="space-y-0.5">
          {folders.map((f) => {
            const Icon = folderIcon(f.role, f.name);
            const active = selectedFolder === f.id;
            return (
              <li key={f.id}>
                <button
                  onClick={() => onSelectFolder(f.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition",
                    active ? "bg-primary-soft text-primary" : "hover:bg-muted",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{f.name}</span>
                  {f.unread_count > 0 && (
                    <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                      {f.unread_count}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
