-- ============================================================
-- ENUMS
-- ============================================================
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

-- ============================================================
-- MASTER TABLES
-- ============================================================
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

create table public.profiles (
  id uuid primary key,
  full_name text not null,
  email text unique,
  phone text,
  designation text,
  home_company_id uuid references public.companies(id),
  department_id uuid references public.departments(id),
  reporting_manager_id uuid references public.profiles(id),
  reviewer_id uuid references public.profiles(id),
  initials text,
  avatar_url text,
  skills text[],
  doj date,
  status public.user_status not null default 'active',
  productivity_score numeric(5,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.user_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);

-- ============================================================
-- SECURITY DEFINER: has_role
-- ============================================================
create or replace function public.has_role(_user_id uuid, _role public.user_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles where user_id = _user_id and role = _role
  )
$$;

create or replace function public.has_any_role(_user_id uuid, _roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles where user_id = _user_id and role = any(_roles)
  )
$$;

-- ============================================================
-- PROJECTS
-- ============================================================
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

-- ============================================================
-- TASKS
-- ============================================================
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

-- ============================================================
-- APPROVALS
-- ============================================================
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

-- ============================================================
-- ATTENDANCE / LEAVE
-- ============================================================
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
  created_at timestamptz not null default now(),
  unique(user_id, work_date)
);

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
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- ============================================================
-- CONVERSATIONS / MESSAGES
-- ============================================================
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

-- ============================================================
-- ATTACHMENTS / NOTIFICATIONS
-- ============================================================
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

-- ============================================================
-- INDEXES
-- ============================================================
create index idx_profiles_company on public.profiles(home_company_id);
create index idx_profiles_manager on public.profiles(reporting_manager_id);
create index idx_user_roles_user on public.user_roles(user_id);
create index idx_projects_company on public.projects(company_id);
create index idx_project_members_project on public.project_members(project_id);
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

-- ============================================================
-- updated_at triggers
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
create trigger trg_tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- ============================================================
-- handle_new_user trigger: create profile + default role on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, initials)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    upper(substr(coalesce(new.raw_user_meta_data->>'full_name', new.email), 1, 2))
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'employee')
  on conflict do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- RLS
-- ============================================================
alter table public.companies enable row level security;
alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.task_activity enable row level security;
alter table public.approvals enable row level security;
alter table public.attendance_logs enable row level security;
alter table public.leave_requests enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.notifications enable row level security;

-- Helper: admin role check
-- super_admin / founder / hr_admin treated as elevated for most master ops
-- (Use has_any_role inline.)

-- ---------- companies ----------
create policy "companies_select_auth" on public.companies for select to authenticated using (true);
create policy "companies_admin_write" on public.companies for all to authenticated
  using (public.has_any_role(auth.uid(), array['super_admin','founder','hr_admin']::public.user_role[]))
  with check (public.has_any_role(auth.uid(), array['super_admin','founder','hr_admin']::public.user_role[]));

-- ---------- departments ----------
create policy "departments_select_auth" on public.departments for select to authenticated using (true);
create policy "departments_admin_write" on public.departments for all to authenticated
  using (public.has_any_role(auth.uid(), array['super_admin','founder','hr_admin']::public.user_role[]))
  with check (public.has_any_role(auth.uid(), array['super_admin','founder','hr_admin']::public.user_role[]));

-- ---------- profiles ----------
create policy "profiles_select_auth" on public.profiles for select to authenticated using (true);
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_admin_write" on public.profiles for all to authenticated
  using (public.has_any_role(auth.uid(), array['super_admin','hr_admin']::public.user_role[]))
  with check (public.has_any_role(auth.uid(), array['super_admin','hr_admin']::public.user_role[]));

-- ---------- user_roles ----------
create policy "user_roles_select_self_or_admin" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'super_admin'));
create policy "user_roles_admin_write" on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(), 'super_admin'))
  with check (public.has_role(auth.uid(), 'super_admin'));

-- ---------- projects ----------
create policy "projects_select_scoped" on public.projects for select to authenticated using (
  public.has_any_role(auth.uid(), array['super_admin','founder','founder_office_coordinator','founder_office_support']::public.user_role[])
  or owner_id = auth.uid()
  or created_by = auth.uid()
  or approver_id = auth.uid()
  or exists (select 1 from public.project_members pm where pm.project_id = projects.id and pm.user_id = auth.uid())
);
create policy "projects_insert_auth" on public.projects for insert to authenticated
  with check (created_by = auth.uid() or public.has_any_role(auth.uid(), array['super_admin','founder','manager','founder_office_coordinator']::public.user_role[]));
