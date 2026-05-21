import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Paperclip, Mail as MailIcon, Filter } from "lucide-react";
import type { EmailMessage } from "@/lib/mail/types";

interface Props {
  messages: EmailMessage[];
  selectedId: string | null;
  onSelect: (m: EmailMessage) => void;
  search: string;
  onSearchChange: (s: string) => void;
  filterUnread: boolean;
  onToggleUnread: () => void;
  filterAttachments: boolean;
  onToggleAttachments: () => void;
}

function timeLabel(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function MessageList({
  messages, selectedId, onSelect, search, onSearchChange,
  filterUnread, onToggleUnread, filterAttachments, onToggleAttachments,
}: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b border-border bg-surface p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search mail…"
            className="h-9 pl-8"
          />
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <Button
            variant={filterUnread ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={onToggleUnread}
          >Unread</Button>
          <Button
            variant={filterAttachments ? "default" : "outline"}
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={onToggleAttachments}
          >
            <Paperclip className="h-3 w-3" /> Attachments
          </Button>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {messages.length} message{messages.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <MailIcon className="mx-auto mb-3 h-8 w-8 opacity-40" />
            No messages.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {messages.map((m) => {
              const active = m.id === selectedId;
              const senderName = m.from_name || m.from_address || "(unknown)";
              return (
                <li key={m.id}>
                  <button
                    onClick={() => onSelect(m)}
                    className={cn(
                      "flex w-full flex-col gap-1 px-4 py-3 text-left transition",
                      active ? "bg-primary-soft" : "hover:bg-muted/60",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {!m.is_read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                      <span className={cn("truncate text-sm", !m.is_read ? "font-semibold" : "font-medium")}>
                        {senderName}
                      </span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                        {timeLabel(m.received_at || m.sent_at)}
                      </span>
                    </div>
                    <p className={cn("truncate text-sm", !m.is_read ? "text-foreground" : "text-muted-foreground")}>
                      {m.subject || "(no subject)"}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-xs text-muted-foreground">{m.snippet}</p>
                      {m.has_attachments && <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
