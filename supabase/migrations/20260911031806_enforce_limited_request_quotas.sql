create index leave_requests_late_arrival_quota_idx
on public.leave_requests (teacher_id, leave_date)
where leave_type = 'LATE_ARRIVAL' and status in ('PENDING', 'APPROVED');

create index early_departure_requests_quota_idx
on public.early_departure_requests (teacher_id, work_date)
where status in ('PENDING', 'APPROVED');

create or replace function private.guard_attendance_against_approved_leave()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.teacher_id::text || ':' || new.work_date::text, 0)
  );

  if exists (
    select 1
    from public.leave_requests
    where teacher_id = new.teacher_id
      and leave_date = new.work_date
      and leave_type <> 'LATE_ARRIVAL'
      and status = 'APPROVED'
  ) then
    raise exception using errcode = '23514', message = 'attendance_leave_conflict';
  end if;

  return new;
end;
$$;

create or replace function private.guard_leave_against_attendance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.teacher_id::text || ':' || new.leave_date::text, 0)
  );

  if exists (
    select 1
    from public.attendance_records
    where teacher_id = new.teacher_id
      and work_date = new.leave_date
  ) and (
    tg_op = 'INSERT'
    or (new.status = 'APPROVED' and new.leave_type <> 'LATE_ARRIVAL')
  ) then
    raise exception using errcode = '23514', message = 'attendance_leave_conflict';
  end if;

  return new;
end;
$$;

create function private.guard_late_arrival_monthly_quota()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  month_start date := pg_catalog.date_trunc('month', new.leave_date)::date;
begin
  if new.leave_type <> 'LATE_ARRIVAL' or new.status not in ('PENDING', 'APPROVED') then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      new.teacher_id::text || ':LATE_ARRIVAL:' || month_start::text,
      0
    )
  );

  if (
    select count(*)
    from public.leave_requests
    where teacher_id = new.teacher_id
      and leave_type = 'LATE_ARRIVAL'
      and status in ('PENDING', 'APPROVED')
      and leave_date >= month_start
      and leave_date < (month_start + interval '1 month')::date
  ) >= 2 then
    raise exception using errcode = 'P0001', message = 'LATE_ARRIVAL_MONTHLY_LIMIT_REACHED';
  end if;

  return new;
end;
$$;

create function private.guard_early_departure_monthly_quota()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  month_start date := pg_catalog.date_trunc('month', new.work_date)::date;
begin
  if new.status not in ('PENDING', 'APPROVED') then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      new.teacher_id::text || ':EARLY_DEPARTURE:' || month_start::text,
      0
    )
  );

  if (
    select count(*)
    from public.early_departure_requests
    where teacher_id = new.teacher_id
      and status in ('PENDING', 'APPROVED')
      and work_date >= month_start
      and work_date < (month_start + interval '1 month')::date
  ) >= 2 then
    raise exception using errcode = 'P0001', message = 'EARLY_DEPARTURE_MONTHLY_LIMIT_REACHED';
  end if;

  return new;
end;
$$;

create trigger leave_requests_guard_late_arrival_quota
before insert on public.leave_requests
for each row execute function private.guard_late_arrival_monthly_quota();

create trigger early_departure_requests_guard_monthly_quota
before insert on public.early_departure_requests
for each row execute function private.guard_early_departure_monthly_quota();

revoke execute on function private.guard_late_arrival_monthly_quota()
from public, anon, authenticated;
revoke execute on function private.guard_early_departure_monthly_quota()
from public, anon, authenticated;
