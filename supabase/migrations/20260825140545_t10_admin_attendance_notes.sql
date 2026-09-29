grant select
on table public.profiles, public.attendance_records, public.leave_requests,
  public.calendar_exceptions, public.attendance_admin_notes
to service_role;

grant insert
on table public.attendance_admin_notes
to service_role;

create function private.audit_attendance_admin_note()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data
  ) values (
    new.created_by,
    'ATTENDANCE_ADMIN_NOTE_CREATED',
    'attendance_admin_notes',
    new.id,
    null,
    pg_catalog.jsonb_build_object(
      'attendanceId', new.attendance_id,
      'note', new.note,
      'createdBy', new.created_by,
      'createdAt', new.created_at
    )
  );

  return new;
end;
$$;

create trigger attendance_admin_notes_audit_insert
after insert on public.attendance_admin_notes
for each row execute function private.audit_attendance_admin_note();

revoke execute on function private.audit_attendance_admin_note()
from public, anon, authenticated;
