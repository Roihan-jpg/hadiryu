create type public.gender as enum ('FEMALE', 'MALE');

grant usage on type public.gender to service_role;

alter table public.profiles
add column gender public.gender;

alter type public.leave_type add value if not exists 'MATERNITY_LEAVE';
