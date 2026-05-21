import { PageHeader } from "@/components/PageHeader";
import { useDataStore } from "@/lib/dataStore";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { UserAvatar } from "@/components/UserAvatar";
import { MessageSquare, Send, Pin, Hash, Megaphone, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function Chat() {
  const { user } = useAuth();
  const { conversations, messages, getUser, refresh } = useDataStore();
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!active && conversations.length) setActive(conversations[0].id);
  }, [conversations, active]);

  const conv = conversations.find((c) => c.id === active);
  const convMsgs = messages.filter((m) => m.conversationId === active);

  const send = async () => {
    if (!user || !active || !draft.trim()) return;
    const { error } = await supabase.from("messages").insert({
      conversation_id: active, sender_id: user.id, body: draft.trim(),
    });
    if (error) toast.error(error.message);
    else { setDraft(""); refresh(); }
  };

  const groupKinds = [
    { key: "dm", label: "Direct messages", icon: MessageSquare },
    { key: "company_group", label: "Company groups", icon: Hash },
    { key: "team_group", label: "Team groups", icon: Users },
    { key: "project_group", label: "Project groups", icon: Hash },
    { key: "announcement", label: "Announcements", icon: Megaphone },
  ] as const;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Team Chat" description="Work-focused chat across Kiron Group." icon={<MessageSquare className="h-5 w-5" />} />
      <div className="grid flex-1 min-h-0 grid-cols-[260px_1fr_280px] divide-x divide-border bg-surface">
        {/* Left list */}
        <aside className="overflow-y-auto scrollbar-quiet p-3">
          {groupKinds.map(({ key, label, icon: Icon }) => {
            const items = conversations.filter((c) => c.kind === key);
            if (!items.length) return null;
            return (
              <div key={key} className="mb-4">
                <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><Icon className="h-3 w-3" /> {label}</div>
                <ul className="space-y-0.5">
                  {items.map((c) => (
                    <li key={c.id}>
                      <button onClick={() => setActive(c.id)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", active === c.id ? "bg-primary-soft text-primary" : "hover:bg-surface-muted")}>
                        <span className="truncate flex-1">{c.name}</span>
                        {c.unreadCount ? <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">{c.unreadCount}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {conversations.length === 0 && <p className="p-3 text-xs text-muted-foreground">No conversations yet.</p>}
        </aside>

        {/* Main */}
        <section className="flex min-h-0 flex-col">
          {conv ? (
            <>
              <div className="flex h-12 items-center gap-2 border-b border-border px-4">
                <Hash className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-display text-sm font-semibold">{conv.name}</h3>
                <span className="text-xs text-muted-foreground">· {conv.memberIds.length} members</span>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto scrollbar-quiet p-4">
                {convMsgs.map((m) => {
                  const u = getUser(m.senderId);
                  return (
                    <div key={m.id} className="flex gap-2.5">
                      <UserAvatar userId={m.senderId} size="sm" />
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2"><span className="text-sm font-semibold">{u?.name ?? "Unknown"}</span><span className="text-[10px] text-muted-foreground">{m.createdAt}</span></div>
                        <p className="text-sm">{m.body}</p>
                        {m.taskRefId && <span className="mt-1 inline-block rounded-md border border-border bg-surface-muted px-2 py-0.5 text-xs">🔗 Linked task</span>}
                      </div>
                    </div>
                  );
                })}
                {convMsgs.length === 0 && <p className="text-center text-xs text-muted-foreground">No messages yet — send one below.</p>}
              </div>
              <div className="border-t border-border p-3">
                <div className="flex gap-2">
                  <Input
                    placeholder={`Message ${conv.name}`}
                    className="h-9"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()}
                  />
                  <Button size="sm" className="gap-1.5" onClick={send}><Send className="h-4 w-4" /> Send</Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Select a conversation</div>
          )}
        </section>

        {/* Right */}
        <aside className="overflow-y-auto scrollbar-quiet p-4">
          {conv && (
            <>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Participants</h4>
              <ul className="mt-2 space-y-1.5">
                {conv.memberIds.map((id) => (
                  <li key={id} className="flex items-center gap-2"><UserAvatar userId={id} size="xs" /><span className="text-sm">{getUser(id)?.name ?? "—"}</span></li>
                ))}
              </ul>
              <h4 className="mt-5 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Pin className="h-3 w-3" /> Pinned notes</h4>
              <p className="mt-2 rounded-md bg-surface-muted p-2 text-xs">Standup at 10:30 daily. Blockers in #blockers.</p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
