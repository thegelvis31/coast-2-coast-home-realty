-- speed_to_lead_log
-- Audit + idempotency for the instant first-touch responder (speed-to-lead).
-- One row per lead that the responder evaluates. The UNIQUE index on lead_id is
-- what guarantees a lead can only ever receive ONE automated first touch, so the
-- engine can never double-message the leads Sierra is already working.

create table if not exists public.speed_to_lead_log (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  mode         text not null,                 -- dry_run | test | live
  action       text not null,                 -- processed | skipped
  skip_reasons text[] default '{}',
  plan         jsonb,                          -- exactly what would be / was sent
  result       jsonb,                          -- send results (sids, ok/fail)
  created_at   timestamptz not null default now()
);

create unique index if not exists speed_to_lead_log_lead_id_uniq
  on public.speed_to_lead_log (lead_id);

create index if not exists speed_to_lead_log_created_at_idx
  on public.speed_to_lead_log (created_at desc);

alter table public.speed_to_lead_log enable row level security;

-- Service role (the edge function) bypasses RLS automatically. This policy lets
-- authenticated staff read the audit log in the CRM UI.
drop policy if exists speed_to_lead_log_read on public.speed_to_lead_log;
create policy speed_to_lead_log_read
  on public.speed_to_lead_log
  for select
  to authenticated
  using (true);
