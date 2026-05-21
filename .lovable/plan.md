# Kiron Incremental Polish Plan

This is a large, multi-area upgrade. To keep it shippable and reviewable, I'll execute it in **5 sequenced phases**, each one self-contained. Nothing existing (auth, roles, dashboards, routing, tables, RLS, seeded users) gets replaced — only extended.

## Guiding rules (applied to every phase)
- Reuse current design tokens, `PageHeader`, `StatCard`, `CompanyBadge`, sidebar, topbar
- No new tables unless strictly required; extend existing ones with `ALTER TABLE` when possible
- All new RLS mirrors existing patterns (`has_any_role`, scoped EXISTS subqueries)
- No route changes; only new sub-routes under existing pages where needed
- Edge functions only when client+RLS can't do the job

---

## Phase 1 — Mail v1 polish + Attachments foundation
**Mail UI**
- `MessageList`: add date-range filter, mailbox filter chip, better empty/loading skeletons, sticky search
- `MailboxList`: collapsible per-account folder groups, persistent selection in localStorage
- `MessageDetail`: cleaner header (avatar + from/to/cc, timestamps), structured summary panel (action items, deadlines, people, links as chips), inline attachment chips, "Create task from email", "Link to project/task/company" actions with linked-entity display
- `ComposeDialog`: signature, attachment upload (uses `mail-attachments` bucket), better validation states
- Topbar unread badge already exists via `useUnreadMailCount` — polish styling, add tooltip
- Add "Linked Emails" section to `ProjectDetail.tsx` and `Tasks.tsx` detail using `email_links`

**Attachments (general)**
- New storage bucket `task-project-attachments` (private)
- Reuse existing `attachments` table (already present with `entity_type`, `entity_id`)
- New `<AttachmentList>` and `<AttachmentUploader>` shared components
- Mount on Task detail and Project detail
- Show file name / type / size / uploaded by / created at with download buttons
- Attachment chips in `task_activity` rendering

---

## Phase 2 — Notifications Center polish
- New `/notifications` page (extends existing system, doesn't replace)
- Grouping by date (Today / Yesterday / Earlier) and by type
- Filter bar: type multi-select, date range, read/unread toggle
- "Mark all as read", per-item mark read/unread
- Inline expansion with `body` + link
- Type icons + color tokens (reminders vs mentions vs approvals vs announcements)
- Topbar bell dropdown improved (recent 8 + "View all")

---

## Phase 3 — Founder Office structured workflows
- New table `founder_office_items` with columns: `id, section, title, owner_id, company_id, status, due_date, priority, notes, linked_task_id, linked_project_id, is_private, created_by, created_at, updated_at`
- `section` enum: `bids, hackathons, registrations, applications, mous, compliance, documentation, escalations, reminders, private`
- RLS: visible to super_admin, founder, founder_office_coordinator, founder_office_support (private section: founders only) — mirrors existing access patterns
- Refactor `FounderOffice.tsx` to load real data per section with card boards
- Each card: inline edit dialog, status badges, due date with overdue color, attachment list (uses generalized `attachments` table)

---

## Phase 4 — Reports + Admin/People polish
**Reports** (extend existing `Reports.tsx` with tabs):
- Employee productivity summary (tasks completed, on-time %, no-update count)
- Attendance × task performance scatter
- No-update employees (>1d, >3d)
- Blocked/escalated tasks list
- Reassignment history (from `task_activity` where activity_type=reassign)
- Founder Office progress snapshot (counts by section/status)
- Company-wise execution health
- Pending approvals summary
- Mail widgets: unread count, awaiting reply (sent items with no inbound reply within 48h heuristic), emails linked to tasks count

**Admin/People** (extend `People.tsx` and `PersonProfile.tsx`):
- Inline edit dialogs for: reporting manager, reviewer, role, company, department, status
- Intern onboarding subsection (filter status=intern, upcoming DOJ)
- Mailbox permission management UI in Settings → MailAccounts (uses existing `mailbox_permissions`)

---

## Phase 5 — Chat polish + Auth/account + cross-page UX
**Chat**
- Extract `useConversationMessages` hook abstracting current polling — internally swap to Supabase Realtime channel on `messages` table (additive, no UI break)
- Unread indicator per conversation
- Pinned note area (use `conversations.pinned` + new optional `pinned_note` text column)
- Skeleton loaders, better empty state

**Auth**
- `/settings/account` → Change password (uses `supabase.auth.updateUser`)
- `/auth/reset` request page (uses `resetPasswordForEmail`)
- Clearer toast messages on auth errors
- First-login banner if `profiles.full_name` looks like email

**Cross-page UX**
- Shared `<EmptyState>`, `<TableLoader>`, `<FilterBar>` components
- Apply to Tasks, Projects, People, Approvals, Leave, Attendance
- Stronger badges via `StatusBadges` extension
- Page header consistency pass

---

## Technical details (per phase)

**Migrations needed**
1. Phase 1: create `task-project-attachments` bucket + RLS; no schema changes (attachments table reused)
2. Phase 3: `founder_office_items` table + RLS + updated_at trigger; new enum `founder_office_section`
3. Phase 5: `conversations.pinned_note text`; enable realtime publication for `messages`

**Edge functions** — none new required. Existing mail functions stay as-is.

**Files** — ~40 new/edited files total across all phases, all additive.

---

## How I'd like to proceed

This plan is large enough that I recommend shipping it **one phase per turn** so you can review and course-correct between phases. After you approve the plan, I'll start with **Phase 1 (Mail polish + Attachments)** and pause for your sign-off before Phase 2.

Reply with "approve" to start Phase 1, or tell me which phases to prioritize / drop / reorder.
