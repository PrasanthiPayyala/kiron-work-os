
CREATE TABLE public.email_account_credentials (
  account_id uuid PRIMARY KEY REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  imap_password text NOT NULL,
  smtp_password text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Lock it down: RLS on, no policies → only service_role can touch it.
ALTER TABLE public.email_account_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_account_credentials FROM anon, authenticated;

CREATE TRIGGER trg_email_creds_updated BEFORE UPDATE ON public.email_account_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
