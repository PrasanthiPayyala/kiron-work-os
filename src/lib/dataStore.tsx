// Single shared data cache loaded from Supabase. Exposes the same shape that
// src/data/mock.ts used to expose, so the rest of the app can keep importing
// helpers like getUser/getCompany without rewriting every page.
//
// One global query at sign-in time pulls all small tables (companies, depts,
// profiles, roles, projects, members, tasks, approvals, attendance, leaves,
// conversations, members, messages). Mutations call Supabase directly and
// invalidate the relevant slices via the exposed `refresh` function.

import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  mapCompany, mapDepartment, mapProfile, mapProject, mapTask, mapApproval,
  mapAttendance, mapLeave, mapConversation, mapMessage, mapNotification,
  pickPrimaryRole,
} from "@/lib/mappers";
import { offlineDB, replaceTable, setMeta, getMeta, clearAllData } from "@/lib/offline/db";
import type {
  Company, Department, User, Project, Task, Approval,
  AttendanceLog, LeaveRequest, Conversation, Message, Notification, Role,
} from "@/types";

type Store = {
  companies: Company[];
  departments: Department[];
  users: User[];
  projects: Project[];
  tasks: Task[];
  approvals: Approval[];
  attendance: AttendanceLog[];
  leaveRequests: LeaveRequest[];
  conversations: Conversation[];
  messages: Message[];
  notifications: Notification[];
  rolesByUser: Record<string, Role[]>;
};

type Ctx = Store & {
  loading: boolean;
  refresh: () => Promise<void>;
  getUser: (id?: string) => User | undefined;
  getCompany: (id?: string) => Company | undefined;
  getDepartment: (id?: string) => Department | undefined;
};

const empty: Store = {
  companies: [], departments: [], users: [], projects: [], tasks: [],
  approvals: [], attendance: [], leaveRequests: [], conversations: [],
  messages: [], notifications: [], rolesByUser: {},
};

const DataCtx = createContext<Ctx | null>(null);

