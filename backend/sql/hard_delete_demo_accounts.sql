-- Hard-delete the four demo seed accounts that shipped with the v0 build.
--
-- These were created by seed.py for early demos and have since been
-- DEACTIVATED via /users/{id}/deactivate. The platform's UI hides them
-- (filters on isActive) but they still appear in raw user lists and
-- in API queries that don't filter. This script removes them entirely.
--
-- The four targets:
--   anita@kirongroup.in              (was demo HR admin)
--   samiyuddin.mohammed@kirongroup.in (was demo manager)
--   varsha.cheriyala@kirongroup.in   (was demo employee)
--   pallavi.gonepalli@kirongroup.in  (was demo intern)
--
-- profiles.id -> users.id ON DELETE CASCADE, so deleting from users
-- cascades to profiles, user_roles, project_members, attendance_logs,
-- leave_requests, conversation_members, notifications. The non-cascade
-- FKs (projects.created_by, tasks.assignee_id, etc.) get NULL-ed before
-- the delete so any project/task they touched isn't lost.
-- messages/conversations/approvals.requested_by are NOT NULL, so demo-
-- created rows in those tables get deleted outright.
--
-- Run from the VM:
--   PGPASSWORD=$(sudo cat /root/.kiron-db-password) psql -h 127.0.0.1 \
--     -U kiron -d kiron -f /opt/kiron/backend/sql/hard_delete_demo_accounts.sql

\set ON_ERROR_STOP on

BEGIN;

-- Stage the target IDs once so each statement can reference them cheaply.
CREATE TEMP TABLE _demo_targets ON COMMIT DROP AS
SELECT id, email FROM profiles
WHERE email IN (
  'anita@kirongroup.in',
  'samiyuddin.mohammed@kirongroup.in',
  'varsha.cheriyala@kirongroup.in',
  'pallavi.gonepalli@kirongroup.in'
);

\echo ''
\echo '=== Targets ==='
SELECT * FROM _demo_targets;

\echo ''
\echo '=== Nulling out non-cascade FK refs on rows we want to keep ==='

UPDATE profiles       SET reporting_manager_id = NULL WHERE reporting_manager_id IN (SELECT id FROM _demo_targets);
UPDATE profiles       SET reviewer_id          = NULL WHERE reviewer_id          IN (SELECT id FROM _demo_targets);
UPDATE projects       SET created_by           = NULL WHERE created_by           IN (SELECT id FROM _demo_targets);
UPDATE projects       SET owner_id             = NULL WHERE owner_id             IN (SELECT id FROM _demo_targets);
UPDATE projects       SET approver_id          = NULL WHERE approver_id          IN (SELECT id FROM _demo_targets);
UPDATE tasks          SET created_by           = NULL WHERE created_by           IN (SELECT id FROM _demo_targets);
UPDATE tasks          SET assignee_id          = NULL WHERE assignee_id          IN (SELECT id FROM _demo_targets);
UPDATE tasks          SET reviewer_id          = NULL WHERE reviewer_id          IN (SELECT id FROM _demo_targets);
UPDATE tasks          SET reporting_manager_id = NULL WHERE reporting_manager_id IN (SELECT id FROM _demo_targets);
UPDATE tasks          SET escalated_to_user_id = NULL WHERE escalated_to_user_id IN (SELECT id FROM _demo_targets);
UPDATE task_activity  SET actor_user_id        = NULL WHERE actor_user_id        IN (SELECT id FROM _demo_targets);
UPDATE approvals      SET approver_id          = NULL WHERE approver_id          IN (SELECT id FROM _demo_targets);
UPDATE leave_requests SET hr_approver_id       = NULL WHERE hr_approver_id       IN (SELECT id FROM _demo_targets);
UPDATE attachments    SET uploaded_by          = NULL WHERE uploaded_by          IN (SELECT id FROM _demo_targets);

\echo ''
\echo '=== Deleting rows where the demo user is the sole / NOT NULL actor ==='
DELETE FROM approvals      WHERE requested_by IN (SELECT id FROM _demo_targets);
DELETE FROM leave_requests WHERE user_id      IN (SELECT id FROM _demo_targets);
DELETE FROM conversations  WHERE created_by   IN (SELECT id FROM _demo_targets);
DELETE FROM messages       WHERE sender_id    IN (SELECT id FROM _demo_targets);

\echo ''
\echo '=== Hard delete from users (cascades to profiles + cascade-children) ==='
DELETE FROM users WHERE id IN (SELECT id FROM _demo_targets);

\echo ''
\echo '=== Verification (should return 0 rows) ==='
SELECT id, email FROM profiles
WHERE email IN (
  'anita@kirongroup.in',
  'samiyuddin.mohammed@kirongroup.in',
  'varsha.cheriyala@kirongroup.in',
  'pallavi.gonepalli@kirongroup.in'
);

COMMIT;
\echo ''
\echo '=== Done. Demo accounts hard-deleted. ==='
