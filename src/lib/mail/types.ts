export type MailEncryption = "ssl" | "tls" | "starttls" | "none";

export interface EmailAccount {
  id: string;
  display_name: string;
  email: string;
  owner_user_id: string;
  company_id: string | null;
  is_shared: boolean;
  imap_host: string;
  imap_port: number;
  imap_encryption: MailEncryption;
  imap_username: string;
  smtp_host: string;
  smtp_port: number;
  smtp_encryption: MailEncryption;
  smtp_username: string;
  default_sender_name: string | null;
  sync_enabled: boolean;
  sync_interval_min: number;
  is_active: boolean;
  status: "connected" | "failed" | "needs_reauth" | "syncing" | "paused" | "pending";
  last_sync_at: string | null;
  last_error: string | null;
}

export interface EmailFolder {
  id: string;
  account_id: string;
  name: string;
  path: string;
  role: string | null;
  unread_count: number;
  total_count: number;
}

export interface EmailMessage {
  id: string;
  account_id: string;
  folder_id: string | null;
  thread_id: string | null;
  imap_uid: number | null;
  message_id: string | null;
  in_reply_to: string | null;
  from_address: string | null;
  from_name: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  bcc_addresses: string[];
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  sent_at: string | null;
  received_at: string | null;
  is_read: boolean;
  is_starred: boolean;
  is_draft: boolean;
  has_attachments: boolean;
}

export interface EmailAttachment {
  id: string;
  message_id: string;
  filename: string;
  mime_type: string | null;
  size: number | null;
  content_id: string | null;
  storage_path: string | null;
  is_inline: boolean;
}

export interface EmailSummary {
  id: string;
  summary: string;
  action_items: string[];
  deadlines: string[];
  people_mentioned: string[];
  links: string[];
  reply_recommended: boolean;
  model: string | null;
  generated_at: string;
}
