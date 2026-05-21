import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Mail, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  entityType: "task" | "project" | "company";
  entityId: string;
}

interface LinkRow {
  id: string;
  message_id: string;
  account_id: string;
  created_at: string;
  note: string | null;
  email_messages: {
    subject: string | null;
    from_address: string | null;
    from_name: string | null;
    sent_at: string | null;
    snippet: string | null;
  } | null;
}

export function LinkedEmails({ entityType, entityId }: Props) {
  const [items, setItems] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("email_links")
        .select("id, message_id, account_id, created_at, note, email_messages(subject, from_address, from_name, sent_at, snippet)")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .order("created_at", { ascending: false });
      setItems((data ?? []) as unknown as LinkRow[]);
      setLoading(false);
    })();
  }, [entityType, entityId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
        <Mail className="mx-auto mb-2 h-5 w-5 opacity-50" />
        No linked emails.
      </div>
    );
  }

  return (
    <ul className="space-y-1.5">
      {items.map((l) => {
        const m = l.email_messages;
        return (
          <li key={l.id} className="rounded-md border border-border bg-surface p-2.5 text-sm">
            <div className="flex items-start gap-2">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{m?.subject || "(no subject)"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {m?.from_name || m?.from_address}
                  {m?.sent_at && <> · {new Date(m.sent_at).toLocaleDateString()}</>}
                </p>
                {m?.snippet && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{m.snippet}</p>}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => (window.location.href = `/mail?message=${l.message_id}`)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