create policy "projects_update_owner_or_admin" on public.projects for update to authenticated
  using (owner_id = auth.uid() or created_by = auth.uid() or public.has_any_role(auth.uid(), array['super_admin','founder','founder_office_coordinator']::public.user_role[]))
  with check (true);

-- ---------- project_members ----------
create policy "project_members_select_scoped" on public.project_members for select to authenticated using (
  user_id = auth.uid()
  or public.has_any_role(auth.uid(), array['super_admin','founder','founder_office_coordinator']::public.user_role[])
  or exists (select 1 from public.projects p where p.id = project_members.project_id and (p.owner_id = auth.uid() or p.created_by = auth.uid()))
);
create policy "project_members_admin_write" on public.project_members for all to authenticated
  using (
    public.has_any_role(auth.uid(), array['super_admin','founder','founder_office_coordinator']::public.user_role[])
    or exists (select 1 from public.projects p where p.id = project_members.project_id and (p.owner_id = auth.uid() or p.created_by = auth.uid()))
  )
  with check (true);

-- ---------- tasks ----------
create policy "tasks_select_scoped" on public.tasks for select to authenticated using (
  public.has_any_role(auth.uid(), array['super_admin','founder','founder_office_coordinator','founder_office_support']::public.user_role[])
  or assignee_id = auth.uid()
  or reviewer_id = auth.uid()
  or reporting_manager_id = auth.uid()
  or created_by = auth.uid()
  or (project_id is not null and exists (select 1 from public.project_members pm where pm.project_id = tasks.project_id and pm.user_id = auth.uid()))
);
create policy "tasks_insert_auth" on public.tasks for insert to authenticated
  with check (created_by = auth.uid() or public.has_any_role(auth.uid(), array['super_admin','founder','manager','founder_office_coordinator','hr_admin']::public.user_role[]));
create policy "tasks_update_scoped" on public.tasks for update to authenticated
  using (
    assignee_id = auth.uid() or reviewer_id = auth.uid() or reporting_manager_id = auth.uid() or created_by = auth.uid()
    or public.has_any_role(auth.uid(), array['super_admin','founder','founder_office_coordinator']::public.user_role[])
  )
  with check (true);

-- ---------- task_dependencies ----------
create policy "task_deps_select_scoped" on public.task_dependencies for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_dependencies.task_id and (
    t.assignee_id = auth.uid() or t.reviewer_id = auth.uid() or t.created_by = auth.uid() or t.reporting_manager_id = auth.uid()
  ))
  or public.has_any_role(auth.uid(), array['super_admin','founder','founder_office_coordinator']::public.user_role[])
);
create policy "task_deps_write_scoped" on public.task_dependencies for all to authenticated
  using (
    exists (select 1 from public.tasks t where t.id = task_dependencies.task_id and (t.created_by = auth.uid() or t.reporting_manager_id = auth.uid()))
    or public.has_any_role(auth.uid(), array['super_admin','founder','manager','founder_office_coordinator']::public.user_role[])
  ) with check (true);

-- ---------- task_activity ----------
create policy "task_activity_select_scoped" on public.task_activity for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_activity.task_id and (
    t.assignee_id = auth.uid() or t.reviewer_id = auth.uid() or t.created_by = auth.uid() or t.reporting_manager_id = auth.uid()
  ))
  or public.has_any_role(auth.uid(), array['super_admin','founder','founder_office_coordinator']::public.user_role[])
);
create policy "task_activity_insert_auth" on public.task_activity for insert to authenticated
  with check (actor_user_id = auth.uid());

-- ---------- approvals ----------
create policy "approvals_select_scoped" on public.approvals for select to authenticated using (
  requested_by = auth.uid() or approver_id = auth.uid()
  or public.has_any_role(auth.uid(), array['super_admin','founder','founder_office_coordinator','hr_admin']::public.user_role[])
);
create policy "approvals_insert_auth" on public.approvals for insert to authenticated
  with check (requested_by = auth.uid());
