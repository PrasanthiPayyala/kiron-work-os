
-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.mail_encryption AS ENUM ('ssl', 'tls', 'starttls', 'none');
CREATE TYPE public.mail_account_status AS ENUM ('connected', 'failed', 'needs_reauth', 'syncing', 'paused', 'pending');
CREATE TYPE public.mail_permission AS ENUM ('read', 'send', 'admin');
CREATE TYPE public.mail_recipient_kind AS ENUM ('from', 'to', 'cc', 'bcc', 'reply_to');
CREATE TYPE public.mail_link_entity AS ENUM ('task', 'project', 'company', 'person');
CREATE TYPE public.mail_summary_kind AS ENUM ('message', 'thread');
CREATE TYPE public.mail_sync_status AS ENUM ('idle', 'syncing', 'error', 'paused');

-- =========================================================
-- email_accounts
-- =========================================================
CREATE TABLE public.email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  email text NOT NULL,
  owner_user_id uuid NOT NULL,
  company_id uuid,
  is_shared boolean NOT NULL DEFAULT false,
  imap_host text NOT NULL,
  imap_port integer NOT NULL,
  imap_encryption mail_encryption NOT NULL DEFAULT 'ssl',
  imap_username text NOT NULL,
  smtp_host text NOT NULL,
  smtp_port integer NOT NULL,
  smtp_encryption mail_encryption NOT NULL DEFAULT 'tls',
  smtp_username text NOT NULL,
  default_sender_name text,
  sync_enabled boolean NOT NULL DEFAULT true,
  sync_interval_min integer NOT NULL DEFAULT 5,
  is_active boolean NOT NULL DEFAULT true,
  status mail_account_status NOT NULL DEFAULT 'pending',
  vault_secret_name text,
  last_sync_at timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_accounts_owner ON public.email_accounts(owner_user_id);
CREATE INDEX idx_email_accounts_company ON public.email_accounts(company_id);

-- =========================================================
-- mailbox_permissions
-- =========================================================
CREATE TABLE public.mailbox_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  permission mail_permission NOT NULL DEFAULT 'read',
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, user_id, permission)
);
CREATE INDEX idx_mailbox_perms_user ON public.mailbox_permissions(user_id);

-- =========================================================
-- helper: can_access_mailbox
-- =========================================================
CREATE OR REPLACE FUNCTION public.can_access_mailbox(_user_id uuid, _account_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_any_role(_user_id, ARRAY['super_admin'::user_role, 'founder'::user_role])
    OR EXISTS (SELECT 1 FROM public.email_accounts a WHERE a.id = _account_id AND a.owner_user_id = _user_id)
    OR EXISTS (SELECT 1 FROM public.mailbox_permissions p WHERE p.account_id = _account_id AND p.user_id = _user_id);
$$;

-- =========================================================
-- email_folders
-- =========================================================
CREATE TABLE public.email_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  path text NOT NULL,
  delimiter text DEFAULT '/',
  role text, -- inbox/sent/drafts/trash/spam/archive
  unread_count integer NOT NULL DEFAULT 0,
  total_count integer NOT NULL DEFAULT 0,
  uid_validity bigint,
  last_uid bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, path)
);
CREATE INDEX idx_email_folders_account ON public.email_folders(account_id);

-- =========================================================
-- email_threads
-- =========================================================
CREATE TABLE public.email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES public.email_folders(id) ON DELETE SET NULL,
  subject text,
  participants text[] NOT NULL DEFAULT '{}',
  last_message_at timestamptz,
  message_count integer NOT NULL DEFAULT 0,
  unread_count integer NOT NULL DEFAULT 0,
  has_attachments boolean NOT NULL DEFAULT false,
  starred boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_threads_account ON public.email_threads(account_id);
CREATE INDEX idx_email_threads_folder ON public.email_threads(folder_id);
CREATE INDEX idx_email_threads_last_msg ON public.email_threads(last_message_at DESC);

