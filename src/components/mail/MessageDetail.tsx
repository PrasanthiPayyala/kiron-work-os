import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Reply, ReplyAll, Forward, Sparkles, ListChecks, Link2, Paperclip, Loader2, Mail, Download, Calendar, AtSign, ExternalLink } from "lucide-react";
import { mailApi } from "@/lib/mail/api";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { LinkEntityDialog } from "./LinkEntityDialog";
import type { EmailMessage, EmailAttachment, EmailSummary } from "@/lib/mail/types";

interface Props {
  messageStub: EmailMessage | null;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
}

function formatSize(s: number | null) {
  if (!s) return "";
  if (s < 1024) return `${s} B`;
  if (s < 1024 * 1024) return `${Math.round(s / 1024)} KB`;
  return `${(s / 1024 / 1024).toFixed(1)} MB`;
}

export function MessageDetail({ messageStub, onReply, onReplyAll, onForward }: Props) {
  const [message, setMessage] = useState<EmailMessage | null>(null);
  const [attachments, setAttachments] = useState<EmailAttachment[]>([]);
  const [summary, setSummary] = useState<EmailSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [links, setLinks] = useState<Array<{ id: string; entity_type: string; entity_id: string }>>([]);

  const loadLinks = async (mid: string) => {
    const { data } = await supabase
      .from("email_links")
      .select("id, entity_type, entity_id")
      .eq("message_id", mid);
    setLinks((data ?? []) as any);
  };

  useEffect(() => {
    if (!messageStub) { setMessage(null); setAttachments([]); setSummary(null); setLinks([]); return; }
    setLoading(true);
    mailApi.fetchMessage(messageStub.id).then(({ data, error }) => {
      setLoading(false);
      if (error) { toast.error("Failed to load message"); return; }
      setMessage(data.message);
      setAttachments(data.attachments ?? []);
      supabase.from("email_summaries")
        .select("*").eq("message_id", messageStub.id).eq("kind", "message").maybeSingle()
        .then(({ data }) => setSummary(data as any));
      loadLinks(messageStub.id);
    });
  }, [messageStub?.id]);

  const summarize = async () => {
    if (!message) return;
    setSummarizing(true);
    const { data, error } = await mailApi.summarize({ kind: "message", message_id: message.id });
    setSummarizing(false);
    if (error) return toast.error("Summary failed", { description: error.message });
    if (data?.compact) return toast.info("Email is short — no summary needed");
    setSummary(data?.summary ?? null);
  };

  const createTaskFromEmail = async () => {
    if (!message) return;
    const params = new URLSearchParams({
      from_email: "1",
      title: message.subject ?? "",
      description: message.snippet ?? "",
      message_id: message.id,
    });
    window.location.href = `/tasks?${params.toString()}`;
  };

  const downloadAttachment = async (a: EmailAttachment) => {
    if (!a.storage_path) return toast.error("File not yet downloaded from server");
    const { data, error } = await supabase.storage
      .from("mail-attachments")
      .createSignedUrl(a.storage_path, 60);
    if (error || !data?.signedUrl) return toast.error("Download failed");
    window.open(data.signedUrl, "_blank");
  };

  if (!message && !loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
        <div className="text-center">
          <Mail className="mx-auto mb-3 h-10 w-10 opacity-30" />
          Select a message to read.
        </div>
      </div>
    );
  }
  if (loading || !message) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
      <div className="border-b border-border bg-surface px-6 py-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-semibold leading-tight">{message.subject || "(no subject)"}</h2>
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" variant="outline" onClick={onReply}><Reply className="mr-1 h-3.5 w-3.5" />Reply</Button>
            <Button size="sm" variant="outline" onClick={onReplyAll}><ReplyAll className="mr-1 h-3.5 w-3.5" />All</Button>
            <Button size="sm" variant="outline" onClick={onForward}><Forward className="mr-1 h-3.5 w-3.5" />Forward</Button>
          </div>
        </div>
        <div className="mt-3 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
            {(message.from_name || message.from_address || "?").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            <p className="text-foreground"><b>{message.from_name || message.from_address}</b> <span className="font-normal text-muted-foreground">&lt;{message.from_address}&gt;</span></p>
            <p className="truncate">To: {(message.to_addresses ?? []).join(", ")}</p>
            {!!message.cc_addresses?.length && <p className="truncate">Cc: {message.cc_addresses.join(", ")}</p>}
            <p className="mt-0.5">{message.sent_at ? new Date(message.sent_at).toLocaleString() : ""}</p>
          </div>
        </div>
        {links.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {links.map((l) => (
              <span key={l.id} className="inline-flex items-center gap-1 rounded-full bg-accent/30 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-foreground">
                <Link2 className="h-3 w-3" /> {l.entity_type}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="border-b border-border bg-primary-soft/30 px-6 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">AI Summary</span>
          <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={summarize} disabled={summarizing}>
            {summarizing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            {summary ? "Regenerate" : "Summarize"}
          </Button>
        </div>
        {summary ? (
          <div className="mt-2 space-y-3 text-sm">
            <p>{summary.summary}</p>
            {!!summary.action_items?.length && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase text-muted-foreground"><ListChecks className="h-3 w-3" /> Action items</p>
                <ul className="space-y-1">
                  {summary.action_items.map((a, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-primary" />{a}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!summary.deadlines?.length && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase text-muted-foreground"><Calendar className="h-3 w-3" /> Deadlines</p>
                <div className="flex flex-wrap gap-1">
                  {summary.deadlines.map((d, i) => <span key={i} className="rounded-md bg-surface px-1.5 py-0.5 text-xs">{d}</span>)}
                </div>
              </div>
            )}
            {!!summary.people_mentioned?.length && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase text-muted-foreground"><AtSign className="h-3 w-3" /> People</p>
                <div className="flex flex-wrap gap-1">
                  {summary.people_mentioned.map((p, i) => <span key={i} className="rounded-md bg-surface px-1.5 py-0.5 text-xs">{p}</span>)}
                </div>
              </div>
            )}
            {summary.reply_recommended && (
              <p className="rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">↪ A reply is recommended.</p>
            )}
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">Click Summarize for action items, deadlines, and key people.</p>
        )}
      </div>

      <div className="flex-1 px-6 py-5">
        {message.body_html ? (
          <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: message.body_html }} />
        ) : (
          <pre className="whitespace-pre-wrap font-body text-sm">{message.body_text}</pre>
        )}

        {!!attachments.length && (
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Attachments ({attachments.length})</p>
            <ul className="space-y-1.5">
              {attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
                  <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate" title={a.filename}>{a.filename}</span>
                  <span className="text-xs text-muted-foreground">{formatSize(a.size)}</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => downloadAttachment(a)} title="Download">
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
          <Button size="sm" variant="outline" onClick={createTaskFromEmail}>
            <ListChecks className="mr-1 h-3.5 w-3.5" /> Create Task
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
            <Link2 className="mr-1 h-3.5 w-3.5" /> Link to entity
          </Button>
        </div>
      </div>

      <LinkEntityDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        messageId={message.id}
        accountId={message.account_id}
        onLinked={() => loadLinks(message.id)}
      />
    </div>
  );
}
