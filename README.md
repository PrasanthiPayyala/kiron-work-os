# Kiron Group — Internal Operations Platform

A unified, role-based work OS for **Kiron Group** that brings projects, tasks, attendance, leave, approvals, people, and team chat into a single web app. Built on React + Vite + Tailwind, backed by Lovable Cloud (Postgres + Auth + Edge Functions).

---

## ✨ What's Built

### 🔐 Authentication & Roles
- Email/password sign-in and sign-up via Lovable Cloud Auth
- 8 distinct roles with a dedicated capability matrix:
  - `super_admin`, `founder`, `founder_office_coordinator`, `founder_office_support`, `manager`, `hr_admin`, `employee`, `intern`
- Roles stored in a separate `user_roles` table (no privilege-escalation risk)
- A `has_role()` security-definer function powers all RLS policies
- Protected routes per capability (e.g. Reports, Founder Office, Settings)
- 36 real team members seeded and auth-provisioned (universal default password: `kiron@2025`)

### 🏠 Role-Aware Dashboards
Single `/dashboard` route renders a different view per role:
- **SuperAdminDashboard** — org-wide KPIs, every company, every approval queue
- **FounderDashboard** — strategic projects, founder-office work, escalations
- **ManagerDashboard** — team load, pending reviews, SLA breaches
- **EmployeeDashboard** — personal tasks, today's attendance, leave balance

### 📁 Projects
- List + filter by company, status, owner, strategic flag
- Project detail page with members, tasks, progress, risk level
- Visibility scopes: `team`, `company`, `department`, `manager_only`, `founder_office_only`, `founder_private`

### ✅ Tasks
- Full task lifecycle: `draft → created → assigned → accepted → in_progress → waiting_for_review → waiting_for_manager_approval → done`
- Plus side-states: `blocked`, `on_hold`, `rework_required`, `escalated`, `cancelled`
- Priority levels, SLA tracking, reviewer + reporting-manager chains
- Task dependencies (`blocked_by`, `starts_after`, `parallel`)
- Activity log per task
- **My Work** page = everything assigned to me + everything awaiting my review

### 🕐 Attendance
- One-click check-in / check-out (writes to `attendance_logs`)
- Status types: present, absent, half_day, holiday, weekly_off, work_from_home, leave
- Per-user worked-hours computation

### 🌴 Leave Management
- Submit requests (casual, sick, LOP, WFH, comp-off, optional holiday)
- HR Admin approval flow (writes to `leave_requests`)
- Status: pending → approved / rejected / cancelled

### 💬 Team Chat
- Direct messages, company groups, team groups, project groups, announcement channels
- Mentions, threaded replies (`parent_message_id`), task references
- Currently polls every 5s — ready to upgrade to Supabase Realtime

### ✔️ Approvals Center
- Unified queue for: task completions, project creations, content reviews, leave requests
- Approve / reject / return with comments
- Routed to the correct approver per `approval_route`

### 📊 Reports
- Aggregate views for leadership (gated by capability)
- Company-level breakdowns via `CompanyBadge`

### 👥 People Directory
- All employees with avatar, designation, department, home company
- Dedicated **Interns** view
- Per-person profile page (`/people/:id`)

### 🏢 Founder Office
- Private workspace for founder + coordinators + support
- Visibility-scoped to `founder_office_only` / `founder_private`

### ⚙️ Settings
- Super-admin-only configuration surface

### 🔔 Notifications
- Types: `due_today`, `overdue`, `no_update_1_day`, `no_update_3_days`, `pending_approval`, `recurring_upcoming`, `mention`, `announcement`, `general`
- Optional email send flag per notification

### 📧 Mail Module (Hybrid IMAP/SMTP)
- `/mail` route with 3-pane interface: mailboxes, message list, message detail
- Per-user mail account setup in **Settings → Mail Accounts** (IMAP/SMTP host, port, encryption, credentials)
- Credentials stored in a private `email_account_credentials` table (service-role only, never exposed to client)
- First-sync scope: last 30 days, INBOX + Sent
- AI summarization of long emails via `google/gemini-2.5-flash` (Lovable AI Gateway)
- Compose, reply, and draft saving through `send-mail` / `save-draft` edge functions
- Unread badge surfaced in the topbar / sidebar (`useUnreadMailCount`)
- **Email → Task** linking: open a message → "Create task" prefills `/tasks?from_email=…`, writes an `email_links` row
- **Task → Email** outbound: `send-task-update-email` edge function fires automated task-update emails via the assignee's connected SMTP account
- Mailbox access governed by `mailbox_permissions` + `can_access_mailbox()` RLS helper

---

## 🗄️ Database (Lovable Cloud)