-- =========================================================
-- email_messages
-- =========================================================
CREATE TABLE public.email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES public.email_folders(id) ON DELETE SET NULL,
  thread_id uuid REFERENCES public.email_threads(id) ON DELETE SET NULL,
  imap_uid bigint,
  message_id text,
  in_reply_to text,
  references_ids text[],
  from_address text,
  from_name text,
  to_addresses text[] NOT NULL DEFAULT '{}',
  cc_addresses text[] NOT NULL DEFAULT '{}',
  bcc_addresses text[] NOT NULL DEFAULT '{}',
  subject text,
  snippet text,
  body_text text,
  body_html text,
  sent_at timestamptz,
  received_at timestamptz,
  is_read boolean NOT NULL DEFAULT false,
  is_starred boolean NOT NULL DEFAULT false,
  is_draft boolean NOT NULL DEFAULT false,
  has_attachments boolean NOT NULL DEFAULT false,
  raw_size integer,
  headers jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, folder_id, imap_uid)
);
CREATE INDEX idx_email_msg_account ON public.email_messages(account_id);
CREATE INDEX idx_email_msg_thread ON public.email_messages(thread_id);
CREATE INDEX idx_email_msg_folder ON public.email_messages(folder_id);
CREATE INDEX idx_email_msg_received ON public.email_messages(received_at DESC);
CREATE INDEX idx_email_msg_unread ON public.email_messages(account_id, is_read) WHERE is_read = false;
CREATE INDEX idx_email_msg_search ON public.email_messages USING gin (to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(snippet,'') || ' ' || coalesce(body_text,'')));

-- =========================================================
-- email_recipients
-- =========================================================
CREATE TABLE public.email_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.email_messages(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  kind mail_recipient_kind NOT NULL,
  address text NOT NULL,
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_recip_msg ON public.email_recipients(message_id);
CREATE INDEX idx_email_recip_address ON public.email_recipients(address);

-- =========================================================
-- email_attachments
-- =========================================================
CREATE TABLE public.email_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.email_messages(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text,
  size bigint,
  content_id text,
  storage_path text,
  is_inline boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_att_msg ON public.email_attachments(message_id);

-- =========================================================
-- email_drafts
-- =========================================================
CREATE TABLE public.email_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  to_addresses text[] NOT NULL DEFAULT '{}',
  cc_addresses text[] NOT NULL DEFAULT '{}',
  bcc_addresses text[] NOT NULL DEFAULT '{}',
  subject text,
  body_html text,
  body_text text,
  in_reply_to_message_id uuid REFERENCES public.email_messages(id) ON DELETE SET NULL,
  forward_of_message_id uuid REFERENCES public.email_messages(id) ON DELETE SET NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_drafts_user ON public.email_drafts(user_id);
CREATE INDEX idx_email_drafts_account ON public.email_drafts(account_id);

-- =========================================================
-- email_sync_state
-- =========================================================
CREATE TABLE public.email_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES public.email_folders(id) ON DELETE CASCADE,
  cursor text,
  status mail_sync_status NOT NULL DEFAULT 'idle',
  last_synced_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, folder_id)
);

-- =========================================================
-- email_links
-- =========================================================
CREATE TABLE public.email_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.email_messages(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  entity_type mail_link_entity NOT NULL,
  entity_id uuid NOT NULL,
  linked_by uuid NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, entity_type, entity_id)
);
CREATE INDEX idx_email_links_entity ON public.email_links(entity_type, entity_id);

-- =========================================================
-- email_summaries
-- =========================================================
CREATE TABLE public.email_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.email_messages(id) ON DELETE CASCADE,
  thread_id uuid REFERENCES public.email_threads(id) ON DELETE CASCADE,
  kind mail_summary_kind NOT NULL,
  summary text NOT NULL,
  action_items jsonb DEFAULT '[]'::jsonb,
  deadlines jsonb DEFAULT '[]'::jsonb,
  people_mentioned jsonb DEFAULT '[]'::jsonb,
  links jsonb DEFAULT '[]'::jsonb,
  reply_recommended boolean DEFAULT false,
  model text,
  generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_summaries_msg ON public.email_summaries(message_id);
CREATE INDEX idx_email_summaries_thread ON public.email_summaries(thread_id);

-- =========================================================
-- Tiny additions to existing tables
-- =========================================================
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS email_notify_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_notify_recipients text[];

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_default_account_id uuid;

-- =========================================================
-- Triggers (updated_at)
-- =========================================================
CREATE TRIGGER trg_email_accounts_updated BEFORE UPDATE ON public.email_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_email_folders_updated BEFORE UPDATE ON public.email_folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_email_threads_updated BEFORE UPDATE ON public.email_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_email_messages_updated BEFORE UPDATE ON public.email_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_email_drafts_updated BEFORE UPDATE ON public.email_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_email_sync_state_updated BEFORE UPDATE ON public.email_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- RLS
-- =========================================================
ALTER TABLE public.email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mailbox_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_summaries ENABLE ROW LEVEL SECURITY;

-- email_accounts
CREATE POLICY email_accounts_select ON public.email_accounts
  FOR SELECT TO authenticated
  USING (public.can_access_mailbox(auth.uid(), id));
