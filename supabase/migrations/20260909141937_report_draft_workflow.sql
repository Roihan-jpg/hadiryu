create table public.reporting_settings (
  singleton boolean primary key default true,
  operational_start_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_settings_singleton_check check (singleton)
);

alter table public.reporting_settings enable row level security;

revoke all privileges on table public.reporting_settings from public, anon, authenticated;
grant select, insert, update on table public.reporting_settings to service_role;

create trigger reporting_settings_set_updated_at
before update on public.reporting_settings
for each row execute function private.set_updated_at();

create or replace function public.save_reporting_settings(
  p_actor_id uuid,
  p_operational_start_date date
)
returns public.reporting_settings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_settings public.reporting_settings;
  new_settings public.reporting_settings;
begin
  select * into old_settings
  from public.reporting_settings
  where singleton
  for update;

  if old_settings.singleton is not null and exists (
    select 1
    from public.attendance_records
    where work_date >= old_settings.operational_start_date
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'REPORTING_OPERATIONAL_START_LOCKED';
  end if;

  insert into public.reporting_settings(singleton, operational_start_date)
  values (true, p_operational_start_date)
  on conflict (singleton) do update
  set operational_start_date = excluded.operational_start_date
  returning * into new_settings;

  insert into public.audit_logs(
    actor_id,
    action,
    entity_type,
    before_data,
    after_data
  ) values (
    p_actor_id,
    'REPORTING_SETTINGS_SAVED',
    'reporting_settings',
    case when old_settings.singleton is null then null else
      pg_catalog.to_jsonb(old_settings) - array['created_at', 'updated_at']
    end,
    pg_catalog.to_jsonb(new_settings) - array['created_at', 'updated_at']
  );

  return new_settings;
end;
$$;

revoke all on function public.save_reporting_settings(uuid, date)
  from public, anon, authenticated;
grant execute on function public.save_reporting_settings(uuid, date)
  to service_role;
