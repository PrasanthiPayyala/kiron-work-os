-- ---------- profiles: tighten select policy ----------
drop policy "profiles_select_auth" on public.profiles;
-- Self / manager / reviewer / HR / founder / super_admin / FO coordinators can see full row
create policy "profiles_select_self_or_admin" on public.profiles for select to authenticated
using (
  id = auth.uid()
  or reporting_manager_id = auth.uid()
  or reviewer_id = auth.uid()
  or public.has_any_role(auth.uid(), array['super_admin','founder','hr_admin','founder_office_coordinator']::public.user_role[])
);

-- Public directory view exposes only non-sensitive columns
create or replace view public.profiles_directory
with (security_invoker = true) as
select id, full_name, designation, home_company_id, department_id, initials, avatar_url, status, is_active
from public.profiles;

grant select on public.profiles_directory to authenticated;

-- ---------- attachments: tighten select ----------
drop policy "attachments_select_auth" on public.attachments;
create policy "attachments_select_scoped" on public.attachments for select to authenticated
using (
  uploaded_by = auth.uid()
  or public.has_any_role(auth.uid(), array['super_admin','founder','founder_office_coordinator']::public.user_role[])
  or (
    entity_type = 'task' and exists (
      select 1 from public.tasks t where t.id = attachments.entity_id and (
        t.assignee_id = auth.uid() or t.reviewer_id = auth.uid() or t.created_by = auth.uid() or t.reporting_manager_id = auth.uid()
        or (t.project_id is not null and exists (select 1 from public.project_members pm where pm.project_id = t.project_id and pm.user_id = auth.uid()))
      )
    )
  )
  or (
    entity_type = 'project' and exists (
      select 1 from public.projects p where p.id = attachments.entity_id and (
        p.owner_id = auth.uid() or p.created_by = auth.uid()
        or exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = auth.uid())
      )
    )
  )
  or (
    entity_type = 'message' and exists (
      select 1 from public.messages m
      join public.conversation_members cm on cm.conversation_id = m.conversation_id
      where m.id = attachments.entity_id and cm.user_id = auth.uid()
    )
  )
);

-- ---------- leave_requests: split self-update from HR-update ----------
drop policy "leave_update_scoped" on public.leave_requests;

-- HR / super_admin can change anything
create policy "leave_update_hr" on public.leave_requests for update to authenticated
using (public.has_any_role(auth.uid(), array['super_admin','hr_admin']::public.user_role[]))
with check (public.has_any_role(auth.uid(), array['super_admin','hr_admin']::public.user_role[]));

-- Owner can update only when the request is still pending and cannot escalate the status beyond 'cancelled'.
-- Owner cannot touch hr_approver_id / hr_comments / decided_at.
create policy "leave_update_self_pending" on public.leave_requests for update to authenticated
using (user_id = auth.uid() and status = 'pending')
with check (
  user_id = auth.uid()
  and status in ('pending','cancelled')
  and hr_approver_id is null
  and hr_comments is null
  and decided_at is null
);

-- ---------- task_activity: require task access to insert ----------
drop policy "task_activity_insert_auth" on public.task_activity;
create policy "task_activity_insert_member" on public.task_activity for insert to authenticated
with check (
  actor_user_id = auth.uid()
  and (
    public.has_any_role(auth.uid(), array['super_admin','founder','founder_office_coordinator']::public.user_role[])
    or exists (
      select 1 from public.tasks t where t.id = task_activity.task_id and (
        t.assignee_id = auth.uid() or t.reviewer_id = auth.uid() or t.created_by = auth.uid() or t.reporting_manager_id = auth.uid()
        or (t.project_id is not null and exists (select 1 from public.project_members pm where pm.project_id = t.project_id and pm.user_id = auth.uid()))
      )
    )
  )
);