create policy "approvals_update_approver" on public.approvals for update to authenticated
  using (approver_id = auth.uid() or public.has_any_role(auth.uid(), array['super_admin','founder']::public.user_role[]))
  with check (true);

-- ---------- attendance_logs ----------
create policy "attendance_select_scoped" on public.attendance_logs for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = attendance_logs.user_id and p.reporting_manager_id = auth.uid())
  or public.has_any_role(auth.uid(), array['super_admin','founder','hr_admin']::public.user_role[])
);
create policy "attendance_insert_self" on public.attendance_logs for insert to authenticated
  with check (user_id = auth.uid() or public.has_any_role(auth.uid(), array['super_admin','hr_admin']::public.user_role[]));
create policy "attendance_update_scoped" on public.attendance_logs for update to authenticated
  using (user_id = auth.uid() or public.has_any_role(auth.uid(), array['super_admin','hr_admin']::public.user_role[]))
  with check (true);

-- ---------- leave_requests ----------
create policy "leave_select_scoped" on public.leave_requests for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = leave_requests.user_id and p.reporting_manager_id = auth.uid())
  or public.has_any_role(auth.uid(), array['super_admin','founder','hr_admin']::public.user_role[])
);
create policy "leave_insert_self" on public.leave_requests for insert to authenticated
  with check (user_id = auth.uid());
create policy "leave_update_scoped" on public.leave_requests for update to authenticated
  using (user_id = auth.uid() or public.has_any_role(auth.uid(), array['super_admin','hr_admin']::public.user_role[]))
  with check (true);

-- ---------- conversations ----------
create policy "conversations_select_member" on public.conversations for select to authenticated using (
  exists (select 1 from public.conversation_members cm where cm.conversation_id = conversations.id and cm.user_id = auth.uid())
  or public.has_any_role(auth.uid(), array['super_admin','founder']::public.user_role[])
);
create policy "conversations_insert_auth" on public.conversations for insert to authenticated
  with check (created_by = auth.uid());
create policy "conversations_update_creator" on public.conversations for update to authenticated
  using (created_by = auth.uid() or public.has_role(auth.uid(),'super_admin')) with check (true);

-- ---------- conversation_members ----------
create policy "conv_members_select_self_or_co" on public.conversation_members for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.conversation_members cm2 where cm2.conversation_id = conversation_members.conversation_id and cm2.user_id = auth.uid())
  or public.has_any_role(auth.uid(), array['super_admin','founder']::public.user_role[])
);
create policy "conv_members_insert_creator" on public.conversation_members for insert to authenticated
  with check (
    exists (select 1 from public.conversations c where c.id = conversation_members.conversation_id and c.created_by = auth.uid())
    or public.has_any_role(auth.uid(), array['super_admin','founder']::public.user_role[])
  );
create policy "conv_members_delete_self_or_admin" on public.conversation_members for delete to authenticated
  using (user_id = auth.uid() or public.has_any_role(auth.uid(), array['super_admin','founder']::public.user_role[]));

-- ---------- messages ----------
create policy "messages_select_member" on public.messages for select to authenticated using (
  exists (select 1 from public.conversation_members cm where cm.conversation_id = messages.conversation_id and cm.user_id = auth.uid())
  or public.has_any_role(auth.uid(), array['super_admin','founder']::public.user_role[])
);
create policy "messages_insert_member" on public.messages for insert to authenticated with check (
  sender_id = auth.uid()
  and exists (select 1 from public.conversation_members cm where cm.conversation_id = messages.conversation_id and cm.user_id = auth.uid())
);
create policy "messages_update_sender" on public.messages for update to authenticated
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());

-- ---------- attachments ----------
create policy "attachments_select_auth" on public.attachments for select to authenticated using (true);
create policy "attachments_insert_self" on public.attachments for insert to authenticated
  with check (uploaded_by = auth.uid());
create policy "attachments_delete_owner_or_admin" on public.attachments for delete to authenticated
  using (uploaded_by = auth.uid() or public.has_any_role(auth.uid(), array['super_admin','founder']::public.user_role[]));

-- ---------- notifications ----------
create policy "notifications_select_self" on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy "notifications_update_self" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notifications_insert_admin" on public.notifications for insert to authenticated
  with check (public.has_any_role(auth.uid(), array['super_admin','founder','hr_admin','founder_office_coordinator']::public.user_role[]));
