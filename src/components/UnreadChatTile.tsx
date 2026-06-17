// Dashboard tile that surfaces the user's unread chat count and routes
// them straight to /chat. Renders nothing when there's no unread —
// keeps the dashboard quiet when the inbox is empty.
import { useNavigate } from "react-router-dom";
import { MessageSquare, ChevronRight } from "lucide-react";
import { useUnreadChatCount } from "@/hooks/useUnreadChatCount";

export function UnreadChatTile() {
  const navigate = useNavigate();
  const unread = useUnreadChatCount();
  if (unread <= 0) return null;
  return (
    <button
      onClick={() => navigate("/chat")}
      className="group flex w-full items-center justify-between rounded-xl border border-primary/30 bg-primary-soft/40 p-4 text-left shadow-card transition hover:border-primary/60 hover:bg-primary-soft/60"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold">
            {unread} unread {unread === 1 ? "message" : "messages"} in Team Chat
          </p>
          <p className="text-xs text-muted-foreground">Open Chat to catch up.</p>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
    </button>
  );
}
