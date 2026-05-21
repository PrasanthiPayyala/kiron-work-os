# Kiron Group — Internal Operations Platform

## Stack
React 18, Vite 5, TypeScript 5, React Router v6, Tailwind CSS v3, 
shadcn/ui, Recharts, Vitest
Backend: Supabase (Postgres, Auth, Edge Functions, Storage)
State: React Query + DataStoreProvider (src/lib/dataStore.tsx)

## Key files
- src/lib/auth.tsx — AuthProvider, useAuth(), roleNavAccess, NavKey, can
- src/lib/dataStore.tsx — shared cache, useDataStore(), 5s chat polling at lines 137-146
- src/lib/mappers.ts — DB row to domain type transforms
- src/components/AppShell.tsx — sidebar, topbar, nested routing
- src/components/ProtectedRoute.tsx — auth + capability gating via roleNavAccess

## Routes
Public: / (Index), /login (Login), * (NotFound)
Protected (require ProtectedRoute + AppShell):
/dashboard, /my-work, /projects, /projects/:id, /tasks
/mail (require="mail"), /attendance, /leave, /chat
/approvals, /reports (require="reports" — BUG: missing from all roles)
/people, /people/interns, /people/:id
/founder-office (require="founder_office"), /settings (require="settings")

## Roles (8)
super_admin, founder, founder_office_coordinator, founder_office_support,
manager, hr_admin, employee, intern

## NavKey capabilities
dashboard, my_work, projects, tasks, attendance, leave, chat,
approvals, reports, people, founder_office, settings, mail

## Known bug
"reports" NavKey is missing from roleNavAccess for all 8 roles in
auth.tsx:91 — /reports always redirects to /dashboard

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
1. Password reset flow
2. Fix reports NavKey bug
3. Realtime chat (replace polling in dataStore.tsx lines 137-146)
4. Mail module activation (cPanel IMAP)
5. Attendance UX hardening
6. Approvals realtime + polish
7. Notifications center page
8. SLA breach cron edge function
9. Email to task flow
10. My Work quick edit drawer
