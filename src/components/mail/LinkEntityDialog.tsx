import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  messageId: string;
  accountId: string;
  onLinked?: () => void;
}

export function LinkEntityDialog({ open, onOpenChange, messageId, accountId, onLinked }: Props) {
  const { user } = useAuth();
  const { tasks, projects, companies } = useDataStore();
  const [kind, setKind] = useState<"task" | "project" | "company">("task");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setKind("task"); setSearch(""); setSelectedId(null); setNote(""); }
  }, [open]);

  const options: { id: string; label: string }[] = (() => {
    const q = search.trim().toLowerCase();
    if (kind === "task") {
      return tasks
        .filter((t) => !q || `${t.key} ${t.title}`.toLowerCase().includes(q))
        .slice(0, 50)
        .map((t) => ({ id: t.id, label: `${t.key} · ${t.title}` }));
    }
    if (kind === "project") {
      return projects
        .filter((p) => !q || p.name.toLowerCase().includes(q))
        .slice(0, 50)
        .map((p) => ({ id: p.id, label: p.name }));
    }
    return companies
      .filter((c) => !q || c.shortName.toLowerCase().includes(q))
      .map((c) => ({ id: c.id, label: c.shortName }));
  })();

  const handleSave = async () => {
    if (!user || !selectedId) return toast.error("Pick an item to link");
    setSaving(true);
    const { error } = await supabase.from("email_links").insert({
      message_id: messageId,
      account_id: accountId,
      entity_type: kind,
      entity_id: selectedId,
      linked_by: user.id,
      note: note || null,
    });
    setSaving(false);
    if (error) return toast.error("Link failed", { description: error.message });
    toast.success("Email linked");
    onOpenChange(false);
    onLinked?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Link email to…</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={kind} onValueChange={(v: "task" | "project" | "company") => { setKind(v); setSelectedId(null); }}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="task">Task</SelectItem>
                <SelectItem value="project">Project</SelectItem>
                <SelectItem value="company">Company</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Search</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type to filter…" className="mt-1 h-9" />
          </div>
          <div className="max-h-56 overflow-y-auto rounded-md border border-border">
            {options.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No matches.</p>
            ) : (
              <ul className="divide-y divide-border">
                {options.map((o) => (
                  <li key={o.id}>
                    <button
                      onClick={() => setSelectedId(o.id)}
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-muted/50 ${selectedId === o.id ? "bg-primary-soft text-primary" : ""}`}
                    >
                      {o.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <Label className="text-xs">Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 h-9" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !selectedId}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
