import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

const BUCKET = "task-project-attachments";
const MAX_SIZE = 25 * 1024 * 1024; // 25MB

interface Props {
  entityType: "task" | "project";
  entityId: string;
  onUploaded?: () => void;
}

export function AttachmentUploader({ entityType, entityId, onUploaded }: Props) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onPick = () => inputRef.current?.click();

  const onFiles = async (files: FileList | null) => {
    if (!files || !files.length || !user) return;
    setUploading(true);
    let okCount = 0;
    for (const file of Array.from(files)) {
      if (file.size > MAX_SIZE) {
        toast.error(`${file.name}: file exceeds 25MB`);
        continue;
      }
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${entityType}/${entityId}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (upErr) {
        toast.error(`${file.name}: upload failed`, { description: upErr.message });
        continue;
      }
      const { error: insErr } = await supabase.from("attachments").insert({
        entity_type: entityType,
        entity_id: entityId,
        file_name: file.name,
        file_url: path,
        file_size: file.size,
        mime_type: file.type || null,
        uploaded_by: user.id,
      });
      if (insErr) {
        toast.error(`${file.name}: record failed`, { description: insErr.message });
        await supabase.storage.from(BUCKET).remove([path]);
        continue;
      }
      okCount++;
    }
    setUploading(false);
    if (okCount) {
      toast.success(`Uploaded ${okCount} file${okCount === 1 ? "" : "s"}`);
      onUploaded?.();
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <Button size="sm" variant="outline" onClick={onPick} disabled={uploading}>
        {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
        Upload files
      </Button>
    </div>
  );
}
