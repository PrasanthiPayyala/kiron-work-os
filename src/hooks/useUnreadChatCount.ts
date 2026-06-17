// Sum of unread messages across every conversation the current user is a
// member of. Used by AppShell to badge the Team Chat sidebar entry. Live
// — the underlying messages array updates via realtime + the new
// message.deleted patches, so this re-derives on every render.
import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";

export function useUnreadChatCount(): number {
  const { user } = useAuth();
  const { conversations, messages } = useDataStore();

  return useMemo(() => {
    if (!user) return 0;
    let unread = 0;
    for (const conv of conversations) {
      if (!conv.memberIds.includes(user.id)) continue;
      const lastReadTs = conv.lastReadAt ? new Date(conv.lastReadAt).getTime() : 0;
      for (const m of messages) {
        if (m.conversationId !== conv.id) continue;
        if (m.senderId === user.id) continue;
        if (m.deletedAt) continue; // tombstones don't count
        if (new Date(m.createdAt).getTime() > lastReadTs) unread += 1;
      }
    }
    return unread;
  }, [user, conversations, messages]);
}
