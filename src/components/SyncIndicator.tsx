// Topbar indicator for the offline write queue.
//   - shows a "N queued" pill while writes are waiting to sync
//   - shows a "N issues" pill when writes were rejected by the server
//   - clicking issues opens a popover to retry (drain) or discard them
// Renders nothing when the queue is empty and there are no failures.

import { useEffect, useState, useCallback } from "react";
import { CloudOff, CloudUpload, AlertTriangle, RefreshCw, Trash2 } from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  onQueueChange, getQueueCounts, listFailures, drainQueue,
  discardFailure, discardAllFailures,
} from "@/lib/offline/mutationQueue";
import type { QueuedMutation } from "@/lib/offline/db";

const kindLabel: Record<string, string> = {
  createTask: "Create task",
  updateTask: "Update task",
  addTaskActivity: "Task comment",
  checkIn: "Attendance check-in",
  updateAttendance: "Attendance update",
  decideApproval: "Approval decision",
  markNotificationRead: "Mark notification read",
  markAllNotificationsRead: "Mark all read",
  applyLeave: "Leave request",
  updateLeave: "Leave update",
};

export function SyncIndicator() {
  const [counts, setCounts] = useState({ pending: 0, failed: 0 });
  const [failures, setFailures] = useState<QueuedMutation[]>([]);
  const [online, setOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true));

  const refresh = useCallback(async () => {
    setCounts(await getQueueCounts());
    setFailures(await listFailures());
  }, []);

  useEffect(() => {
    refresh();
    const off = onQueueChange(refresh);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      off();
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [refresh]);

  if (counts.pending === 0 && counts.failed === 0) return null;

  return (
    <div className="hidden items-center gap-1.5 md:flex">
      {counts.pending > 0 && (
        <span
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium ${
            online ? "border-info/30 bg-info/10 text-info" : "border-warning/30 bg-warning/10 text-warning"
          }`}
          title={online ? "Syncing queued changes…" : "Saved locally — will sync when you're back online"}
        >
          {online ? <CloudUpload className="h-3 w-3" /> : <CloudOff className="h-3 w-3" />}
          {counts.pending} {online ? "syncing…" : "queued"}
        </span>
      )}

      {counts.failed > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive">
              <AlertTriangle className="h-3 w-3" />
              {counts.failed} {counts.failed === 1 ? "issue" : "issues"}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <p className="text-sm font-semibold">Sync issues</p>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void discardAllFailures()}>
                Discard all
              </Button>
            </div>
            <ul className="max-h-72 divide-y divide-border overflow-y-auto">
              {failures.map((f) => (
                <li key={f.id} className="flex items-start gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{kindLabel[f.kind] ?? f.kind}</p>
                    <p className="text-[11px] text-muted-foreground">{f.lastError ?? "Rejected by server"}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{new Date(f.createdAt).toLocaleString()}</p>
                  </div>
                  <button
                    onClick={() => void discardFailure(f.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-destructive"
                    title="Discard this change"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-border p-2">
              <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => void drainQueue()}>
                <RefreshCw className="h-3.5 w-3.5" /> Retry sync
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
