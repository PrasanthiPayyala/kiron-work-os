import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Mail as MailIcon, RefreshCw, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MailboxList } from "@/components/mail/MailboxList";
import { MessageList } from "@/components/mail/MessageList";
import { MessageDetail } from "@/components/mail/MessageDetail";
import { ComposeDialog } from "@/components/mail/ComposeDialog";
import { mailApi } from "@/lib/mail/api";
import { toast } from "sonner";
import type { EmailAccount, EmailFolder, EmailMessage } from "@/lib/mail/types";

export default function Mail() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [folders, setFolders] = useState<EmailFolder[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);
  const [search, setSearch] = useState("");
  const [filterUnread, setFilterUnread] = useState(false);
  const [filterAttachments, setFilterAttachments] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<"new" | "reply" | "reply_all" | "forward">("new");
  const [loadingSync, setLoadingSync] = useState(false);

  // Load accessible accounts
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("email_accounts").select("*").order("created_at");
      const list = (data ?? []) as EmailAccount[];
      setAccounts(list);
      if (list.length && !selectedAccount) setSelectedAccount(list[0].id);
    })();
  }, []);

  // Load folders when account changes
  useEffect(() => {
    if (!selectedAccount) { setFolders([]); return; }
    (async () => {
      const { data } = await supabase.from("email_folders").select("*")
        .eq("account_id", selectedAccount).order("name");
      const list = (data ?? []) as EmailFolder[];
      setFolders(list);
      const inbox = list.find((f) => f.role === "inbox" || /inbox/i.test(f.name));
      setSelectedFolder(inbox?.id ?? list[0]?.id ?? null);
    })();
  }, [selectedAccount]);

  // Load messages when folder changes
  useEffect(() => {
    if (!selectedAccount) { setMessages([]); return; }
    let q = supabase.from("email_messages").select("*")
      .eq("account_id", selectedAccount)
      .order("received_at", { ascending: false, nullsFirst: false })
      .order("sent_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (selectedFolder) q = q.eq("folder_id", selectedFolder);
    q.then(({ data }) => setMessages((data ?? []) as EmailMessage[]));
  }, [selectedAccount, selectedFolder]);

  // Realtime: refresh messages on changes
  useEffect(() => {
    if (!selectedAccount) return;
    const ch = supabase.channel(`mail-${selectedAccount}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "email_messages", filter: `account_id=eq.${selectedAccount}` },
        () => {
          supabase.from("email_messages").select("*").eq("account_id", selectedAccount)
            .order("received_at", { ascending: false }).limit(200)
            .then(({ data }) => setMessages((data ?? []) as EmailMessage[]));
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selectedAccount]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return messages.filter((m) => {
      if (filterUnread && m.is_read) return false;
      if (filterAttachments && !m.has_attachments) return false;
      if (q) {
        const hay = `${m.subject ?? ""} ${m.from_address ?? ""} ${m.from_name ?? ""} ${m.snippet ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [messages, search, filterUnread, filterAttachments]);

  const handleSync = async () => {
    if (!selectedAccount) return;
    setLoadingSync(true);
    const folderPath = folders.find((f) => f.id === selectedFolder)?.path ?? "INBOX";
    const { error } = await mailApi.syncFolder(selectedAccount, folderPath);
    setLoadingSync(false);
    if (error) toast.error("Sync failed", { description: error.message });
    else toast.success("Sync requested");
  };

  const openCompose = (mode: typeof composeMode) => {
    setComposeMode(mode);
    setComposeOpen(true);
  };

  if (!accounts.length) {
    return (
      <div>
        <PageHeader title="Mail" description="Read, reply, and manage email inside Kiron." icon={<MailIcon className="h-5 w-5" />} />
        <div className="m-6 rounded-xl border border-border bg-surface p-12 text-center">
          <MailIcon className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 font-display text-lg font-semibold">No mailboxes connected</h3>
          <p className="mt-2 text-sm text-muted-foreground">Connect an IMAP/SMTP account to start using Kiron Mail.</p>
          <Button className="mt-4" onClick={() => window.location.href = "/settings"}>Go to Mail Accounts</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Mail"
        description="Inbox, drafts and sent — across your connected mailboxes."
        icon={<MailIcon className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleSync} disabled={loadingSync}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${loadingSync ? "animate-spin" : ""}`} />
              Sync
            </Button>
            <Button size="sm" onClick={() => openCompose("new")}>
              <PenLine className="mr-1.5 h-4 w-4" /> Compose
            </Button>
          </div>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,360px)_minmax(0,1fr)] divide-x divide-border">
        <MailboxList
          accounts={accounts}
          folders={folders}
          selectedAccount={selectedAccount}
          selectedFolder={selectedFolder}
          onSelectAccount={setSelectedAccount}
          onSelectFolder={setSelectedFolder}
        />
        <MessageList
          messages={filtered}
          selectedId={selectedMessage?.id ?? null}
          onSelect={setSelectedMessage}
          search={search}
          onSearchChange={setSearch}
          filterUnread={filterUnread}
          onToggleUnread={() => setFilterUnread((v) => !v)}
          filterAttachments={filterAttachments}
          onToggleAttachments={() => setFilterAttachments((v) => !v)}
        />
        <MessageDetail
          messageStub={selectedMessage}
          onReply={() => openCompose("reply")}
          onReplyAll={() => openCompose("reply_all")}
          onForward={() => openCompose("forward")}
        />
      </div>

      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        mode={composeMode}
        accountId={selectedAccount}
        accounts={accounts}
        sourceMessage={composeMode === "new" ? null : selectedMessage}
      />
    </div>
  );
}
