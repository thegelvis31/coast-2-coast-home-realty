-- speed_to_lead_log  (dev2.0 / c2c-crm-dev)
-- Audit + idempotency for the instant first-touch responder. One row per
-- buyer_inquiries lead the responder evaluates. The UNIQUE(inquiry_id) index
-- guarantees a lead can only ever receive ONE automated first touch.

create table if not exists public.speed_to_lead_log (
  id           uuid primary key default gen_random_uuid(),
  inquiry_id   uuid not null references public.buyer_inquiries(id) on delete cascade,
  mode         text not null,                 -- dry_run | test | live
  action       text not null,                 -- processed | skipped
  skip_reasons text[] default '{}',
  plan         jsonb,                          -- exactly what would be / was sent
  result       jsonb,                          -- send results (twilio sids, ok/fail)
  created_at   timestamptz not null default now()
);

create unique index if not exists speed_to_lead_log_inquiry_id_uniq
  on public.speed_to_lead_log (inquiry_id);
create index if not exists speed_to_lead_log_created_at_idx
  on public.speed_to_lead_log (created_at desc);

alter table public.speed_to_lead_log enable row level security;

drop policy if exists speed_to_lead_log_read on public.speed_to_lead_log;
create policy speed_to_lead_log_read
  on public.speed_to_lead_log for select to authenticated using (true);
