// Lists attachments for a task or project, reading from the self-hosted
// `/files` endpoint. The uploader (above the list) writes to the same endpoint
// and pings `load()` on success so the new file appears immediately.

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type FileRow } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Paperclip, Download, Trash2, FileText, Image as ImageIcon, FileArchive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AttachmentUploader } from "./AttachmentUploader";

interface Props {
  entityType: "task" | "project";
  entityId: string;
  /** Allow upload (default true) */
  canUpload?: boolean;
}

function iconFor(mime: string | null, name: string) {
  const m = (mime ?? "").toLowerCase();
  const n = name.toLowerCase();
  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/.test(n)) return ImageIcon;
  if (/\.(zip|rar|7z|tar|gz)$/.test(n)) return FileArchive;
  return FileText;
}

function formatSize(s: number | null) {
  if (!s) return "";
  if (s < 1024) return `${s} B`;
  if (s < 1024 * 1024) return `${Math.round(s / 1024)} KB`;
  return `${(s / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentList({ entityType, entityId, canUpload = true }: Props) {
  const { user, role } = useAuth();
  const [items, setItems] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const isElevated = role === "super_admin" || role === "founder";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.listFiles(entityType, entityId);
      setItems(rows);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to load attachments");
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => { void load(); }, [load]);

  const handleDownload = async (a: FileRow) => {
    try {
      await api.downloadFile(a.id, a.file_name);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not download file");
    }
  };

  const handleDelete = async (a: FileRow) => {
    if (!confirm(`Delete "${a.file_name}"?`)) return;
    setDeleting(a.id);
    try {
      await api.deleteFile(a.id);
      toast.success("Attachment removed");
      // Optimistic: drop from local state without a round-trip.
      setItems((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-3">
      {canUpload && (
        <AttachmentUploader entityType={entityType} entityId={entityId} onUploaded={load} />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          <Paperclip className="mx-auto mb-2 h-5 w-5 opacity-50" />
          No attachments yet.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((a) => {
            const Icon = iconFor(a.mime_type, a.file_name);
            const canDelete = user?.id === a.uploaded_by || isElevated;
            return (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-md border border-border bg-surface p-2 text-sm"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <button
                  onClick={() => handleDownload(a)}
                  className="min-w-0 flex-1 truncate text-left hover:text-primary"
                  title={a.file_name}
                >
                  {a.file_name}
                </button>
                <span className="shrink-0 text-[10px] text-muted-foreground">{formatSize(a.file_size)}</span>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDownload(a)}>
                  <Download className="h-3.5 w-3.5" />
                </Button>
                {canDelete && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(a)}
                    disabled={deleting === a.id}
                  >
                    {deleting === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
