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

  const load = useCallback(async () => {
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

    const rolesByUser: Record<string, Role[]> = {};
    for (const row of rolesR.data ?? []) {
      const uid = (row as any).user_id;
      const role = (row as any).role as Role;
      (rolesByUser[uid] ||= []).push(role);
    }

    const projMembers: Record<string, string[]> = {};
    for (const m of projMembersR.data ?? []) {
      (projMembers[(m as any).project_id] ||= []).push((m as any).user_id);
    }
    const convMembers: Record<string, string[]> = {};
    for (const m of convMembersR.data ?? []) {
      (convMembers[(m as any).conversation_id] ||= []).push((m as any).user_id);
    }

    setStore({
      companies: (companiesR.data ?? []).map(mapCompany),
      departments: (deptsR.data ?? []).map(mapDepartment),
      users: (profilesR.data ?? []).map((p) =>
        mapProfile(p, pickPrimaryRole(rolesByUser[(p as any).id] ?? ["employee"]))
      ),
      projects: (projectsR.data ?? []).map((p) => mapProject(p, projMembers[(p as any).id] ?? [])),
      tasks: (tasksR.data ?? []).map(mapTask),
      approvals: (approvalsR.data ?? []).map(mapApproval),
      attendance: (attR.data ?? []).map(mapAttendance),
      leaveRequests: (leaveR.data ?? []).map(mapLeave),
      conversations: (convsR.data ?? []).map((c) => mapConversation(c, convMembers[(c as any).id] ?? [])),
      messages: (msgsR.data ?? []).map(mapMessage),
      notifications: (notifsR.data ?? []).map(mapNotification),
      rolesByUser,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (mounted && session) await load();
      else if (mounted) setLoading(false);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        // defer to avoid deadlock with the listener
        setTimeout(() => { load(); }, 0);
      } else {
        setStore(empty);
        setLoading(false);
      }
    });

    init();
    return () => { mounted = false; sub.subscription.unsubscribe(); };
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
