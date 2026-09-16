alter table public.leave_requests
add column full_leave_end_date date,
add column early_departure_start_date date,
add column early_departure_end_date date,
add constraint leave_requests_maternity_dates_check check (
  (leave_type <> 'MATERNITY_LEAVE' and full_leave_end_date is null and early_departure_start_date is null and early_departure_end_date is null)
  or
  (leave_type = 'MATERNITY_LEAVE'
    and full_leave_end_date is not null
    and early_departure_start_date is not null
    and early_departure_end_date is not null
    and leave_date <= full_leave_end_date
    and full_leave_end_date < early_departure_start_date
    and early_departure_start_date <= early_departure_end_date)
);

alter table public.leave_requests
add constraint leave_requests_maternity_active_range_exclusion
exclude using gist (
  teacher_id with =,
  daterange(leave_date, early_departure_end_date, '[]') with &&
)
where (leave_type = 'MATERNITY_LEAVE' and status in ('PENDING', 'APPROVED'));

create index leave_requests_maternity_period_index
on public.leave_requests (teacher_id, leave_date, early_departure_end_date)
where leave_type = 'MATERNITY_LEAVE';