export function DataStoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store>(empty);
  const [loading, setLoading] = useState(true);

  // Build the in-memory Store from raw snake_case rows (whether they came
  // from Supabase or the IndexedDB mirror). Pure function — no IO.
  const buildStore = useCallback((raw: {
    companies: any[]; departments: any[]; profiles: any[];
    userRoles: { user_id: string; role: string }[];
    projects: any[]; projectMembers: { project_id: string; user_id: string }[];
    tasks: any[]; approvals: any[]; attendance: any[]; leaves: any[];
    conversations: any[]; convMembers: { conversation_id: string; user_id: string }[];
    messages: any[]; notifications: any[];
  }): Store => {
    const rolesByUser: Record<string, Role[]> = {};
    for (const row of raw.userRoles) {
      (rolesByUser[row.user_id] ||= []).push(row.role as Role);
    }
    const projMembers: Record<string, string[]> = {};
    for (const m of raw.projectMembers) {
      (projMembers[m.project_id] ||= []).push(m.user_id);
    }
    const convMembers: Record<string, string[]> = {};
    for (const m of raw.convMembers) {
      (convMembers[m.conversation_id] ||= []).push(m.user_id);
    }
    return {
      companies: raw.companies.map(mapCompany),
      departments: raw.departments.map(mapDepartment),
      users: raw.profiles.map((p) =>
        mapProfile(p, pickPrimaryRole(rolesByUser[p.id] ?? ["employee"])),
      ),
      projects: raw.projects.map((p) => mapProject(p, projMembers[p.id] ?? [])),
      tasks: raw.tasks.map(mapTask),
      approvals: raw.approvals.map(mapApproval),
      attendance: raw.attendance.map(mapAttendance),
      leaveRequests: raw.leaves.map(mapLeave),
      conversations: raw.conversations.map((c) => mapConversation(c, convMembers[c.id] ?? [])),
      messages: raw.messages.map(mapMessage),
      notifications: raw.notifications.map(mapNotification),
      rolesByUser,
    };
  }, []);

  // Read snapshot from IndexedDB. Returns null if nothing has ever been cached.
  const hydrateFromCache = useCallback(async (): Promise<Store | null> => {
    const hydratedAt = await getMeta("lastHydratedAt");
    if (!hydratedAt) return null;
    const [
      companies, departments, profiles, userRoles, projects, projectMembers,
      tasks, approvals, attendance, leaves, conversations, convMembers,
      messages, notifications,
    ] = await Promise.all([
      offlineDB.companies.toArray(),
      offlineDB.departments.toArray(),
      offlineDB.profiles.toArray(),
      offlineDB.user_roles.toArray(),
      offlineDB.projects.toArray(),
      offlineDB.project_members.toArray(),
      offlineDB.tasks.toArray(),
      offlineDB.approvals.toArray(),
      offlineDB.attendance_logs.toArray(),
      offlineDB.leave_requests.toArray(),
      offlineDB.conversations.toArray(),
      offlineDB.conversation_members.toArray(),
      offlineDB.messages.toArray(),
      offlineDB.notifications.toArray(),
    ]);
    return buildStore({
      companies, departments, profiles, projects, tasks, approvals,
      messages, notifications, conversations,
      userRoles: userRoles.map(({ user_id, role }) => ({ user_id, role })),
      projectMembers: projectMembers.map(({ project_id, user_id }) => ({ project_id, user_id })),
      convMembers: convMembers.map(({ conversation_id, user_id }) => ({ conversation_id, user_id })),
      attendance, leaves,
    });
  }, [buildStore]);

  // Fetch from Supabase + write through to IndexedDB. Throws on network error.
  const fetchFromNetwork = useCallback(async (): Promise<Store> => {
    const [
      companiesR, deptsR, profilesR, rolesR, projectsR, projMembersR,
      tasksR, approvalsR, attR, leaveR, convsR, convMembersR, msgsR, notifsR,
    ] = await Promise.all([
      supabase.from("companies").select("*"),
      supabase.from("departments").select("*"),
      supabase.from("profiles").select("*"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("projects").select("*"),
      supabase.from("project_members").select("project_id, user_id"),
      supabase.from("tasks").select("*"),
      supabase.from("approvals").select("*"),
      supabase.from("attendance_logs").select("*"),
      supabase.from("leave_requests").select("*"),
      supabase.from("conversations").select("*"),
      supabase.from("conversation_members").select("conversation_id, user_id"),
      supabase.from("messages").select("*").order("created_at", { ascending: true }),
      supabase.from("notifications").select("*"),
    ]);

    const raw = {
      companies: companiesR.data ?? [],
      departments: deptsR.data ?? [],
      profiles: profilesR.data ?? [],
      userRoles: (rolesR.data ?? []) as { user_id: string; role: string }[],
      projects: projectsR.data ?? [],
      projectMembers: (projMembersR.data ?? []) as { project_id: string; user_id: string }[],
      tasks: tasksR.data ?? [],
      approvals: approvalsR.data ?? [],
      attendance: attR.data ?? [],
      leaves: leaveR.data ?? [],
      conversations: convsR.data ?? [],
      convMembers: (convMembersR.data ?? []) as { conversation_id: string; user_id: string }[],
      messages: msgsR.data ?? [],
      notifications: notifsR.data ?? [],
    };

    // Mirror to IndexedDB. Fire-and-forget so reads aren't blocked on disk.
    void (async () => {
      try {
        await Promise.all([
          replaceTable(offlineDB.companies, raw.companies),
          replaceTable(offlineDB.departments, raw.departments),
          replaceTable(offlineDB.profiles, raw.profiles),
          replaceTable(
            offlineDB.user_roles,
            raw.userRoles.map((r) => ({ ...r, pk: `${r.user_id}::${r.role}` })),
          ),
          replaceTable(offlineDB.projects, raw.projects),
          replaceTable(
            offlineDB.project_members,
            raw.projectMembers.map((m) => ({ ...m, pk: `${m.project_id}::${m.user_id}` })),
          ),
          replaceTable(offlineDB.tasks, raw.tasks),
          replaceTable(offlineDB.approvals, raw.approvals),
          replaceTable(offlineDB.attendance_logs, raw.attendance),
          replaceTable(offlineDB.leave_requests, raw.leaves),
          replaceTable(offlineDB.conversations, raw.conversations),
          replaceTable(
            offlineDB.conversation_members,
            raw.convMembers.map((m) => ({ ...m, pk: `${m.conversation_id}::${m.user_id}` })),
          ),
          replaceTable(offlineDB.messages, raw.messages),
          replaceTable(offlineDB.notifications, raw.notifications),
          setMeta("lastHydratedAt", new Date().toISOString()),
        ]);
      } catch (err) {
        console.warn("[offline] mirror to IndexedDB failed", err);
      }
    })();

    return buildStore(raw);
  }, [buildStore]);

  const load = useCallback(async () => {
    // 1. Hydrate from cache immediately — instant first paint, works offline.
    try {
      const cached = await hydrateFromCache();
      if (cached) {
        setStore(cached);
        setLoading(false); // unblock the UI; network refresh continues in bg
      }
    } catch (err) {
      console.warn("[offline] cache hydrate failed", err);
    }

    // 2. If online, fetch fresh + write through.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setLoading(false);
      return;
    }
    try {
      const fresh = await fetchFromNetwork();
      setStore(fresh);
    } catch (err) {
      console.warn("[offline] network fetch failed, staying on cached snapshot", err);
    } finally {
      setLoading(false);
    }
  }, [hydrateFromCache, fetchFromNetwork]);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (mounted && session) await load();
      else if (mounted) setLoading(false);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        // defer to avoid deadlock with the listener
        setTimeout(() => { load(); }, 0);
      } else {
        setStore(empty);
        setLoading(false);
        // Wipe the offline cache so the next user can't see this user's data.
        if (event === "SIGNED_OUT") {
          void clearAllData();
        }
      }
    });

    // Refresh from network when we come back online.
    const onOnline = () => { void load(); };
    window.addEventListener("online", onOnline);

    init();
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("online", onOnline);
    };
  }, [load]);

  // Realtime chat: subscribe to INSERTs on `messages` while a session exists.
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const start = () => {
      if (channel) return;
      channel = supabase
        .channel("realtime-messages")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload) => {
            const msg = mapMessage(payload.new as Parameters<typeof mapMessage>[0]);
            setStore((prev) => ({ ...prev, messages: [...prev.messages, msg] }));
          }
        )
        .subscribe();
    };

    const stop = () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) start();
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) start();
      else stop();
    });

    return () => {
      sub.subscription.unsubscribe();
      stop();
    };
  }, []);

  // Realtime notifications + approvals: bell badge and approvals page stay live.
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const start = () => {
      if (channel) return;
      channel = supabase
        .channel("realtime-notif-approvals")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications" },
          (payload) => {
            setStore((prev) => {
              const next = [...prev.notifications];
              if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
                const m = mapNotification(payload.new as Parameters<typeof mapNotification>[0]);
                const idx = next.findIndex((n) => n.id === m.id);
                if (idx === -1) next.unshift(m); else next[idx] = m;
              } else if (payload.eventType === "DELETE") {
                const id = (payload.old as { id?: string })?.id;
                if (id) return { ...prev, notifications: next.filter((n) => n.id !== id) };
              }
              return { ...prev, notifications: next };
            });
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "approvals" },
          (payload) => {
            setStore((prev) => {
              const next = [...prev.approvals];
              if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
                const m = mapApproval(payload.new as Parameters<typeof mapApproval>[0]);
                const idx = next.findIndex((a) => a.id === m.id);
                if (idx === -1) next.unshift(m); else next[idx] = m;
              } else if (payload.eventType === "DELETE") {
                const id = (payload.old as { id?: string })?.id;
                if (id) return { ...prev, approvals: next.filter((a) => a.id !== id) };
              }
              return { ...prev, approvals: next };
            });
          },
        )
        .subscribe();
    };

    const stop = () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) start();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) start();
      else stop();
    });

    return () => {
      sub.subscription.unsubscribe();
      stop();
    };
  }, []);

  const value = useMemo<Ctx>(() => ({
    ...store,
    loading,
    refresh: load,
    getUser: (id?: string) => store.users.find((u) => u.id === id),
    getCompany: (id?: string) => store.companies.find((c) => c.id === id),
    getDepartment: (id?: string) => store.departments.find((d) => d.id === id),
  }), [store, loading, load]);

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useDataStore() {
  const ctx = useContext(DataCtx);
  if (!ctx) throw new Error("useDataStore must be used within DataStoreProvider");
  return ctx;
}

// Convenience helpers (always use within a component, since they call the hook)
export const useUser = (id?: string) => useDataStore().getUser(id);
export const useCompany = (id?: string) => useDataStore().getCompany(id);
