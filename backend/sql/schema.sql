-- Kiron schema, ported from supabase/migrations for the self-hosted Postgres.
-- Differences from the Supabase version:
--   * No `auth.users` — a local `users` table holds credentials; profiles.id -> users.id
--   * No RLS / no has_role functions — row access is enforced in the FastAPI layer
--   * No realtime publication / no handle_new_user trigger (signup/seed do that work)
--   * updated_at triggers are kept (harmless, useful)

-- ============================================================ ENUMS
create type public.user_role as enum (
  'super_admin','founder','founder_office_coordinator','founder_office_support',
  'manager','employee','intern','hr_admin'
);
create type public.user_status as enum ('active','intern','on_notice','on_leave','exited','inactive');
create type public.visibility_scope as enum (
  'team','company','department','manager_only','founder_office_only','founder_private'
);
create type public.task_status as enum (
  'draft','created','assigned','accepted','in_progress','waiting_for_review',
  'waiting_for_manager_approval','done','blocked','on_hold','rework_required',
  'escalated','cancelled'
);
create type public.priority_level as enum ('low','medium','high','critical');
create type public.dependency_type as enum ('blocked_by','starts_after','parallel');
create type public.approval_type as enum ('task_completion','project_creation','content','leave');
create type public.approval_status as enum ('pending','approved','rejected','returned');
create type public.leave_type as enum (
  'casual_leave','sick_leave','loss_of_pay','work_from_home','comp_off','optional_holiday'
);
create type public.leave_status as enum ('pending','approved','rejected','cancelled');
create type public.attendance_status as enum (
  'present','absent','half_day','holiday','weekly_off','work_from_home','leave'
);
create type public.notification_type as enum (
  'due_today','overdue','no_update_1_day','no_update_3_days','pending_approval',
  'recurring_upcoming','mention','announcement','general'
);
create type public.channel_type as enum ('direct','company_group','team_group','project_group','announcement');
create type public.employment_type as enum ('intern','contract','full_time','temporary','part_time');
create type public.holiday_type as enum ('gazetted','optional','informational');

-- ============================================================ AUTH
create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- ============================================================ MASTER
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  short_name text,
  initials text,
  color text,
  domain text,
  code text unique,
  logo_url text,
  is_active boolean not null default true,
  -- Default working schedule for everyone in the company. ISO day numbers
  -- (1=Mon … 7=Sun). Per-employee overrides live on profiles.
  work_days int[] not null default '{1,2,3,4,5,6}',
  work_start time not null default '09:30',
  work_end time not null default '18:30',
  -- Which Saturday-of-month positions are working (1..5). NULL = every
  -- Saturday in work_days is a working day. '{1,3,5}' = 1st, 3rd, 5th
  -- Saturday work; 2nd & 4th are off. No effect when 6 (Sat) isn't in
  -- work_days. See migration 0008_saturday_pattern.
  saturday_weeks_working int[],
  -- Company profile (migration 0009_company_profile). Captured by HR /
  -- founder office through Settings > Companies. All NULLABLE so existing
  -- rows are valid until somebody fills the details in.
  website_urls          text[],
  website_technologies  text,
  nature_of_business    text,
  date_of_incorporation date,
  is_startup            boolean not null default false,
  cin                   text,
  gst                   text,
  pan                   text,
  tan                   text,
  tin                   text,
  msme_udyam_number     text,
  msme_udyam_mobile     text,
  msme_udyam_email      text,
  dpiit_startup_number  text,
  registered_address    text,
  corporate_addresses   text[],
  operations_addresses  text[],
  phone_numbers         text[],
  -- Directors: jsonb list of {name, designation, din?}.
  directors             jsonb,
  -- Per-entity designations for the two founder principals (Kiran, Prashanti)
  -- — they appear on every profile so they're first-class columns rather
  -- than rows inside `directors`.
  kiran_designation     text,
  prashanti_designation text,
  certificates          text[],
  managing_ca_name      text,
  managing_ca_phone     text,
  managing_ca_email     text,
  ca_documents_held     text[],
  -- Indian state code (e.g. 'AP', 'TG', 'KA') used to look up the
  -- Professional Tax slab when generating payroll runs. NULL = no PT
  -- deduction for this entity.
  pt_state              text,
  created_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id, name)
);

