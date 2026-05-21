create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('node','kiron')),
  event text not null,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received' check (status in ('received','processed','failed')),
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index idx_webhook_events_created_at on public.webhook_events (created_at desc);
create index idx_webhook_events_source_event on public.webhook_events (source, event);

alter table public.webhook_events enable row level security;

create policy "Super admins can view webhook events"
on public.webhook_events
for select
to authenticated
using (public.has_role(auth.uid(), 'super_admin'));