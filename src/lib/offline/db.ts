// IndexedDB cache for offline reads. Mirrors the subset of Supabase tables
// that `dataStore.tsx` hydrates at sign-in, so the app can render its full
// shell offline using the last known snapshot.
//
// Each table stores rows in their **raw Supabase shape** (snake_case columns)
// — the existing mappers in `src/lib/mappers.ts` run the same way whether the
// rows came from the network or this cache.

import Dexie, { type Table } from "dexie";

// Loose row shapes; we only care about `id` for primary keys.
export interface KeyedRow {
  id: string;
  [k: string]: unknown;
}

// Composite-key tables that don't have a single `id` column.
export interface UserRoleRow {
  user_id: string;
  role: string;
  // synthetic primary key = `${user_id}::${role}`
  pk: string;
}

export interface ProjectMemberRow {
  project_id: string;
  user_id: string;
  pk: string; // `${project_id}::${user_id}`
}

export interface ConversationMemberRow {
  conversation_id: string;
  user_id: string;
  pk: string; // `${conversation_id}::${user_id}`
}

// Single-row table tracking the most recent successful hydration.
export interface SyncMeta {
  key: string; // e.g. "lastHydratedAt", "lastUserId"
  value: string;
}

export class KironOfflineDB extends Dexie {
  companies!: Table<KeyedRow, string>;
  departments!: Table<KeyedRow, string>;
  profiles!: Table<KeyedRow, string>;
  user_roles!: Table<UserRoleRow, string>;
  projects!: Table<KeyedRow, string>;
  project_members!: Table<ProjectMemberRow, string>;
  tasks!: Table<KeyedRow, string>;
  approvals!: Table<KeyedRow, string>;
  attendance_logs!: Table<KeyedRow, string>;
  leave_requests!: Table<KeyedRow, string>;
  conversations!: Table<KeyedRow, string>;
  conversation_members!: Table<ConversationMemberRow, string>;
  messages!: Table<KeyedRow, string>;
  notifications!: Table<KeyedRow, string>;
  sync_meta!: Table<SyncMeta, string>;

  constructor() {
    super("kiron-offline");
    this.version(1).stores({
      companies: "id",
      departments: "id, company_id",
      profiles: "id, home_company_id",
      user_roles: "pk, user_id",
      projects: "id, company_id",
      project_members: "pk, project_id, user_id",
      tasks: "id, assignee_id, reviewer_id, status, company_id",
      approvals: "id, approver_id, requested_by, status",
      attendance_logs: "id, user_id, work_date",
      leave_requests: "id, user_id, status",
      conversations: "id",
      conversation_members: "pk, conversation_id, user_id",
      messages: "id, conversation_id, created_at",
      notifications: "id, user_id, is_read, created_at",
      sync_meta: "key",
    });
  }
}

export const offlineDB = new KironOfflineDB();

// ---------- helpers ----------

export async function setMeta(key: string, value: string) {
  await offlineDB.sync_meta.put({ key, value });
}

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await offlineDB.sync_meta.get(key);
  return row?.value;
}

/** Replace the whole table contents in one transaction. */
export async function replaceTable<T extends KeyedRow | UserRoleRow | ProjectMemberRow | ConversationMemberRow>(
  table: Table<T, string>,
  rows: T[],
) {
  await offlineDB.transaction("rw", table, async () => {
    await table.clear();
    if (rows.length) await table.bulkPut(rows);
  });
}

/** Wipe everything except sync_meta. Used on sign-out. */
export async function clearAllData() {
  await offlineDB.transaction(
    "rw",
    [
      offlineDB.companies, offlineDB.departments, offlineDB.profiles,
      offlineDB.user_roles, offlineDB.projects, offlineDB.project_members,
      offlineDB.tasks, offlineDB.approvals, offlineDB.attendance_logs,
      offlineDB.leave_requests, offlineDB.conversations,
      offlineDB.conversation_members, offlineDB.messages, offlineDB.notifications,
    ],
    async () => {
      await Promise.all([
        offlineDB.companies.clear(),
        offlineDB.departments.clear(),
        offlineDB.profiles.clear(),
        offlineDB.user_roles.clear(),
        offlineDB.projects.clear(),
        offlineDB.project_members.clear(),
        offlineDB.tasks.clear(),
        offlineDB.approvals.clear(),
        offlineDB.attendance_logs.clear(),
        offlineDB.leave_requests.clear(),
        offlineDB.conversations.clear(),
        offlineDB.conversation_members.clear(),
        offlineDB.messages.clear(),
        offlineDB.notifications.clear(),
      ]);
    },
  );
}
