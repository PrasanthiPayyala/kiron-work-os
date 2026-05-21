import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Paperclip, Download, Trash2, FileText, Image as ImageIcon, FileArchive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { AttachmentUploader } from "./AttachmentUploader";

interface Attachment {
  id: string;
  entity_type: string;
  entity_id: string;
  file_name: string;
  file_url: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  created_at: string;
}

interface Props {
  entityType: "task" | "project";
  entityId: string;
  /** Allow upload (default true) */
  canUpload?: boolean;
}

const BUCKET = "task-project-attachments";

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
  const { user } = useAuth();
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("attachments")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("Failed to load attachments");
      return;
    }
    setItems((data ?? []) as Attachment[]);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  const handleDownload = async (a: Attachment) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.file_url, 60);
    if (error || !data?.signedUrl) {
      toast.error("Could not get download link");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const handleDelete = async (a: Attachment) => {
    if (!confirm(`Delete "${a.file_name}"?`)) return;
    setDeleting(a.id);
    const { error: sErr } = await supabase.storage.from(BUCKET).remove([a.file_url]);
    if (sErr) {
      setDeleting(null);
      return toast.error("Storage delete failed", { description: sErr.message });
    }
    const { error: dErr } = await supabase.from("attachments").delete().eq("id", a.id);
    setDeleting(null);
    if (dErr) return toast.error("Delete failed", { description: dErr.message });
    toast.success("Attachment removed");
    load();
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
                {(user?.id === a.uploaded_by) && (
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
