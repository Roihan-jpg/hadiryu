alter table public.profiles
  add column whatsapp_number text,
  add column temporary_password_expires_at timestamptz;

alter table public.profiles
  add constraint profiles_whatsapp_number_check check (
    whatsapp_number is null or whatsapp_number ~ '^\+[1-9][0-9]{7,14}$'
  ),
  add constraint profiles_temporary_password_expiry_check check (
    temporary_password_expires_at is null or must_change_password
  );

alter table public.leave_requests
  add column attachment_storage_path text,
  add column attachment_original_name text,
  add column attachment_mime_type text,
  add column attachment_size_bytes integer,
  add constraint leave_requests_attachment_complete_check check (
    (attachment_storage_path is null and attachment_original_name is null
      and attachment_mime_type is null and attachment_size_bytes is null)
    or
    (attachment_storage_path is not null and attachment_original_name is not null
      and attachment_mime_type in ('application/pdf', 'image/jpeg', 'image/png')
      and attachment_size_bytes between 1 and 5242880)
  );

alter table public.early_departure_requests
  add column attachment_storage_path text,
  add column attachment_original_name text,
  add column attachment_mime_type text,
  add column attachment_size_bytes integer,
  add constraint early_departure_requests_attachment_complete_check check (
    (attachment_storage_path is null and attachment_original_name is null
      and attachment_mime_type is null and attachment_size_bytes is null)
    or
    (attachment_storage_path is not null and attachment_original_name is not null
      and attachment_mime_type in ('application/pdf', 'image/jpeg', 'image/png')
      and attachment_size_bytes between 1 and 5242880)
  );

create index if not exists audit_logs_action_created_at_idx
  on public.audit_logs (action, created_at desc);
create index if not exists audit_logs_entity_type_created_at_idx
  on public.audit_logs (entity_type, created_at desc);

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'request-attachments',
  'request-attachments',
  false,
  5242880,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function private.guard_request_attachment_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.created_at is distinct from old.created_at
    or new.attachment_storage_path is distinct from old.attachment_storage_path
    or new.attachment_original_name is distinct from old.attachment_original_name
    or new.attachment_mime_type is distinct from old.attachment_mime_type
    or new.attachment_size_bytes is distinct from old.attachment_size_bytes then
    raise exception using errcode = 'P0001', message = 'Request attachment metadata is immutable';
  end if;
  return new;
end;
$$;

create trigger leave_requests_guard_attachment_immutable
before update on public.leave_requests
for each row execute function private.guard_request_attachment_immutable();

create or replace function private.guard_early_departure_request_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.attendance_id <> old.attendance_id
    or new.teacher_id <> old.teacher_id
    or new.work_date <> old.work_date
    or new.requested_at <> old.requested_at
    or new.reason <> old.reason
    or new.latitude <> old.latitude
    or new.longitude <> old.longitude
    or new.accuracy_meters <> old.accuracy_meters
    or new.distance_meters <> old.distance_meters
    or new.boundary_clearance_meters is distinct from old.boundary_clearance_meters
    or new.attachment_storage_path is distinct from old.attachment_storage_path
    or new.attachment_original_name is distinct from old.attachment_original_name
    or new.attachment_mime_type is distinct from old.attachment_mime_type
    or new.attachment_size_bytes is distinct from old.attachment_size_bytes then
    raise exception using errcode = 'P0001', message = 'Early departure request data is immutable';
  end if;

  if old.status <> 'PENDING'
    or new.status not in ('APPROVED', 'REJECTED') then
    raise exception using errcode = 'P0001', message = 'EARLY_DEPARTURE_NOT_PENDING';
  end if;
  return new;
end;
$$;

create function public.create_early_departure_request_with_attachment(
  p_teacher_id uuid,
  p_reason text,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_meters numeric,
  p_distance_meters numeric,
  p_boundary_clearance_meters numeric,
  p_attachment_storage_path text,
  p_attachment_original_name text,
  p_attachment_mime_type text,
  p_attachment_size_bytes integer
)
returns public.early_departure_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  server_now timestamptz := pg_catalog.statement_timestamp();
  server_work_date date := (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::date;
  server_time time := (pg_catalog.statement_timestamp() at time zone 'Asia/Jakarta')::time;
  attendance public.attendance_records%rowtype;
  request public.early_departure_requests%rowtype;
  calculated_worked_minutes integer;
begin
  select * into attendance from public.attendance_records
  where teacher_id = p_teacher_id and work_date = server_work_date for update;
  if attendance.id is null then
    raise exception using errcode = 'P0001', message = 'CHECK_IN_REQUIRED';
  end if;
  if attendance.status <> 'CHECKED_IN' then
    raise exception using errcode = 'P0001', message = 'ATTENDANCE_ALREADY_COMPLETED';
  end if;
  if server_time >= attendance.work_end then
    raise exception using errcode = 'P0001', message = 'NOT_EARLY_DEPARTURE';
  end if;

  calculated_worked_minutes := greatest(0, pg_catalog.floor(
    extract(epoch from (server_now - attendance.check_in_at)) / 60
  )::integer);

  insert into public.early_departure_requests (
    attendance_id, teacher_id, work_date, requested_at, reason,
    latitude, longitude, accuracy_meters, distance_meters,
    boundary_clearance_meters, attachment_storage_path,
    attachment_original_name, attachment_mime_type, attachment_size_bytes
  ) values (
    attendance.id, p_teacher_id, server_work_date, server_now, p_reason,
    p_latitude, p_longitude, p_accuracy_meters, p_distance_meters,
    p_boundary_clearance_meters, p_attachment_storage_path,
    p_attachment_original_name, p_attachment_mime_type, p_attachment_size_bytes
  ) returning * into request;

  update public.attendance_records set
    check_out_at = server_now,
    check_out_latitude = p_latitude,
    check_out_longitude = p_longitude,
    check_out_accuracy_meters = p_accuracy_meters,
    check_out_distance_meters = p_distance_meters,
    check_out_boundary_clearance_meters = p_boundary_clearance_meters,
    worked_minutes = calculated_worked_minutes,
    work_deficit_minutes = greatest(0, attendance.target_minutes - calculated_worked_minutes),
    status = 'COMPLETED'
  where id = attendance.id;
  return request;
end;
$$;

revoke all on function public.create_early_departure_request_with_attachment(
  uuid, text, numeric, numeric, numeric, numeric, numeric, text, text, text, integer
) from public, anon, authenticated;
grant execute on function public.create_early_departure_request_with_attachment(
  uuid, text, numeric, numeric, numeric, numeric, numeric, text, text, text, integer
) to service_role;

revoke execute on function private.guard_request_attachment_immutable()
from public, anon, authenticated;
