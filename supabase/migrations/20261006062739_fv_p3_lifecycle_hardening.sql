-- A grant authorizes replacing an existing template, never a later surprise replacement.
create or replace function public.face_enrollment_grant(p_hash text,p_user uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid; expiry timestamptz; stamp timestamptz:=clock_timestamp();
begin
  actor:=private.face_actor(p_hash,'SUPER_ADMIN');
  perform 1 from public.profiles where id=p_user and role='USER' and is_active for update;
  if not found then raise exception 'ACCOUNT_INACTIVE'; end if;
  if not exists(select 1 from public.biometric_templates where user_id=p_user) then
    raise exception 'REENROLLMENT_NOT_NEEDED';
  end if;
  update public.face_reenrollment_grants set revoked_at=stamp where user_id=p_user and consumed_at is null and revoked_at is null;
  insert into public.face_reenrollment_grants(user_id,actor_id,created_at,expires_at)
    values(p_user,actor,stamp,stamp+interval '24 hours') returning expires_at into expiry;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_data)
    values(actor,'FACE_REENROLLMENT_AUTHORIZED','face_enrollment',p_user,jsonb_build_object('expiresAt',expiry,'identityReviewed',true));
  return jsonb_build_object('expiresAt',expiry);
end $$;
revoke all on function public.face_enrollment_grant(text,uuid) from public,anon,authenticated;
grant execute on function public.face_enrollment_grant(text,uuid) to service_role;

-- Freeze biometrics even if an existing account-management path runs without
-- the local enrollment flag. Reactivation deliberately never restores them.
create function private.face_disable_profile() returns trigger
language plpgsql security invoker set search_path='' as $$
declare stamp timestamptz:=clock_timestamp();
begin
  if old.is_active and not new.is_active and old.role='USER' then
    update public.biometric_templates set status='DISABLED' where user_id=new.id and status='ACTIVE';
    update public.app_sessions set revoked_at=stamp where profile_id=new.id and revoked_at is null;
    update public.face_reenrollment_grants set revoked_at=stamp where user_id=new.id and consumed_at is null and revoked_at is null;
    update public.face_enrollment_sessions set state='FAILED',claimed_at=coalesce(claimed_at,stamp),completed_at=stamp,
      failure_code='ACCOUNT_INACTIVE' where user_id=new.id and state in('ISSUED','PROCESSING');
  end if;
  return new;
end $$;
revoke all on function private.face_disable_profile() from public,anon,authenticated;
grant execute on function private.face_disable_profile() to service_role;
create trigger face_disable_profile after update of is_active on public.profiles
  for each row execute function private.face_disable_profile();
