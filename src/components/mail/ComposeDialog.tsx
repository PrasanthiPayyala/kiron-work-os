import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, Save } from "lucide-react";
import { mailApi } from "@/lib/mail/api";
import { toast } from "sonner";
import type { EmailAccount, EmailMessage } from "@/lib/mail/types";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "new" | "reply" | "reply_all" | "forward";
  accountId: string | null;
  accounts: EmailAccount[];
  sourceMessage: EmailMessage | null;
}

export function ComposeDialog({ open, onOpenChange, mode, accountId, accounts, sourceMessage }: Props) {
  const [account, setAccount] = useState<string | null>(accountId);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setAccount(accountId);
    if (!open) return;
    if (mode === "new" || !sourceMessage) {
      setTo(""); setCc(""); setSubject(""); setBody("");
    } else {
      const prefix = mode === "forward" ? "Fwd: " : "Re: ";
      const subj = sourceMessage.subject ?? "";
      setSubject(subj.startsWith(prefix.trim()) ? subj : prefix + subj);
      if (mode === "forward") {
        setTo("");
        setCc("");
      } else {
        setTo(sourceMessage.from_address ?? "");
        setCc(mode === "reply_all" ? (sourceMessage.cc_addresses ?? []).join(", ") : "");
      }
      const quote = `\n\n---\nOn ${sourceMessage.sent_at}, ${sourceMessage.from_name || sourceMessage.from_address} wrote:\n${sourceMessage.body_text ?? sourceMessage.snippet ?? ""}`;
      setBody(quote);
    }
  }, [open, mode, sourceMessage, accountId]);

  const parseList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  const handleSend = async () => {
    if (!account) return toast.error("Pick a mailbox");
    if (!to.trim()) return toast.error("Recipient required");
    setSending(true);
    const { error } = await mailApi.send({
      account_id: account,
      mode,
      in_reply_to_message_id: mode === "reply" || mode === "reply_all" ? sourceMessage?.id : undefined,
      forward_of_message_id: mode === "forward" ? sourceMessage?.id : undefined,
      to: parseList(to),
      cc: parseList(cc),
      subject,
      body_text: body,
      body_html: `<div style="white-space:pre-wrap">${body.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))}</div>`,
    });
    setSending(false);
    if (error) toast.error("Send failed", { description: error.message });
    else { toast.success("Email sent"); onOpenChange(false); }
  };

  const handleSaveDraft = async () => {
    if (!account) return toast.error("Pick a mailbox");
    const { error } = await mailApi.saveDraft({
      account_id: account,
      to: parseList(to), cc: parseList(cc),
      subject, body_text: body,
      in_reply_to_message_id: mode === "reply" || mode === "reply_all" ? sourceMessage?.id : undefined,
      forward_of_message_id: mode === "forward" ? sourceMessage?.id : undefined,
    });
    if (error) toast.error("Draft save failed", { description: error.message });
    else { toast.success("Draft saved"); onOpenChange(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "new" ? "New message" : mode === "forward" ? "Forward" : mode === "reply_all" ? "Reply all" : "Reply"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">From</Label>
            <Select value={account ?? ""} onValueChange={setAccount}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select mailbox" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.display_name} — {a.email}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="email@example.com, ..." className="h-9" />
          </div>
          <div>
            <Label className="text-xs">Cc</Label>
            <Input value={cc} onChange={(e) => setCc(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">Body</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[220px]" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleSaveDraft}><Save className="mr-1 h-4 w-4" />Save draft</Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
