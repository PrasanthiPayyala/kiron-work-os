import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export function useUnreadMailCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      const { count: c } = await supabase
        .from("email_messages")
        .select("id", { count: "exact", head: true })
        .eq("is_read", false);
      if (!cancelled) setCount(c ?? 0);
    };
    load();
    const ch = supabase
      .channel("mail-unread")
      .on("postgres_changes", { event: "*", schema: "public", table: "email_messages" }, () => load())
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [user]);

  return count;
}
