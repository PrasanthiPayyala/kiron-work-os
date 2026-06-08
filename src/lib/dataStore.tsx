// Single shared data cache loaded from Supabase. Exposes the same shape that
// src/data/mock.ts used to expose, so the rest of the app can keep importing
// helpers like getUser/getCompany without rewriting every page.
//
// One global query at sign-in time pulls all small tables (companies, depts,
// profiles, roles, projects, members, tasks, approvals, attendance, leaves,
// conversations, members, messages). Mutations call Supabase directly and
// invalidate the relevant slices via the exposed `refresh` function.

import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  mapCompany, mapDepartment, mapProfile, mapProject, mapTask, mapApproval,
  mapAttendance, mapLeave, mapConversation, mapMessage, mapNotification,
  mapHoliday, pickPrimaryRole,
} from "@/lib/mappers";
import { offlineDB, replaceTable, setMeta, getMeta, clearAllData } from "@/lib/offline/db";
import { drainQueue } from "@/lib/offline/mutationQueue";
import { onRealtime } from "@/lib/ws";
import type {
  Company, Department, User, Project, Task, Approval,
  AttendanceLog, LeaveRequest, Conversation, Message, Notification, Role, Holiday,
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
  holidays: Holiday[];
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
  messages: [], notifications: [], holidays: [], rolesByUser: {},
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
    conversations: any[]; convMembers: { conversation_id: string; user_id: string; last_read_at?: string | null }[];
    messages: any[]; notifications: any[]; holidays?: any[];
    currentUserId?: string;
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
    const myLastReadByConv: Record<string, string | null> = {};
    for (const m of raw.convMembers) {
      (convMembers[m.conversation_id] ||= []).push(m.user_id);
      if (raw.currentUserId && m.user_id === raw.currentUserId) {
        myLastReadByConv[m.conversation_id] = m.last_read_at ?? null;
      }
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
      conversations: raw.conversations.map((c) =>
        mapConversation(c, convMembers[c.id] ?? [], myLastReadByConv[c.id]),
      ),
      messages: raw.messages.map(mapMessage),
      notifications: raw.notifications.map(mapNotification),
      holidays: (raw.holidays ?? []).map(mapHoliday),
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
      messages, notifications, holidays,
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
      offlineDB.holidays.toArray(),
    ]);
    return buildStore({
      companies, departments, profiles, projects, tasks, approvals,
      messages, notifications, conversations, holidays,
      userRoles: userRoles.map(({ user_id, role }) => ({ user_id, role })),
      projectMembers: projectMembers.map(({ project_id, user_id }) => ({ project_id, user_id })),
      convMembers: convMembers.map((m: any) => ({
        conversation_id: m.conversation_id, user_id: m.user_id, last_read_at: m.last_read_at,
      })),
      attendance, leaves,
      currentUserId: (await getMeta("currentUserId")) ?? undefined,
    });
  }, [buildStore]);

  // Fetch from the API (single /bootstrap call) + write through to IndexedDB.
  // Throws on network error so the caller can fall back to the cached snapshot.
  const fetchFromNetwork = useCallback(async (): Promise<Store> => {
    const b = await api.bootstrap();

    const raw = {
      companies: b.companies,
      departments: b.departments,
      profiles: b.profiles,
      userRoles: b.user_roles,
      projects: b.projects,
      projectMembers: b.project_members,
      tasks: b.tasks,
      approvals: b.approvals,
      attendance: b.attendance_logs,
      leaves: b.leave_requests,
      conversations: b.conversations,
      convMembers: b.conversation_members,
      messages: b.messages,
      notifications: b.notifications,
      holidays: b.holidays ?? [],
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
          replaceTable(offlineDB.holidays, raw.holidays),
          setMeta("lastHydratedAt", new Date().toISOString()),
        ]);
      } catch (err) {
        console.warn("[offline] mirror to IndexedDB failed", err);
      }
    })();

    return buildStore({ ...raw, currentUserId: (await getMeta("currentUserId")) ?? undefined });
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

  // Drive loading off the auth session (AuthProvider wraps this provider).
  // Realtime channels were removed with the Supabase migration — they return
  // in a later phase as a WebSocket subscription.
  const { user: authUser, loading: authLoading } = useAuth();
  const wasAuthed = useRef(false);

  useEffect(() => {
    if (authLoading) return; // wait until auth resolves before deciding
    if (authUser) {
      wasAuthed.current = true;
      // Persist the user id so cache-only hydrates (offline cold start) can
      // still compute per-user state (unread badges, optimistic rows). Await
      // the write before load() so hydrateFromCache sees it on this very call.
      void (async () => {
        await setMeta("currentUserId", authUser.id);
        await load();
      })();
    } else {
      setStore(empty);
      setLoading(false);
      // Wipe the offline cache on logout so the next user can't see this data.
      if (wasAuthed.current) void clearAllData();
      wasAuthed.current = false;
    }

    // On reconnect: replay any queued offline writes, then refresh. drainQueue
    // dispatches `kiron:queue-drained` after a successful replay, which also
    // triggers a reload so the UI reflects authoritative server state.
    const onOnline = () => {
      if (!authUser) return;
      void drainQueue().then(() => load());
    };
    const onDrained = () => { if (authUser) void load(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("kiron:queue-drained", onDrained);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("kiron:queue-drained", onDrained);
    };
  }, [authLoading, authUser?.id, load]);

  // ----- Realtime: apply WS events directly to the in-memory store -----
  // Chat / notifications / approvals stream in without a refresh. Each event
  // carries the full server row, so we can splice it in (or replace by id).
  useEffect(() => {
    if (!authUser) return;
    const off = onRealtime((ev) => {
      if (ev.type === "message.new") {
        const msg = mapMessage(ev.data as Parameters<typeof mapMessage>[0]);
        setStore((prev) => {
          // Avoid double-append if the sender's own POST already merged it.
          if (prev.messages.some((m) => m.id === msg.id)) return prev;
          return { ...prev, messages: [...prev.messages, msg] };
        });
      } else if (ev.type === "notification.new") {
        const n = mapNotification(ev.data as Parameters<typeof mapNotification>[0]);
        setStore((prev) => {
          if (prev.notifications.some((x) => x.id === n.id)) return prev;
          return { ...prev, notifications: [n, ...prev.notifications] };
        });
      } else if (ev.type === "approval.changed") {
        const a = mapApproval(ev.data as Parameters<typeof mapApproval>[0]);
        setStore((prev) => {
          const idx = prev.approvals.findIndex((x) => x.id === a.id);
          const next = [...prev.approvals];
          if (idx === -1) next.unshift(a); else next[idx] = a;
          return { ...prev, approvals: next };
        });
      }
    });
    return off;
  }, [authUser?.id]);

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
