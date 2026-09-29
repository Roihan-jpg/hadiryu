create table public.geofence_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  polygon_vertices jsonb not null,
  max_accuracy_meters integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint geofence_templates_name_check check (length(btrim(name)) between 1 and 100),
  constraint geofence_templates_vertices_check check (
    pg_catalog.jsonb_typeof(polygon_vertices) = 'array'
    and pg_catalog.jsonb_array_length(polygon_vertices) between 3 and 32
  ),
  constraint geofence_templates_accuracy_check check (max_accuracy_meters between 5 and 30)
);

create unique index geofence_templates_active_name_key
on public.geofence_templates (lower(btrim(name)))
where deleted_at is null;

alter table public.geofence_templates enable row level security;
grant select, insert, update on table public.geofence_templates to service_role;

alter table public.geofence_rules
add column template_id uuid references public.geofence_templates(id) on delete restrict;

grant update (template_id) on table public.geofence_rules to service_role;

insert into public.geofence_templates (name, polygon_vertices, max_accuracy_meters)
select 'Geofence Utama', polygon_vertices, max_accuracy_meters
from public.geofence_rules
where polygon_vertices is not null
  and effective_from <= (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date
  and (effective_to is null or effective_to >= (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date)
order by effective_from desc
limit 1;

create function public.create_geofence_template(p_actor_id uuid, p_template jsonb)
returns public.geofence_templates
language plpgsql security invoker set search_path = '' as $$
declare result public.geofence_templates%rowtype;
begin
  insert into public.geofence_templates (name, polygon_vertices, max_accuracy_meters)
  values (btrim(p_template ->> 'name'), p_template -> 'vertices', (p_template ->> 'maxAccuracyMeters')::integer)
  returning * into result;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_data)
  values (p_actor_id, 'GEOFENCE_TEMPLATE_CREATED', 'geofence_templates', result.id,
    pg_catalog.jsonb_build_object('name', result.name, 'vertices', result.polygon_vertices, 'maxAccuracyMeters', result.max_accuracy_meters));
  return result;
exception when unique_violation then
  raise exception using errcode = 'P0001', message = 'GEOFENCE_TEMPLATE_NAME_EXISTS';
end; $$;

create function public.update_geofence_template(p_actor_id uuid, p_template_id uuid, p_template jsonb)
returns public.geofence_templates
language plpgsql security invoker set search_path = '' as $$
declare before_row public.geofence_templates%rowtype; result public.geofence_templates%rowtype;
begin
  select * into before_row from public.geofence_templates where id = p_template_id and deleted_at is null for update;
  if before_row.id is null then raise exception using errcode = 'P0001', message = 'GEOFENCE_TEMPLATE_NOT_FOUND'; end if;
  update public.geofence_templates set name = btrim(p_template ->> 'name'), polygon_vertices = p_template -> 'vertices',
    max_accuracy_meters = (p_template ->> 'maxAccuracyMeters')::integer, updated_at = now()
  where id = p_template_id returning * into result;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id, 'GEOFENCE_TEMPLATE_UPDATED', 'geofence_templates', result.id,
    pg_catalog.to_jsonb(before_row), pg_catalog.to_jsonb(result));
  return result;
exception when unique_violation then
  raise exception using errcode = 'P0001', message = 'GEOFENCE_TEMPLATE_NAME_EXISTS';
end; $$;

create function public.delete_geofence_template(p_actor_id uuid, p_template_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare template_row public.geofence_templates%rowtype; today_jakarta date := (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date;
begin
  select * into template_row from public.geofence_templates where id = p_template_id and deleted_at is null for update;
  if template_row.id is null then return; end if;
  if exists (select 1 from public.geofence_rules where template_id = p_template_id and effective_from <= today_jakarta and (effective_to is null or effective_to >= today_jakarta)) then
    raise exception using errcode = 'P0001', message = 'ACTIVE_GEOFENCE_TEMPLATE';
  end if;
  update public.geofence_templates set deleted_at = now(), updated_at = now() where id = p_template_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_data)
  values (p_actor_id, 'GEOFENCE_TEMPLATE_DELETED', 'geofence_templates', p_template_id, pg_catalog.to_jsonb(template_row));
end; $$;

create function public.activate_geofence_template(p_actor_id uuid, p_template_id uuid)
returns public.geofence_rules
language plpgsql security invoker set search_path = '' as $$
declare template_row public.geofence_templates%rowtype; old_rule public.geofence_rules%rowtype; result public.geofence_rules%rowtype;
  future_rule public.geofence_rules%rowtype;
  today_jakarta date := (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date;
  first_vertex jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('absensi.geofence_rules.version', 0));
  select * into template_row from public.geofence_templates where id = p_template_id and deleted_at is null;
  if template_row.id is null then raise exception using errcode = 'P0001', message = 'GEOFENCE_TEMPLATE_NOT_FOUND'; end if;
  first_vertex := template_row.polygon_vertices -> 0;
  for future_rule in select * from public.geofence_rules where effective_from > today_jakarta order by effective_from for update loop
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_data)
    values (p_actor_id, 'GEOFENCE_FUTURE_VERSION_CANCELLED', 'geofence_rules', future_rule.id, pg_catalog.to_jsonb(future_rule));
  end loop;
  delete from public.geofence_rules where effective_from > today_jakarta;
  select * into old_rule from public.geofence_rules where effective_from <= today_jakarta and (effective_to is null or effective_to >= today_jakarta)
    order by effective_from desc limit 1 for update;
  if old_rule.id is not null and old_rule.effective_from = today_jakarta then
    update public.geofence_rules set latitude = (first_vertex ->> 'latitude')::numeric,
      longitude = (first_vertex ->> 'longitude')::numeric, radius_meters = 25,
      polygon_vertices = template_row.polygon_vertices, max_accuracy_meters = template_row.max_accuracy_meters,
      template_id = template_row.id, effective_to = null, updated_at = now()
    where id = old_rule.id returning * into result;
  else
    if old_rule.id is not null then update public.geofence_rules set effective_to = today_jakarta - 1 where id = old_rule.id; end if;
    insert into public.geofence_rules(latitude, longitude, radius_meters, polygon_vertices, max_accuracy_meters, template_id, effective_from)
    values ((first_vertex ->> 'latitude')::numeric, (first_vertex ->> 'longitude')::numeric, 25,
      template_row.polygon_vertices, template_row.max_accuracy_meters, template_row.id, today_jakarta)
    returning * into result;
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_id, 'GEOFENCE_TEMPLATE_ACTIVATED', 'geofence_rules', result.id,
    case when old_rule.id is null then null else pg_catalog.to_jsonb(old_rule) end,
    pg_catalog.jsonb_build_object('templateId', template_row.id, 'templateName', template_row.name,
      'vertices', result.polygon_vertices, 'maxAccuracyMeters', result.max_accuracy_meters,
      'effectiveFrom', result.effective_from));
  return result;
end; $$;

revoke all on function public.create_geofence_template(uuid, jsonb) from public;
revoke all on function public.update_geofence_template(uuid, uuid, jsonb) from public;
revoke all on function public.delete_geofence_template(uuid, uuid) from public;
revoke all on function public.activate_geofence_template(uuid, uuid) from public;
grant execute on function public.create_geofence_template(uuid, jsonb) to service_role;
grant execute on function public.update_geofence_template(uuid, uuid, jsonb) to service_role;
grant execute on function public.delete_geofence_template(uuid, uuid) to service_role;
grant execute on function public.activate_geofence_template(uuid, uuid) to service_role;
