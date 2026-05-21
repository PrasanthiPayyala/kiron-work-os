import { supabase } from "@/integrations/supabase/client";

export const mailApi = {
  testConnection: (body: any) => supabase.functions.invoke("test-mail-connection", { body }),
  saveAccount: (body: any) => supabase.functions.invoke("save-mail-account", { body }),
  syncFolder: (account_id: string, folder_path = "INBOX") =>
    supabase.functions.invoke("sync-mail-folder", { body: { account_id, folder_path } }),
  fetchMessage: (message_id: string) =>
    supabase.functions.invoke("fetch-message-detail", { body: { message_id } }),
  send: (body: any) => supabase.functions.invoke("send-mail", { body }),
  saveDraft: (body: any) => supabase.functions.invoke("save-draft", { body }),
  summarize: (body: { kind: "message" | "thread"; message_id?: string; thread_id?: string; force?: boolean }) =>
    supabase.functions.invoke("summarize-email", { body }),
};
