// Focused view of the project's group chat, mounted in the Project
// Detail → Discussion tab. Uses the same conversation the main /chat
// page shows under "Project groups" — no separate stream, no separate
// message store. Everything reuses dataStore + api.sendMessage.
//
// Deliberately no member sidebar or new-conversation dialog: the Team
// tab already handles membership + adding/removing members mirrors
// into this chat via the backend.
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Send, Loader2, Paperclip, X, FileText, Download, MessageSquare } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { api, ApiError, type AttachmentRow } from "@/lib/api";
import { mapMessage } from "@/lib/mappers";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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

export function ProjectDiscussion({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { conversations, messages, getUser, addMessage, markConversationReadLocal } = useDataStore();

  // Look up the project's chat via projectId. Bootstrap already returns
  // conversations.project_id, so this is a local Map lookup — no fetch.
  const conv = useMemo(
    () => conversations.find((c) => c.projectId === projectId && c.kind === "project_group"),
    [conversations, projectId],
  );

  const convMsgs = useMemo(
    () => (conv ? messages.filter((m) => m.conversationId === conv.id) : []),
    [messages, conv],
  );

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<AttachmentRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mark the project conversation read on open and on every new inbound
  // message, same as the main Chat page and the dock. Patches lastReadAt
  // locally instead of calling refresh() — a full dataStore bootstrap
  // on every message re-rendered the whole app, which on this page (an
  // outer scrollable <main>) was visible as the page jumping back to
  // the top every time a message arrived.
  useEffect(() => {
    if (!conv?.id) return;
    const readAt = new Date().toISOString();
    void api.markConversationRead(conv.id)
      .then(() => markConversationReadLocal(conv.id, readAt))
      .catch(() => {});
  }, [conv?.id, convMsgs.length, markConversationReadLocal]);

  // Auto-scroll on new content. Scoped to the internal message list only
  // (scrollRef points at the overflow-y-auto div, not the page).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [convMsgs.length]);

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

  const send = async () => {
    if (!user || !conv) return;
    if (!draft.trim() && pending.length === 0) return;
    setSending(true);
    try {
      const sent = await api.sendMessage({
        conversation_id: conv.id,
        body: draft.trim(),
        attachment_ids: pending.map((a) => a.id),
      });
      setDraft("");
      setPending([]);
      addMessage(mapMessage(sent as Parameters<typeof mapMessage>[0]));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  // Older projects created before migration 0038 got a conversation via
  // backfill — they should always have one now. But an admin might have
  // manually deleted the conversation, so guard the empty case.
  if (!conv) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <MessageSquare className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">No discussion channel yet</p>
        <p className="max-w-md text-xs text-muted-foreground">
          This project doesn't have a group chat attached. New projects create one
          automatically — for this one, ask an admin to recreate it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[520px] flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <MessageSquare className="h-4 w-4 text-primary" />
        <h4 className="font-display text-sm font-semibold">Project discussion</h4>
        <span className="text-xs text-muted-foreground">· {conv.memberIds.length} members</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          Also visible in Team Chat under <b>Project groups</b>
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto scrollbar-quiet p-4">
        {convMsgs.length === 0 && (
          <p className="mt-10 text-center text-xs text-muted-foreground">
            No messages yet — kick off the project discussion below.
          </p>
        )}
        {convMsgs.map((m) => {
          const u = getUser(m.senderId);
          const isMine = m.senderId === user?.id;
          const isDeleted = !!m.deletedAt;
          return (
            <div key={m.id} className={cn("flex gap-2.5", isMine && "flex-row-reverse")}>
              <UserAvatar userId={m.senderId} size="sm" />
              <div className={cn("max-w-[70%]", isMine && "items-end")}>
                <div className={cn("flex items-baseline gap-2", isMine && "justify-end")}>
                  <span className="text-sm font-semibold">{u?.name ?? "Unknown"}</span>
                  <span className="text-[10px] text-muted-foreground">{formatTime(m.createdAt)}</span>
                </div>
                {isDeleted ? (
                  <p className="mt-1 inline-block whitespace-pre-wrap rounded-lg bg-surface-muted px-3 py-2 text-sm italic text-muted-foreground">
                    This message was deleted
                  </p>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border p-3">
        {pending.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {pending.map((a) => (
              <li key={a.id} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-muted px-2 py-1 text-xs">
                <Paperclip className="h-3 w-3" />
                <span className="max-w-[160px] truncate" title={a.file_name}>{a.file_name}</span>
                <span className="text-muted-foreground">{formatBytes(a.file_size)}</span>
                <button onClick={() => setPending((p) => p.filter((x) => x.id !== a.id))} className="ml-1 text-muted-foreground hover:text-destructive">
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
              onChange={(e) => { void handleUpload(e.target.files); e.target.value = ""; }}
            />
          </label>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder="Message the project team…"
            className="h-9 flex-1"
            disabled={sending}
          />
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => void send()}
            disabled={sending || (!draft.trim() && pending.length === 0)}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
