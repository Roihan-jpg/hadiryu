-- Keep existing authentication errors for accounts with no biometric state.
-- Every account with enrollment state still loses its login session atomically.
create or replace function private.face_disable_profile() returns trigger
language plpgsql security invoker set search_path='' as $$
declare stamp timestamptz:=clock_timestamp();
begin
  if old.is_active and not new.is_active and old.role='USER' then
    update public.biometric_templates set status='DISABLED' where user_id=new.id and status='ACTIVE';
    if exists(select 1 from public.biometric_templates where user_id=new.id)
       or exists(select 1 from public.face_enrollment_sessions where user_id=new.id) then
      update public.app_sessions set revoked_at=stamp where profile_id=new.id and revoked_at is null;
    end if;
    update public.face_reenrollment_grants set revoked_at=stamp where user_id=new.id and consumed_at is null and revoked_at is null;
    update public.face_enrollment_sessions set state='FAILED',claimed_at=coalesce(claimed_at,stamp),completed_at=stamp,
      failure_code='ACCOUNT_INACTIVE' where user_id=new.id and state in('ISSUED','PROCESSING');
  end if;
  return new;
end $$;
revoke all on function private.face_disable_profile() from public,anon,authenticated;
grant execute on function private.face_disable_profile() to service_role;
