
-- Private bucket for task/project attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-project-attachments', 'task-project-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can read all attachments in the bucket
CREATE POLICY "task_proj_att_read"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'task-project-attachments');

-- Authenticated users can upload
CREATE POLICY "task_proj_att_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'task-project-attachments' AND owner = auth.uid());

-- Owner or admins can delete
CREATE POLICY "task_proj_att_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'task-project-attachments'
  AND (owner = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['super_admin'::user_role, 'founder'::user_role]))
);
