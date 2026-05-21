-- Enable Supabase Realtime broadcasts for chat messages.
-- Needed by the postgres_changes subscription in src/lib/dataStore.tsx.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

-- Ensure UPDATE/DELETE payloads carry the full row, not just the PK,
-- so future event handlers can identify which message changed.
ALTER TABLE public.messages REPLICA IDENTITY FULL;