-- Per-company addressable office locations with optional geofence.
-- profiles.office_id picks one for each employee; attendance.check_in
-- compares the captured lat/lng against (latitude, longitude, radius_m)
-- and stamps geo_outside_office=true on the log when out of range.
-- See alembic 0033.
create table public.offices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  address text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  radius_m int not null default 200 check (radius_m > 0 and radius_m <= 10000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
create index idx_offices_company_active
  on public.offices (company_id) where is_active = true;

create table public.profiles (
  id uuid primary key references public.users(id) on delete cascade,
  full_name text not null,
  email text unique,
  phone text,
  designation text,
  home_company_id uuid references public.companies(id),
  -- Per-employee office assignment for the geofence check on check-in.
  -- NULL = no office assigned, geofence skipped (back-compat with the
  -- 26 employees onboarded before offices existed).
  office_id uuid references public.offices(id),
  department_id uuid references public.departments(id),
  reporting_manager_id uuid references public.profiles(id),
  reviewer_id uuid references public.profiles(id),
  initials text,
  avatar_url text,
  skills text[],
  doj date,
  status public.user_status not null default 'active',
  productivity_score numeric(5,2),
  email_default_account_id uuid,
  is_active boolean not null default true,
  employment_type public.employment_type not null default 'full_time',
  tokens_invalid_after timestamptz,
  must_change_password boolean not null default false,
  -- Per-employee override of the company schedule. NULL = inherit.
  work_days int[],
  work_start time,
  work_end time,
  -- Per-employee Saturday-of-month override. NULL = inherit company. See
  -- companies.saturday_weeks_working for the encoding.
  saturday_weeks_working int[],
  created_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.user_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  department_id uuid references public.departments(id),
  created_by uuid references public.profiles(id),
  owner_id uuid references public.profiles(id),
  approver_id uuid references public.profiles(id),
  title text not null,
  description text,
  status text not null default 'draft',
  risk_level text default 'medium',
  progress integer not null default 0,
  visibility public.visibility_scope not null default 'team',
  is_strategic boolean not null default false,
  tags text[],
  start_date date,
  due_date date,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text default 'member',
  added_at timestamptz not null default now(),
  unique(project_id, user_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  task_key text unique,
  project_id uuid references public.projects(id) on delete set null,
  parent_task_id uuid references public.tasks(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  department_id uuid references public.departments(id),
  title text not null,
  description text,
  created_by uuid references public.profiles(id),
  assignee_id uuid references public.profiles(id),
  reviewer_id uuid references public.profiles(id),
  reporting_manager_id uuid references public.profiles(id),
  priority public.priority_level not null default 'medium',
  status public.task_status not null default 'draft',
  visibility public.visibility_scope not null default 'team',
  labels text[],
  client_name text,
  sla_hours integer,
  sla_due_at timestamptz,
  start_at timestamptz,
  due_at timestamptz,
  is_recurring boolean not null default false,
  recurrence_rule text,
  escalated_to_user_id uuid references public.profiles(id),
  approved_by_reviewer boolean not null default false,
  approved_by_manager boolean not null default false,
  no_update_days integer,
  email_notify_enabled boolean not null default false,
  email_notify_recipients text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  dependency public.dependency_type not null,
  created_at timestamptz not null default now(),
  unique(task_id, depends_on_task_id, dependency)
);

create table public.task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_user_id uuid references public.profiles(id),
  activity_type text not null,
  message text,
  old_value jsonb,
  new_value jsonb,
  note text,
  created_at timestamptz not null default now()
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  approval_type public.approval_type not null,
  target_type text not null,
  target_id uuid not null,
  target_label text,
  requested_by uuid references public.profiles(id),
  approver_id uuid references public.profiles(id),
  approval_route text,
  status public.approval_status not null default 'pending',
  comments text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create type public.comp_off_status as enum ('pending', 'approved', 'denied');

create table public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  check_in_at timestamptz,
  check_out_at timestamptz,
  worked_hours numeric(5,2),
  status public.attendance_status not null default 'present',
  source text default 'self_checkin',
  notes text,
  -- Comp-off earning fields (see alembic 0030). NULL on regular
  -- working days. Stamped 'pending' on check-in when work_date is an
  -- off-day for that user; HR flips to 'approved' or 'denied' from
  -- the Team Attendance review queue. apply_balance_delta is called
  -- only on the approved transition.
  comp_off_earned numeric(3,1),
  comp_off_status public.comp_off_status,
  comp_off_decided_by uuid references public.profiles(id),
  comp_off_decided_at timestamptz,
  -- Geo capture on check-in (see alembic 0033). NULL when geo was not
  -- captured (denied, timed out, or the employee was on WFH /
  -- field_work so the check was skipped).
  check_in_lat numeric(10,7),
  check_in_lng numeric(10,7),
  check_in_accuracy_m int,
  geo_denied boolean not null default false,
  geo_outside_office boolean not null default false,
  -- Daily aggregate of idle minutes pushed by the client's
  -- useIdleDetector hook. Raw per-interval audit lives in
  -- public.idle_intervals; HoursSummaryCard uses this aggregate.
  idle_minutes int not null default 0,
  created_at timestamptz not null default now(),
  unique(user_id, work_date)
);
create index idx_attendance_logs_pending_comp_off
  on public.attendance_logs (work_date desc)
  where comp_off_status = 'pending';

-- Per-interval audit of idle gaps detected by the client's
-- useIdleDetector hook (30-min threshold for `idle`; immediate for
-- `hidden` when the tab/window loses focus). attendance_logs.idle_minutes
-- is the daily aggregate used by HoursSummaryCard; this is the raw
-- detail HR can drill into if ever needed. UNIQUE (user, started_at)
-- makes POST idempotent on retry.
create table public.idle_intervals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  minutes int not null check (minutes > 0),
  source text not null check (source in ('idle', 'hidden')),
  created_at timestamptz not null default now(),
  unique (user_id, started_at)
);
create index idx_idle_intervals_user_date
  on public.idle_intervals (user_id, work_date desc);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  leave_type public.leave_type not null,
  start_date date not null,
  end_date date not null,
  days numeric(4,1) not null default 1,
  reason text,
  status public.leave_status not null default 'pending',
  hr_approver_id uuid references public.profiles(id),
  hr_comments text,
  -- Comp-off advance only: planned date the employee will work an off-day
  -- to repay this advance. NULL on every other leave type. See alembic 0031.
  -- Scheduler nags HR once the date passes and the comp_off balance is
  -- still negative.
  comp_off_repay_by date,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index idx_leave_requests_comp_off_repay_by
  on public.leave_requests (comp_off_repay_by)
  where comp_off_repay_by is not null;

-- Hourly attendance permissions (see alembic 0032). Lets employees +
-- HR record signed-off shortfalls (late-in / early-out / mid-day-out)
-- so an approved late arrival doesn't show as a compliance breach in
-- the hours-vs-expected rollup.
create type public.attendance_permission_kind as enum ('late_in', 'early_out', 'mid_out');
create type public.attendance_permission_status as enum ('pending', 'approved', 'rejected');
create table public.attendance_permissions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  date            date not null,
  kind            public.attendance_permission_kind not null,
  minutes         int not null check (minutes > 0 and minutes <= 720),
  reason          text,
  status          public.attendance_permission_status not null default 'pending',
  requested_by    uuid not null references public.profiles(id),
  decided_by      uuid references public.profiles(id),
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now()
);
create index idx_attendance_permissions_user_date
  on public.attendance_permissions (user_id, date desc);
