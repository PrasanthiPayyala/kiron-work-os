import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useDataStore } from "@/lib/dataStore";
import { useAuth } from "@/lib/auth";
import { api, ApiError, type AttachmentRow } from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  MessageSquare, Send, Hash, Megaphone, Users, Plus, Paperclip,
  Download, X, UserPlus, Loader2, FileText,
} from "lucide-react";
import type { Conversation } from "@/types";

const groupKinds = [
  { key: "dm", label: "Direct messages", icon: MessageSquare },
  { key: "company_group", label: "Company groups", icon: Hash },
  { key: "team_group", label: "Team groups", icon: Users },
  { key: "project_group", label: "Project groups", icon: Hash },
  { key: "announcement", label: "Announcements", icon: Megaphone },
] as const;

function formatBytes(n?: number | null) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function unreadCountFor(conv: Conversation, msgsForConv: { senderId: string; createdAt: string }[], userId?: string) {
  if (!conv.lastReadAt) return msgsForConv.filter((m) => m.senderId !== userId).length;
  const t = new Date(conv.lastReadAt).getTime();
  return msgsForConv.filter((m) => m.senderId !== userId && new Date(m.createdAt).getTime() > t).length;
}

export default function Chat() {
  const { user } = useAuth();
  const { conversations, messages, users, getUser, refresh } = useDataStore();
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<AttachmentRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [newConvOpen, setNewConvOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Default-select the first conversation on mount.
  useEffect(() => {
    if (!active && conversations.length) setActive(conversations[0].id);
  }, [conversations, active]);

  const conv = conversations.find((c) => c.id === active);
  const convMsgs = useMemo(
    () => messages.filter((m) => m.conversationId === active),
    [messages, active],
  );

  // Mark this conversation read whenever the user looks at it (initial open
  // and every time a new live message arrives in the active conv).
  useEffect(() => {
    if (!active) return;
    void api.markConversationRead(active).then(refresh).catch(() => {});
  }, [active, convMsgs.length, refresh]);

  // Auto-scroll the message list to the bottom on new content.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [convMsgs.length, active]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(Array.from(files).map((f) => api.uploadFile(f)));
      setPending((p) => [...p, ...uploaded]);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removePending = (id: string) => setPending((p) => p.filter((a) => a.id !== id));

  const send = async () => {
    if (!user || !active) return;
    if (!draft.trim() && pending.length === 0) return;
    setSending(true);
    try {
      await api.sendMessage({
        conversation_id: active,
        body: draft.trim(),
        attachment_ids: pending.map((a) => a.id),
      });
      setDraft("");
      setPending([]);
      // The WS broadcast will land for other tabs; we also refresh so this
      // tab's bootstrap-based store includes the new row immediately.
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Team Chat"
        description="DMs, groups, and file transfers — all in-app."
        icon={<MessageSquare className="h-5 w-5" />}
        actions={
          <Button size="sm" onClick={() => setNewConvOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New conversation
          </Button>
        }
      />

      <div className="grid flex-1 min-h-0 grid-cols-[260px_1fr_280px] divide-x divide-border bg-surface">
        {/* Left: conversation list */}
        <aside className="overflow-y-auto scrollbar-quiet p-3">
          {groupKinds.map(({ key, label, icon: Icon }) => {
            const items = conversations.filter((c) => c.kind === key);
            if (!items.length) return null;
            return (
              <div key={key} className="mb-4">
                <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Icon className="h-3 w-3" /> {label}
                </div>
                <ul className="space-y-0.5">
                  {items.map((c) => {
                    const cMsgs = messages.filter((m) => m.conversationId === c.id);
                    const unread = unreadCountFor(c, cMsgs, user?.id);
                    const displayName =
                      c.kind === "dm"
                        ? getUser(c.memberIds.find((id) => id !== user?.id))?.name ?? c.name
                        : c.name;
                    return (
                      <li key={c.id}>
                        <button
                          onClick={() => setActive(c.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                            active === c.id ? "bg-primary-soft text-primary" : "hover:bg-surface-muted",
                          )}
                        >
                          <span className={cn("truncate flex-1", unread > 0 && active !== c.id && "font-semibold")}>
                            {displayName}
                          </span>
                          {unread > 0 && active !== c.id && (
                            <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                              {unread}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {conversations.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No conversations yet. Click <b>New conversation</b> to start one.
            </p>
          )}
        </aside>

        {/* Center: messages */}
        <section className="flex min-h-0 flex-col">
          {conv ? (
            <>
              <div className="flex h-12 items-center gap-2 border-b border-border px-4">
                <Hash className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-display text-sm font-semibold">
                  {conv.kind === "dm"
                    ? getUser(conv.memberIds.find((id) => id !== user?.id))?.name ?? conv.name
                    : conv.name}
                </h3>
                <span className="text-xs text-muted-foreground">· {conv.memberIds.length} members</span>
              </div>

              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto scrollbar-quiet p-4">
                {convMsgs.length === 0 && (
                  <p className="text-center text-xs text-muted-foreground">
                    No messages yet — send one below.
                  </p>
                )}
                {convMsgs.map((m) => {
                  const u = getUser(m.senderId);
                  const isMine = m.senderId === user?.id;
                  return (
                    <div key={m.id} className={cn("flex gap-2.5", isMine && "flex-row-reverse")}>
                      <UserAvatar userId={m.senderId} size="sm" />
                      <div className={cn("max-w-[70%] flex-1", isMine && "items-end")}>
                        <div className={cn("flex items-baseline gap-2", isMine && "justify-end")}>
                          <span className="text-sm font-semibold">{u?.name ?? "Unknown"}</span>
                          <span className="text-[10px] text-muted-foreground">{formatTime(m.createdAt)}</span>
                        </div>
                        {m.body && (
                          <p className={cn(
                            "mt-1 inline-block whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                            isMine ? "bg-primary text-primary-foreground" : "bg-surface-muted",
                          )}>
                            {m.body}
                          </p>
                        )}
                        {m.attachments && m.attachments.length > 0 && (
                          <ul className="mt-1.5 space-y-1.5">
                            {m.attachments.map((a) => (
                              <li
                                key={a.id}
                                className="flex items-center gap-2 rounded-md border border-border bg-surface p-2 text-sm shadow-sm"
                              >
                                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <span className="flex-1 truncate" title={a.fileName}>{a.fileName}</span>
                                <span className="text-[11px] text-muted-foreground">{formatBytes(a.fileSize)}</span>
                                <button
                                  onClick={() => void api.downloadFile(a.id, a.fileName)}
                                  className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                                  title="Download"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Composer */}
              <div className="border-t border-border p-3">
                {pending.length > 0 && (
                  <ul className="mb-2 flex flex-wrap gap-1.5">
                    {pending.map((a) => (
                      <li key={a.id} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-muted px-2 py-1 text-xs">
                        <Paperclip className="h-3 w-3" />
                        <span className="max-w-[160px] truncate" title={a.file_name}>{a.file_name}</span>
                        <span className="text-muted-foreground">{formatBytes(a.file_size)}</span>
                        <button onClick={() => removePending(a.id)} className="ml-1 text-muted-foreground hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-end gap-2">
                  <label className={cn(
                    "flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border hover:bg-surface-muted",
                    uploading && "pointer-events-none opacity-50",
                  )} title="Attach file(s)">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                    <input
                      type="file"
                      multiple
                      hidden
                      onChange={(e) => { handleUpload(e.target.files); e.target.value = ""; }}
                    />
                  </label>
                  <Input
                    placeholder={`Message ${conv.kind === "dm" ? getUser(conv.memberIds.find((id) => id !== user?.id))?.name ?? "" : conv.name}`}
                    className="h-9 flex-1"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                    disabled={sending}
                  />
                  <Button size="sm" className="gap-1.5" onClick={() => void send()} disabled={sending || (!draft.trim() && pending.length === 0)}>
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Select a conversation, or start a new one.
            </div>
          )}
        </section>

        {/* Right: members panel */}
        <aside className="overflow-y-auto scrollbar-quiet p-4">
          {conv && (
            <ConversationMembers convId={conv.id} memberIds={conv.memberIds} isGroup={conv.kind !== "dm"} />
          )}
        </aside>
      </div>

      <NewConversationDialog
        open={newConvOpen}
        onClose={() => setNewConvOpen(false)}
        onCreated={(id) => { setActive(id); refresh(); }}
      />
    </div>
  );
}

// ----------------- Conversation members + add -----------------

function ConversationMembers({ convId, memberIds, isGroup }: { convId: string; memberIds: string[]; isGroup: boolean }) {
  const { users, getUser, refresh } = useDataStore();
  const { user } = useAuth();
  const [adding, setAdding] = useState(false);

  const candidates = useMemo(
    () => users.filter((u) => !memberIds.includes(u.id)),
    [users, memberIds],
  );

  const add = async (uid: string) => {
    setAdding(true);
    try {
      await api.addConversationMember(convId, uid);
      toast.success(`Added ${getUser(uid)?.name ?? "member"}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to add member");
    } finally {
      setAdding(false);
    }
  };

  const remove = async (uid: string) => {
    try {
      await api.removeConversationMember(convId, uid);
      toast.success("Removed");
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to remove");
    }
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Members ({memberIds.length})
        </h4>
        {isGroup && (
          <Popover>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Add member">
                <UserPlus className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-0">
              <div className="border-b border-border px-3 py-2 text-xs font-semibold">Add to conversation</div>
              <ul className="max-h-72 overflow-y-auto">
                {candidates.length === 0 && (
                  <li className="px-3 py-3 text-xs text-muted-foreground">Everyone's already here.</li>
                )}
                {candidates.map((u) => (
                  <li
                    key={u.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-surface-muted",
                      adding && "pointer-events-none opacity-50",
                    )}
                    onClick={() => void add(u.id)}
                  >
                    <UserAvatar userId={u.id} size="xs" />
                    <span className="flex-1 truncate">{u.name}</span>
                    <span className="text-[11px] text-muted-foreground">{u.designation}</span>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        )}
      </div>
      <ul className="mt-2 space-y-1.5">
        {memberIds.map((id) => {
          const u = getUser(id);
          return (
            <li key={id} className="flex items-center gap-2">
              <UserAvatar userId={id} size="xs" />
              <span className="flex-1 truncate text-sm">{u?.name ?? "—"}</span>
              {isGroup && id !== user?.id && (
                <button
                  onClick={() => void remove(id)}
                  className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-destructive"
                  title="Remove from conversation"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ----------------- New conversation dialog -----------------

function NewConversationDialog({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { users } = useDataStore();
  const { user } = useAuth();
  const [tab, setTab] = useState<"dm" | "group">("dm");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) { setSelected(new Set()); setTitle(""); setQ(""); setTab("dm"); }
  }, [open]);

  const candidates = useMemo(() => {
    const haystack = q.toLowerCase();
    return users
      .filter((u) => u.id !== user?.id)
      .filter((u) => !haystack || u.name.toLowerCase().includes(haystack) || u.email.toLowerCase().includes(haystack));
  }, [users, user, q]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      if (tab === "dm" && next.size > 1) {
        next.clear();
        next.add(id);
      }
      return next;
    });
  };

  const create = async () => {
    if (selected.size === 0) return toast.error("Pick at least one person");
    if (tab === "group" && !title.trim()) return toast.error("Group needs a name");
    setBusy(true);
    try {
      const result = await api.createConversation({
        channel_type: tab === "dm" ? "direct" : "team_group",
        title: tab === "group" ? title.trim() : null,
        member_ids: Array.from(selected),
      });
      if (result.reused) toast.info("Opened existing conversation");
      onCreated(result.id);
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not create conversation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => { setTab(v as "dm" | "group"); setSelected(new Set()); }}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="dm">Direct message</TabsTrigger>
            <TabsTrigger value="group">Group</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "group" && (
          <div className="mt-2">
            <Label className="text-xs">Group name</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Ops daily, Q3 launch, …"
              className="mt-1 h-9"
            />
          </div>
        )}

        <div className="mt-2">
          <Label className="text-xs">{tab === "dm" ? "Recipient" : `Members (${selected.size})`}</Label>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search teammates by name or email"
            className="mt-1 h-9"
          />
          <ul className="mt-2 max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {candidates.map((u) => {
              const checked = selected.has(u.id);
              return (
                <li
                  key={u.id}
                  onClick={() => toggle(u.id)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm",
                    checked ? "bg-primary-soft" : "hover:bg-surface-muted",
                  )}
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggle(u.id)} />
                  <UserAvatar userId={u.id} size="xs" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{u.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{u.designation} · {u.email}</p>
                  </div>
                </li>
              );
            })}
            {candidates.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-muted-foreground">No one matches.</li>
            )}
          </ul>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={create} disabled={busy || selected.size === 0}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
