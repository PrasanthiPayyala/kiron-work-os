-- Fix function search_path
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- projects ----------
drop policy "projects_update_owner_or_admin" on public.projects;
create policy "projects_update_owner_or_admin" on public.projects for update to authenticated
  using (owner_id = auth.uid() or created_by = auth.uid() or public.has_any_role(auth.uid(), array['super_admin','founder','founder_office_coordinator']::public.user_role[]))
  with check (owner_id = auth.uid() or created_by = auth.uid() or public.has_any_role(auth.uid(), array['super_admin','founder','founder_office_coordinator']::public.user_role[]));

-- ---------- project_members ----------
drop policy "project_members_admin_write" on public.project_members;
create policy "project_members_admin_write" on public.project_members for all to authenticated
  using (
    public.has_any_role(auth.uid(), array['super_admin','founder','founder_office_coordinator']::public.user_role[])
    or exists (select 1 from public.projects p where p.id = project_members.project_id and (p.owner_id = auth.uid() or p.created_by = auth.uid()))
  )
  with check (
    public.has_any_role(auth.uid(), array['super_admin','founder','founder_office_coordinator']::public.user_role[])
    or exists (select 1 from public.projects p where p.id = project_members.project_id and (p.owner_id = auth.uid() or p.created_by = auth.uid()))
  );

-- ---------- tasks ----------
drop policy "tasks_update_scoped" on public.tasks;
create policy "tasks_update_scoped" on public.tasks for update to authenticated
  using (
    assignee_id = auth.uid() or reviewer_id = auth.uid() or reporting_manager_id = auth.uid() or created_by = auth.uid()
    or public.has_any_role(auth.uid(), array['super_admin','founder','founder_office_coordinator']::public.user_role[])
  )
  with check (
    assignee_id = auth.uid() or reviewer_id = auth.uid() or reporting_manager_id = auth.uid() or created_by = auth.uid()
    or public.has_any_role(auth.uid(), array['super_admin','founder','founder_office_coordinator']::public.user_role[])
  );

-- ---------- task_dependencies ----------
drop policy "task_deps_write_scoped" on public.task_dependencies;
create policy "task_deps_write_scoped" on public.task_dependencies for all to authenticated
  using (
    exists (select 1 from public.tasks t where t.id = task_dependencies.task_id and (t.created_by = auth.uid() or t.reporting_manager_id = auth.uid()))
    or public.has_any_role(auth.uid(), array['super_admin','founder','manager','founder_office_coordinator']::public.user_role[])
  )
  with check (
    exists (select 1 from public.tasks t where t.id = task_dependencies.task_id and (t.created_by = auth.uid() or t.reporting_manager_id = auth.uid()))
    or public.has_any_role(auth.uid(), array['super_admin','founder','manager','founder_office_coordinator']::public.user_role[])
  );

-- ---------- approvals ----------
drop policy "approvals_update_approver" on public.approvals;
create policy "approvals_update_approver" on public.approvals for update to authenticated
  using (approver_id = auth.uid() or public.has_any_role(auth.uid(), array['super_admin','founder']::public.user_role[]))
  with check (approver_id = auth.uid() or public.has_any_role(auth.uid(), array['super_admin','founder']::public.user_role[]));

-- ---------- attendance_logs ----------
drop policy "attendance_update_scoped" on public.attendance_logs;
create policy "attendance_update_scoped" on public.attendance_logs for update to authenticated
  using (user_id = auth.uid() or public.has_any_role(auth.uid(), array['super_admin','hr_admin']::public.user_role[]))
  with check (user_id = auth.uid() or public.has_any_role(auth.uid(), array['super_admin','hr_admin']::public.user_role[]));

-- ---------- leave_requests ----------
drop policy "leave_update_scoped" on public.leave_requests;
create policy "leave_update_scoped" on public.leave_requests for update to authenticated
  using (user_id = auth.uid() or public.has_any_role(auth.uid(), array['super_admin','hr_admin']::public.user_role[]))
  with check (user_id = auth.uid() or public.has_any_role(auth.uid(), array['super_admin','hr_admin']::public.user_role[]));

-- ---------- conversations ----------
drop policy "conversations_update_creator" on public.conversations;
create policy "conversations_update_creator" on public.conversations for update to authenticated
  using (created_by = auth.uid() or public.has_role(auth.uid(),'super_admin'))
  with check (created_by = auth.uid() or public.has_role(auth.uid(),'super_admin'));