create index idx_attendance_permissions_pending
  on public.attendance_permissions (date desc)
  where status = 'pending';

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  channel_type public.channel_type not null,
  company_id uuid references public.companies(id),
  project_id uuid references public.projects(id),
  task_id uuid references public.tasks(id),
  title text,
  created_by uuid references public.profiles(id),
  visibility public.visibility_scope not null default 'team',
  pinned boolean not null default false,
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz not null default now()
);

create table public.conversation_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text default 'member',
  joined_at timestamptz not null default now(),
  unique(conversation_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null,
  parent_message_id uuid references public.messages(id) on delete cascade,
  mentions uuid[],
  task_ref_id uuid references public.tasks(id),
  created_at timestamptz not null default now()
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  file_name text not null,
  file_url text not null,
  file_size bigint,
  mime_type text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_type public.notification_type not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  link text,
  send_email boolean not null default true,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  date date not null,
  name text not null,
  type public.holiday_type not null default 'gazetted',
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================ INDEXES
create index idx_profiles_company on public.profiles(home_company_id);
create index idx_profiles_manager on public.profiles(reporting_manager_id);
create index idx_user_roles_user on public.user_roles(user_id);
create index idx_projects_company on public.projects(company_id);
create index idx_project_members_project on public.project_members(project_id);
create index idx_holidays_date on public.holidays(date);
create unique index uq_holidays_company_date_name on public.holidays(
  coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), date, lower(name)
);
create index idx_project_members_user on public.project_members(user_id);
create index idx_tasks_project on public.tasks(project_id);
create index idx_tasks_company on public.tasks(company_id);
create index idx_tasks_assignee on public.tasks(assignee_id);
create index idx_tasks_reviewer on public.tasks(reviewer_id);
create index idx_tasks_status on public.tasks(status);
create index idx_task_activity_task on public.task_activity(task_id);
create index idx_attendance_user_date on public.attendance_logs(user_id, work_date);
create index idx_leave_user on public.leave_requests(user_id);
create index idx_conv_members_user on public.conversation_members(user_id);
create index idx_conv_members_conv on public.conversation_members(conversation_id);
create index idx_messages_conversation on public.messages(conversation_id, created_at);
create index idx_notifications_user on public.notifications(user_id, is_read);
create index idx_approvals_approver on public.approvals(approver_id);
create index idx_approvals_requester on public.approvals(requested_by);

-- ============================================================ updated_at triggers
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
create trigger trg_tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
