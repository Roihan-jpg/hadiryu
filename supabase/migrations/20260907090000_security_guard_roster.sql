alter type public.user_role add value if not exists 'SECURITY_GUARD';

create table public.security_schedule_settings (
  id uuid primary key default gen_random_uuid(),
  day_shift jsonb not null,
  night_shift jsonb not null,
  day_one_morning_guard_id uuid not null references public.profiles(id) on delete restrict,
  day_one_night_guard_id uuid not null references public.profiles(id) on delete restrict,
  day_one_off_guard_id uuid not null references public.profiles(id) on delete restrict,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint security_schedule_settings_distinct_guards check (
    day_one_morning_guard_id <> day_one_night_guard_id
    and day_one_morning_guard_id <> day_one_off_guard_id
    and day_one_night_guard_id <> day_one_off_guard_id
  ),
  constraint security_schedule_settings_dates check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint security_schedule_settings_no_overlap exclude using gist (
    daterange(effective_from, effective_to, '[]') with &&
  )
);

create index security_schedule_settings_resolution_idx
  on public.security_schedule_settings (effective_from desc);

alter table public.security_schedule_settings enable row level security;
revoke all on table public.security_schedule_settings from anon, authenticated;
grant select, insert, update, delete on table public.security_schedule_settings to service_role;

create function public.save_security_schedule_settings(
  p_actor_id uuid,
  p_day_shift jsonb,
  p_night_shift jsonb,
  p_day_one_morning_guard_id uuid,
  p_day_one_night_guard_id uuid,
  p_day_one_off_guard_id uuid
)
returns public.security_schedule_settings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  today_jakarta date := (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date;
  old_rule public.security_schedule_settings%rowtype;
  new_rule public.security_schedule_settings%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('absensi.security_schedule_settings.version', 0));
  if exists (
    select 1 from public.profiles
    where id in (p_day_one_morning_guard_id, p_day_one_night_guard_id, p_day_one_off_guard_id)
      and (role <> 'SECURITY_GUARD' or not is_active)
  ) or (select count(*) from public.profiles where id in (p_day_one_morning_guard_id, p_day_one_night_guard_id, p_day_one_off_guard_id)) <> 3 then
    raise exception using errcode = 'P0001', message = 'SECURITY_ROSTER_MEMBER_INVALID';
  end if;
  delete from public.security_schedule_settings where effective_from > today_jakarta;
  select * into old_rule from public.security_schedule_settings
    where effective_from <= today_jakarta and (effective_to is null or effective_to >= today_jakarta)
    order by effective_from desc limit 1 for update;
  if old_rule.id is not null and old_rule.effective_from = today_jakarta then
    update public.security_schedule_settings set day_shift = p_day_shift, night_shift = p_night_shift,
      day_one_morning_guard_id = p_day_one_morning_guard_id, day_one_night_guard_id = p_day_one_night_guard_id,
      day_one_off_guard_id = p_day_one_off_guard_id, effective_to = null where id = old_rule.id returning * into new_rule;
  else
    if old_rule.id is not null then update public.security_schedule_settings set effective_to = today_jakarta - 1 where id = old_rule.id; end if;
    insert into public.security_schedule_settings(day_shift, night_shift, day_one_morning_guard_id, day_one_night_guard_id, day_one_off_guard_id, effective_from)
      values (p_day_shift, p_night_shift, p_day_one_morning_guard_id, p_day_one_night_guard_id, p_day_one_off_guard_id, today_jakarta)
      returning * into new_rule;
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_data, after_data)
    values (p_actor_id, 'SECURITY_SCHEDULE_SETTINGS_SAVED', 'security_schedule_settings', new_rule.id,
      case when old_rule.id is null then null else pg_catalog.to_jsonb(old_rule) - array['created_at', 'updated_at'] end,
      pg_catalog.to_jsonb(new_rule) - array['created_at', 'updated_at']);
  return new_rule;
end;
$$;

revoke all on function public.save_security_schedule_settings(uuid, jsonb, jsonb, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_security_schedule_settings(uuid, jsonb, jsonb, uuid, uuid, uuid) to service_role;