CREATE POLICY email_accounts_insert ON public.email_accounts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['super_admin'::user_role,'founder'::user_role,'hr_admin'::user_role])
    OR owner_user_id = auth.uid()
  );
CREATE POLICY email_accounts_update ON public.email_accounts
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['super_admin'::user_role,'founder'::user_role,'hr_admin'::user_role])
    OR owner_user_id = auth.uid()
  )
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['super_admin'::user_role,'founder'::user_role,'hr_admin'::user_role])
    OR owner_user_id = auth.uid()
  );
CREATE POLICY email_accounts_delete ON public.email_accounts
  FOR DELETE TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['super_admin'::user_role,'founder'::user_role])
    OR owner_user_id = auth.uid()
  );

-- mailbox_permissions
CREATE POLICY mailbox_perms_select ON public.mailbox_permissions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY['super_admin'::user_role,'founder'::user_role])
    OR EXISTS (SELECT 1 FROM public.email_accounts a WHERE a.id = account_id AND a.owner_user_id = auth.uid())
  );
CREATE POLICY mailbox_perms_write ON public.mailbox_permissions
  FOR ALL TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['super_admin'::user_role,'founder'::user_role])
    OR EXISTS (SELECT 1 FROM public.email_accounts a WHERE a.id = account_id AND a.owner_user_id = auth.uid())
  )
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['super_admin'::user_role,'founder'::user_role])
    OR EXISTS (SELECT 1 FROM public.email_accounts a WHERE a.id = account_id AND a.owner_user_id = auth.uid())
  );

-- Generic policy template for the per-account tables
CREATE POLICY email_folders_all ON public.email_folders
  FOR ALL TO authenticated
  USING (public.can_access_mailbox(auth.uid(), account_id))
  WITH CHECK (public.can_access_mailbox(auth.uid(), account_id));

CREATE POLICY email_threads_all ON public.email_threads
  FOR ALL TO authenticated
  USING (public.can_access_mailbox(auth.uid(), account_id))
  WITH CHECK (public.can_access_mailbox(auth.uid(), account_id));

CREATE POLICY email_messages_all ON public.email_messages
  FOR ALL TO authenticated
  USING (public.can_access_mailbox(auth.uid(), account_id))
  WITH CHECK (public.can_access_mailbox(auth.uid(), account_id));

CREATE POLICY email_recipients_all ON public.email_recipients
  FOR ALL TO authenticated
  USING (public.can_access_mailbox(auth.uid(), account_id))
  WITH CHECK (public.can_access_mailbox(auth.uid(), account_id));

CREATE POLICY email_attachments_all ON public.email_attachments
  FOR ALL TO authenticated
  USING (public.can_access_mailbox(auth.uid(), account_id))
  WITH CHECK (public.can_access_mailbox(auth.uid(), account_id));

CREATE POLICY email_drafts_select ON public.email_drafts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_access_mailbox(auth.uid(), account_id));
CREATE POLICY email_drafts_write ON public.email_drafts
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.can_access_mailbox(auth.uid(), account_id));

CREATE POLICY email_sync_state_all ON public.email_sync_state
  FOR ALL TO authenticated
  USING (public.can_access_mailbox(auth.uid(), account_id))
  WITH CHECK (public.can_access_mailbox(auth.uid(), account_id));

CREATE POLICY email_links_select ON public.email_links
  FOR SELECT TO authenticated
  USING (public.can_access_mailbox(auth.uid(), account_id));
CREATE POLICY email_links_insert ON public.email_links
  FOR INSERT TO authenticated
  WITH CHECK (
    linked_by = auth.uid()
    AND public.can_access_mailbox(auth.uid(), account_id)
  );
CREATE POLICY email_links_delete ON public.email_links
  FOR DELETE TO authenticated
  USING (
    linked_by = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY['super_admin'::user_role,'founder'::user_role])
  );

CREATE POLICY email_summaries_select ON public.email_summaries
  FOR SELECT TO authenticated
  USING (public.can_access_mailbox(auth.uid(), account_id));
CREATE POLICY email_summaries_insert ON public.email_summaries
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_mailbox(auth.uid(), account_id));

-- =========================================================
-- Storage bucket for mail attachments
-- =========================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('mail-attachments', 'mail-attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "mail attachments read scoped" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'mail-attachments'
    AND EXISTS (
      SELECT 1 FROM public.email_attachments a
      WHERE a.storage_path = storage.objects.name
        AND public.can_access_mailbox(auth.uid(), a.account_id)
    )
  );
