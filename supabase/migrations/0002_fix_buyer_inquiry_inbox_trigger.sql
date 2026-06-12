-- Fix: new website leads were failing to insert into public.buyer_inquiries.
--
-- The seed_inbox_from_new_buyer_inquiry() trigger loops over staff users in
-- user_roles and inserts an action_inbox_items row (owner_id NOT NULL) for each.
-- Two orphaned user_roles rows had user_id = NULL (roles broker_owner,
-- super_admin). The trigger tried to create an inbox item owned by NULL, which
-- violated the NOT NULL constraint and aborted EVERY buyer_inquiries insert —
-- silently dropping inbound website leads.
--
-- Fix is two parts: make the trigger null-safe, and remove the orphaned rows.

create or replace function public.seed_inbox_from_new_buyer_inquiry()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  staff_user uuid;
  display_name text;
begin
  display_name := coalesce(nullif(trim(NEW.name), ''), NEW.email, 'New lead');
  for staff_user in
    select distinct ur.user_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id is not null                       -- <-- guard added
      and r.name in ('agent','broker_owner','broker_admin','isa')
  loop
    insert into public.action_inbox_items
      (owner_id, category, title, body, link_to, related_lead_id)
    values
      (staff_user, 'lead', 'New lead: ' || display_name,
       coalesce(NEW.listing_address, NEW.cta_source) ||
         case when NEW.message is not null and length(NEW.message) > 0
              then E'\n' || left(NEW.message, 280) else '' end,
       '/leads', NEW.id);
  end loop;
  return NEW;
end;
$function$;

delete from public.user_roles where user_id is null;