| Table | Purpose |
|---|---|
| `companies` | Multi-company tenancy (Kiron group entities) |
| `departments` | Org structure inside each company |
| `profiles` | Public user info (mirrors `auth.users` 1:1 by id) |
| `user_roles` | Role assignments (separate table for security) |
| `projects` + `project_members` | Project catalog and membership |
| `tasks` + `task_dependencies` + `task_activity` | Full task graph |
| `approvals` | Unified approval queue across entity types |
| `attendance_logs` | Daily attendance records |
| `leave_requests` | Leave applications + HR decisions |
| `conversations` + `conversation_members` + `messages` | Chat backbone |
| `notifications` | In-app + email notification feed |
| `attachments` | Generic file metadata (linked to tasks / projects / companies via `entity_type` + `entity_id`, backed by the private `task-project-attachments` storage bucket) |
| `profiles_directory` | Safe public view of profiles for lookups |
| `email_accounts` + `email_account_credentials` | Per-user IMAP/SMTP mailboxes (credentials in private table) |
| `mailbox_permissions` | Shared/delegated mailbox access |
| `email_folders` + `email_sync_state` | Folder metadata + per-folder sync cursors |
| `email_threads` + `email_messages` + `email_recipients` + `email_attachments` | Email storage graph |
| `email_drafts` | Outbound drafts |
| `email_summaries` | Cached AI summaries per message |
| `email_links` | Email ↔ Task / Project linkage |

All tables have **Row-Level Security** enabled with policies driven by `has_role()` and membership checks.

---

## ⚡ Edge Functions

- **`provision-seed-users`** — idempotent admin function that creates `auth.users` for every profile (preserving UUIDs so all FKs stay intact). Default password: `kiron@2025`.
- **`save-mail-account`** / **`test-mail-connection`** — store and verify IMAP/SMTP credentials securely.
- **`get-mail-credentials`** — service-role retrieval of mail credentials for trusted server-side use.
- **`sync-mail-folder`** — hybrid IMAP sync (last 30 days, INBOX + Sent for v1).
- **`fetch-message-detail`** — on-demand full message body hydration.
- **`send-mail`** / **`save-draft`** — outbound SMTP send + draft persistence.
- **`summarize-email`** — AI summary via `google/gemini-2.5-flash`.
- **`send-task-update-email`** — outbound task-update notifications via the user's connected SMTP account.

---

## 🏗️ Tech Stack

- **Frontend**: React 18, Vite 5, TypeScript 5, React Router v6
- **UI**: Tailwind CSS v3, shadcn/ui (Radix primitives), Lucide icons
- **State**: React Query + a single `DataStoreProvider` that hydrates all small tables once at sign-in
- **Backend**: Lovable Cloud (Postgres, Auth, Edge Functions, Storage)
- **Charts**: Recharts (via `src/components/Charts.tsx`)
- **Testing**: Vitest

### Architecture Highlights
- **`src/lib/auth.tsx`** — `AuthProvider`, `useAuth()`, role capability map, `roleNavAccess`
- **`src/lib/dataStore.tsx`** — single shared cache; one `useDataStore()` hook gives every page access to companies, users, projects, tasks, approvals, attendance, leaves, conversations, messages, notifications
- **`src/lib/mappers.ts`** — DB-row → domain-type transformers
- **`src/components/AppShell.tsx`** — sidebar + topbar + nested routing
- **`src/components/ProtectedRoute.tsx`** — auth + capability gating

---

## 🚀 Getting Started

```bash
npm install
npm run dev
```

Sign in with any seeded account, e.g.:
- `kiran@kirongroup.in` / `kiron@2025` → Super Admin
- `prasanthi@kirongroup.in` / `kiron@2025` → Founder
- `anita@kirongroup.in` / `kiron@2025` → HR Admin
- `samiyuddin.mohammed@kirongroup.in` / `kiron@2025` → Manager
- `varsha.cheriyala@kirongroup.in` / `kiron@2025` → Employee
- `pallavi.gonepalli@kirongroup.in` / `kiron@2025` → Intern

---

## 📎 Attachments & Email Linking (Phase 1 polish)

- Shared `<AttachmentUploader>` and `<AttachmentList>` components mount on **Task detail** (Tasks page drawer) and **Project detail → Files tab**
- Files are uploaded to the private `task-project-attachments` storage bucket (25 MB cap) and indexed in the `attachments` table with `entity_type` (`task` / `project` / `company`) + `entity_id`
- Signed-URL downloads, owner/admin delete, authenticated read — all enforced via RLS
- `<LinkedEmails>` + `<LinkEntityDialog>` surface `email_links` rows on tasks and projects, so any mail thread connected from the Mail module shows up inline
- `MessageDetail` now renders a structured AI summary panel (action items, deadlines, mentioned people), avatar-based headers, and signed-URL attachment downloads

---

## 📋 Roadmap (Optional Next Steps)

- 🔁 Realtime chat (replace 5s polling with Supabase Realtime subscriptions)
- 🔑 Google OAuth sign-in
- 🔐 Password reset flow
- 🔔 Notifications Center page (Phase 2)
- 🏛️ Structured Founder Office workflows (Phase 3)
- 📊 Extended Reports + inline People/Admin edits (Phase 4)
- ⏰ SLA breach notifications via cron edge function
- 📧 Real email addresses (swap mock `@kirongroup.in` once issued)

