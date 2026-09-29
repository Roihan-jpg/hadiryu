grant select, insert, update
on table public.leave_requests
to service_role;

grant select
on table public.profiles, public.attendance_records, public.calendar_exceptions, public.schedule_rules
to service_role;

grant insert
on table public.audit_logs
to service_role;

grant usage on type public.leave_type, public.leave_status
to service_role;

create or replace function private.guard_attendance_against_approved_leave()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(new.teacher_id::text || ':' || new.work_date::text, 0)
  );

  if exists (
    select 1
    from public.leave_requests
    where teacher_id = new.teacher_id
      and leave_date = new.work_date
      and status = 'APPROVED'
  ) then
    raise exception using
      errcode = '23514',
      message = 'attendance_leave_conflict';
  end if;

  return new;
end;
$$;

create or replace function private.guard_leave_against_attendance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(new.teacher_id::text || ':' || new.leave_date::text, 0)
  );

  if (tg_op = 'INSERT' or new.status = 'APPROVED') and exists (
    select 1
    from public.attendance_records
    where teacher_id = new.teacher_id
      and work_date = new.leave_date
  ) then
    raise exception using
      errcode = '23514',
      message = 'attendance_leave_conflict';
  end if;

  return new;
end;
$$;

create trigger attendance_records_guard_approved_leave
before insert on public.attendance_records
for each row execute function private.guard_attendance_against_approved_leave();

create trigger leave_requests_guard_attendance
before insert or update on public.leave_requests
for each row execute function private.guard_leave_against_attendance();

revoke execute on function private.guard_attendance_against_approved_leave()
from public, anon, authenticated;
revoke execute on function private.guard_leave_against_attendance()
from public, anon, authenticated;

create or replace function private.audit_leave_request_decision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'PENDING' and new.status in ('APPROVED', 'REJECTED') then
    insert into public.audit_logs (
      actor_id,
      action,
      entity_type,
      entity_id,
      before_data,
      after_data
    )
    values (
      new.decided_by,
      case new.status
        when 'APPROVED' then 'LEAVE_APPROVED'
        else 'LEAVE_REJECTED'
      end,
      'leave_requests',
      new.id,
      jsonb_build_object(
        'leaveDate', old.leave_date,
        'leaveType', old.leave_type,
        'reason', old.reason,
        'status', old.status,
        'decisionNote', old.decision_note
      ),
      jsonb_build_object(
        'leaveDate', new.leave_date,
        'leaveType', new.leave_type,
        'reason', new.reason,
        'status', new.status,
        'decisionNote', new.decision_note,
        'decidedBy', new.decided_by,
        'decidedAt', new.decided_at
      )
    );
  end if;

  return new;
end;
$$;

create trigger leave_requests_audit_decision
after update on public.leave_requests
for each row execute function private.audit_leave_request_decision();

revoke execute on function private.audit_leave_request_decision()
from public, anon, authenticated;
