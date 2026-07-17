// Floating chat dock — small bottom-right bubble that expands into a
// mini chat panel. Complements /chat (full page) so people can reply
// to a teammate without navigating away from Tasks / Projects / etc.
//
// Reuses the same dataStore + API as Chat.tsx — no separate WS, no
// separate cache. When the user opens the full Chat page the dock
// stays out of the way (returns null on that route).
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MessageSquare, X, Send, ChevronLeft, Loader2, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth, roleNavAccess } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { api, ApiError } from "@/lib/api";
import { mapMessage } from "@/lib/mappers";
import { useUnreadChatCount } from "@/hooks/useUnreadChatCount";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOnlineStatus } from "@/lib/pwa";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types";

const DOCK_STORAGE_KEY = "kiron.chatDock.open";

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function unreadFor(conv: Conversation, msgs: { senderId: string; createdAt: string; deletedAt?: string | null }[], userId: string) {
  const t = conv.lastReadAt ? new Date(conv.lastReadAt).getTime() : 0;
  return msgs.filter((m) => m.senderId !== userId && !m.deletedAt && new Date(m.createdAt).getTime() > t).length;
}

export default function ChatDock() {
  const { user } = useAuth();
  const { conversations, messages, getUser, refresh, addMessage } = useDataStore();
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnlineStatus();
  const unread = useUnreadChatCount();

  // Persist open/closed across navigation. Default: closed on mount so
  // the dock doesn't spring open unexpectedly, but if the user opened it
  // last session we honour that.
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(DOCK_STORAGE_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(DOCK_STORAGE_KEY, open ? "1" : "0"); } catch { /* noop */ }
  }, [open]);

  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hide dock on the /chat page (redundant with full page), and for
  // users whose role doesn't include the chat capability. Nothing to
  // render when offline either — the WS is down and sends would fail.
  const hasChatAccess = !!user && roleNavAccess[user.role].includes("chat");
  const onChatPage = location.pathname === "/chat" || location.pathname.startsWith("/chat/");
  const shouldRender = !!user && hasChatAccess && !onChatPage && online;

  // Ordered conversation list for the dock — user's own conversations
  // only (never the audit "team chats" for elevated roles — dock is for
  // quick replies, not for peeking at others' rooms). Newest activity
  // first. Cap to 20 so the panel isn't a scroll-fest.
  const dockConversations = useMemo(() => {
    if (!user) return [];
    return conversations
      .filter((c) => c.memberIds.includes(user.id))
      .slice()
      .sort((a, b) => {
        const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return tb - ta;
      })
      .slice(0, 20);
  }, [conversations, user]);

  const conv = activeConv ? conversations.find((c) => c.id === activeConv) : null;
  const convMsgs = useMemo(
    () => messages.filter((m) => m.conversationId === activeConv).slice(-50),
    [messages, activeConv],
  );

  // Mark active conv read whenever the user opens it or a new message
  // arrives while it's showing. Same behaviour as the full Chat page so
  // the badge stays consistent across surfaces.
  useEffect(() => {
    if (!activeConv || !open) return;
    void api.markConversationRead(activeConv).then(refresh).catch(() => {});
  }, [activeConv, convMsgs.length, open, refresh]);

  // Auto-scroll on new content, but only while the thread view is
  // showing (avoids yanking the list view when a background message
  // lands in another conversation).
  useEffect(() => {
    const el = scrollRef.current;
    if (el && activeConv) el.scrollTop = el.scrollHeight;
  }, [convMsgs.length, activeConv]);

  const send = async () => {
    if (!user || !activeConv || !draft.trim()) return;
    setSending(true);
    try {
      const sent = await api.sendMessage({
        conversation_id: activeConv,
        body: draft.trim(),
        attachment_ids: [],
      });
      setDraft("");
      addMessage(mapMessage(sent as Parameters<typeof mapMessage>[0]));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  if (!shouldRender) return null;

  return (
    <>
      {/* Collapsed bubble — always the initial state. Click to expand. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105 hover:shadow-xl"
          aria-label={unread > 0 ? `Open chat — ${unread} unread` : "Open chat"}
          title="Team chat"
        >
          <MessageSquare className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-primary-foreground ring-2 ring-background">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      )}

      {/* Expanded panel — single-column, list ↔ thread via a back arrow. */}
      {open && (
        <div className="fixed bottom-4 right-4 z-40 flex h-[520px] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          {/* Header */}
          <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-surface-muted px-3">
            {conv ? (
              <button
                type="button"
                onClick={() => setActiveConv(null)}
                className="rounded-md p-1 text-muted-foreground hover:bg-surface"
                title="Back to conversations"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            ) : (
              <MessageSquare className="h-4 w-4 text-primary" />
            )}
            <h3 className="flex-1 truncate font-display text-sm font-semibold">
              {conv
                ? (conv.kind === "dm"
                    ? getUser(conv.memberIds.find((id) => id !== user?.id))?.name ?? conv.name
                    : conv.name)
                : "Team chat"}
            </h3>
            <button
              type="button"
              onClick={() => navigate("/chat")}
              className="rounded-md p-1 text-muted-foreground hover:bg-surface"
              title="Open full Chat page"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-surface"
              aria-label="Close chat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body — either conversation list or the active thread */}
          {!conv ? (
            <div className="flex-1 overflow-y-auto scrollbar-quiet">
              {dockConversations.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                  <p className="text-sm text-muted-foreground">No conversations yet.</p>
                  <Button size="sm" variant="outline" onClick={() => navigate("/chat")}>
                    Start one on the full Chat page
                  </Button>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {dockConversations.map((c) => {
                    if (!user) return null;
                    const cMsgs = messages.filter((m) => m.conversationId === c.id);
                    const n = unreadFor(c, cMsgs, user.id);
                    const displayName = c.kind === "dm"
                      ? getUser(c.memberIds.find((id) => id !== user.id))?.name ?? c.name
                      : c.name;
                    const lastMsg = cMsgs.length > 0 ? cMsgs[cMsgs.length - 1] : null;
                    const otherId = c.kind === "dm" ? c.memberIds.find((id) => id !== user.id) : undefined;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setActiveConv(c.id)}
                          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-muted"
                        >
                          {otherId ? (
                            <UserAvatar userId={otherId} size="sm" />
                          ) : (
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                              <MessageSquare className="h-4 w-4" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <p className={cn("truncate text-sm", n > 0 && "font-semibold")}>{displayName}</p>
                              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                                {lastMsg ? formatTime(lastMsg.createdAt) : ""}
                              </span>
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {lastMsg?.body || c.lastMessagePreview || "No messages yet"}
                            </p>
                          </div>
                          {n > 0 && (
                            <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                              {n > 9 ? "9+" : n}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto scrollbar-quiet p-3">
                {convMsgs.length === 0 && (
                  <p className="mt-4 text-center text-xs text-muted-foreground">
                    No messages yet — send one below.
                  </p>
                )}
                {convMsgs.map((m) => {
                  const u = getUser(m.senderId);
                  const isMine = m.senderId === user?.id;
                  const isDeleted = !!m.deletedAt;
                  return (
                    <div key={m.id} className={cn("flex gap-2", isMine && "flex-row-reverse")}>
                      <UserAvatar userId={m.senderId} size="xs" />
                      <div className={cn("max-w-[75%]", isMine && "items-end")}>
                        <div className={cn("flex items-baseline gap-1.5", isMine && "justify-end")}>
                          <span className="text-[11px] font-semibold">{u?.name ?? "—"}</span>
                          <span className="text-[9px] text-muted-foreground">{formatTime(m.createdAt)}</span>
                        </div>
                        {isDeleted ? (
                          <p className="mt-0.5 inline-block rounded-md bg-surface-muted px-2 py-1 text-xs italic text-muted-foreground">
                            Deleted
                          </p>
                        ) : (
                          m.body && (
                            <p className={cn(
                              "mt-0.5 inline-block whitespace-pre-wrap rounded-md px-2 py-1 text-xs",
                              isMine ? "bg-primary text-primary-foreground" : "bg-surface-muted",
                            )}>
                              {m.body}
                            </p>
                          )
                        )}
                        {m.attachments && m.attachments.length > 0 && (
                          <p className="mt-0.5 text-[10px] italic text-muted-foreground">
                            {m.attachments.length} attachment{m.attachments.length === 1 ? "" : "s"} — open full chat to download
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-border p-2">
                <div className="flex items-end gap-1.5">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                    placeholder="Reply…"
                    className="h-8 flex-1 text-xs"
                    disabled={sending}
                  />
                  <Button
                    size="sm"
                    className="h-8 gap-1"
                    onClick={() => void send()}
                    disabled={sending || !draft.trim()}
                  >
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
