# Kiron Group — Internal Operations Platform

## Stack
React 18, Vite 5, TypeScript 5, React Router v6, Tailwind CSS v3, 
shadcn/ui, Recharts, Vitest
Backend: Supabase (Postgres, Auth, Edge Functions, Storage)
State: React Query + DataStoreProvider (src/lib/dataStore.tsx)

## Key files
- src/lib/auth.tsx — AuthProvider, useAuth(), roleNavAccess, NavKey, can
- src/lib/dataStore.tsx — shared cache, useDataStore(), realtime messages channel at lines 137-152
- src/lib/mappers.ts — DB row to domain type transforms
- src/components/AppShell.tsx — sidebar, topbar, nested routing
- src/components/ProtectedRoute.tsx — auth + capability gating via roleNavAccess

## Routes
Public: / (Index), /login (Login), * (NotFound)
Protected (require ProtectedRoute + AppShell):
/dashboard, /my-work, /projects, /projects/:id, /tasks
/mail (require="mail"), /attendance, /leave, /chat
/approvals, /reports (require="reports"), /notifications
/people, /people/interns, /people/:id
/founder-office (require="founder_office"), /settings (require="settings")

## Roles (8)
super_admin, founder, founder_office_coordinator, founder_office_support,
manager, hr_admin, employee, intern

## NavKey capabilities
dashboard, my_work, projects, tasks, attendance, leave, chat,
approvals, reports, people, founder_office, settings, mail

## DataStoreProvider — what it hydrates at login
14 parallel queries: companies, departments, profiles, user_roles,
projects, project_members, tasks, approvals, attendance_logs,
leave_requests, conversations, conversation_members, messages, notifications

## Seeded accounts (password: Kiron@2025)
kiran@kirongroup.in → super_admin
prasanthi@kirongroup.in → founder
anita@kirongroup.in → hr_admin
samiyuddin.mohammed@kirongroup.in → manager
varsha.cheriyala@kirongroup.in → employee
pallavi.gonepalli@kirongroup.in → intern

## Email setup
cPanel hosted, different domains per group company
IMAP port 993 SSL, SMTP port 465 SSL
Server format: mail.yourdomain.com
Username: full email address

## Remaining build order
(empty — Supabase → FastAPI migration complete; mail module + task attachments are still Supabase-bound and need either a rebuild or feature-flag-off before team rollout)

## Shipped (was on the build order)
- Password reset flow (ResetPassword.tsx, UpdatePassword.tsx)
- Reports NavKey wired for super_admin, founder, founder_office_coordinator, manager, hr_admin
- Realtime chat — supabase.channel on `messages` INSERTs (migration 20260521000000_realtime_messages.sql)
- Mail module — 12 edge functions + Mail.tsx + settings/MailAccounts.tsx
- Email-to-task flow — MessageDetail → Tasks.tsx dialog + `email_links` insert
- Notifications center — /notifications page + topbar "View all" + realtime channel on `notifications`
- Approvals — realtime channel on `approvals`, filters (scope/kind/search), decision dialog with note, scope guard on Approve buttons
- My Work quick edit drawer — sheet with status/priority/due/assignee + comment, writes to `tasks` and `task_activity`
- SLA breach scheduler — `backend/app/scheduler.py` (APScheduler AsyncIOScheduler inside FastAPI, 15-min cadence, `pg_try_advisory_lock` for multi-worker safety); backfills `sla_due_at`, warns 4h before due, inserts overdue notifications + broadcasts over WS
- Attendance UX hardening — duplicate check-in/out guards, WFH/half-day select, live duration, weekend shading, approved-leave hint, avg-hours stat
