// Uploads files for a task or project via the self-hosted `/files` endpoint.
// Preserves the original component's props so consumers (Tasks.tsx,
// ProjectDetail.tsx via AttachmentList) work without code changes.

import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";

const MAX_SIZE = 25 * 1024 * 1024; // 25MB — matches the cap enforced in the files router.

interface Props {
  entityType: "task" | "project";
  entityId: string;
  onUploaded?: () => void;
}

export function AttachmentUploader({ entityType, entityId, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onPick = () => inputRef.current?.click();

  const onFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    let okCount = 0;
    for (const file of Array.from(files)) {
      if (file.size > MAX_SIZE) {
        toast.error(`${file.name}: file exceeds 25MB`);
        continue;
      }
      try {
        await api.uploadFile(file, { type: entityType, id: entityId });
        okCount++;
      } catch (e) {
        toast.error(`${file.name}: upload failed`, {
          description: e instanceof ApiError ? e.message : undefined,
        });
      }
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
