-- Backend-only RPCs. Password verification and encryption remain in Express.
alter table public.app_sessions add constraint app_sessions_owner_unique unique(token_hash,profile_id);
alter table public.face_enrollment_sessions
  add constraint face_session_owner_fk foreign key(auth_session_hash,user_id)
    references public.app_sessions(token_hash,profile_id) on delete cascade,
  add column account_revision timestamptz,
  add column claim_id uuid,
  add column recovery_grant_id uuid;

create table public.face_reauth_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  auth_session_hash text not null,
  account_revision timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  accepted boolean,
  used_at timestamptz,
  foreign key(auth_session_hash,user_id) references public.app_sessions(token_hash,profile_id) on delete cascade
);
create index face_reauth_attempts_user_time on public.face_reauth_attempts(user_id,created_at desc);
create table public.face_reenrollment_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
  consumed_at timestamptz,
  revoked_at timestamptz,
  check(expires_at>created_at and expires_at<=created_at+interval '24 hours 1 second')
);
create index face_reenrollment_grants_user on public.face_reenrollment_grants(user_id,expires_at desc);
alter table public.face_enrollment_sessions add foreign key(recovery_grant_id) references public.face_reenrollment_grants(id);
alter table public.face_reauth_attempts enable row level security;
alter table public.face_reenrollment_grants enable row level security;
revoke all on public.face_reauth_attempts,public.face_reenrollment_grants from public,anon,authenticated;
grant select,insert,update,delete on public.face_reauth_attempts,public.face_reenrollment_grants to service_role;

-- Same lock order for every enrollment operation: profile, account, login, enrollment.
create function private.face_actor(p_hash text,p_role text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare uid uuid; profile public.profiles; account public.app_accounts; login public.app_sessions;
begin
  select profile_id into uid from public.app_sessions where token_hash=p_hash;
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into profile from public.profiles where id=uid for update;
  if not profile.is_active then raise exception 'ACCOUNT_INACTIVE'; end if;
  if profile.role::text<>p_role then raise exception 'ROLE_FORBIDDEN'; end if;
  select * into account from public.app_accounts where profile_id=uid for update;
  if account.profile_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if account.locked_until>clock_timestamp() then raise exception 'ACCOUNT_LOCKED'; end if;
  select * into login from public.app_sessions where token_hash=p_hash for update;
  if login.revoked_at is not null or login.expires_at<=clock_timestamp() then raise exception 'AUTH_REQUIRED'; end if;
  return uid;
end $$;

create function public.face_enrollment_reauth(p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid; attempt uuid; account public.app_accounts;
begin
  uid:=private.face_actor(p_hash,'USER');
  if (select count(*) from public.face_reauth_attempts where user_id=uid
      and created_at>clock_timestamp()-interval '15 minutes' and accepted is distinct from true)>=5
    then return jsonb_build_object('error','REAUTH_LIMIT'); end if;
  select * into account from public.app_accounts where profile_id=uid;
  insert into public.face_reauth_attempts(user_id,auth_session_hash,account_revision)
    values(uid,p_hash,account.password_changed_at) returning id into attempt;
  return jsonb_build_object('attemptId',attempt,'passwordHash',account.password_hash,'accountRevision',account.password_changed_at);
end $$;

create function public.face_enrollment_issue(p_hash text,p_attempt uuid,p_valid boolean,p_model text,p_steps text[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid; attempt public.face_reauth_attempts; account public.app_accounts; sess public.face_enrollment_sessions;
  grant_id uuid; stamp timestamptz:=clock_timestamp();
begin
  uid:=private.face_actor(p_hash,'USER');
  select * into attempt from public.face_reauth_attempts where id=p_attempt and user_id=uid and auth_session_hash=p_hash for update;
  select * into account from public.app_accounts where profile_id=uid;
  if attempt.id is null or attempt.used_at is not null or attempt.created_at<stamp-interval '60 seconds'
    or attempt.account_revision<>account.password_changed_at then raise exception 'REAUTH_REQUIRED'; end if;
  update public.face_reauth_attempts set accepted=p_valid,used_at=stamp where id=p_attempt;
  if not p_valid then
    insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_data)
      values(uid,'FACE_REAUTH_FAILED','face_enrollment',p_attempt,jsonb_build_object('failureCode','INVALID_CREDENTIALS'));
    return jsonb_build_object('error','INVALID_CREDENTIALS');
  end if;
  if cardinality(p_steps)<>2 or not ('BLINK'=any(p_steps)) or p_steps[1]=p_steps[2]
     or not (p_steps<@array['BLINK','TURN_LEFT','TURN_RIGHT']::text[]) then raise exception 'VALIDATION_ERROR'; end if;
  if not exists(select 1 from public.face_model_versions where id=p_model and status='EVALUATION') then raise exception 'MODEL_UNAVAILABLE'; end if;
  if exists(select 1 from public.biometric_templates where user_id=uid) then
    select id into grant_id from public.face_reenrollment_grants where user_id=uid and consumed_at is null
      and revoked_at is null and expires_at>stamp order by created_at desc limit 1 for update;
    if grant_id is null then return jsonb_build_object('error','REENROLLMENT_APPROVAL_REQUIRED'); end if;
  end if;
  if (select count(*) from public.face_enrollment_sessions where user_id=uid and created_at>stamp-interval '1 hour')>=10
    then return jsonb_build_object('error','ENROLLMENT_LIMIT'); end if;
  update public.face_enrollment_sessions set state='FAILED',claimed_at=coalesce(claimed_at,stamp),completed_at=stamp,
    failure_code='SESSION_REPLACED' where user_id=uid and state='ISSUED';
  if exists(select 1 from public.face_enrollment_sessions where user_id=uid and state='PROCESSING'
    and claimed_at>stamp-interval '30 seconds') then return jsonb_build_object('error','SESSION_BUSY'); end if;
  update public.face_enrollment_sessions set state='FAILED',completed_at=stamp,failure_code='INFERENCE_TIMEOUT'
    where user_id=uid and state='PROCESSING' and claimed_at<=stamp-interval '30 seconds';
  insert into public.face_enrollment_sessions(user_id,auth_session_hash,purpose,model_version,challenge_steps,
    reauthenticated_at,created_at,expires_at,account_revision,recovery_grant_id)
    values(uid,p_hash,'ENROLLMENT',p_model,p_steps,stamp,stamp,stamp+interval '120 seconds',account.password_changed_at,grant_id)
    returning * into sess;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_data)
    values(uid,'FACE_ENROLLMENT_ISSUED','face_enrollment',sess.id,jsonb_build_object('modelVersion',p_model));
  return jsonb_build_object('sessionId',sess.id,'expiresAt',sess.expires_at,'modelVersion',p_model,'steps',sess.challenge_steps);
end $$;

create function private.face_session(p_hash text,p_id uuid) returns public.face_enrollment_sessions
language plpgsql security invoker set search_path='' as $$
declare uid uuid; sess public.face_enrollment_sessions; revision timestamptz;
begin
  uid:=private.face_actor(p_hash,'USER');
  select * into sess from public.face_enrollment_sessions where id=p_id and user_id=uid and auth_session_hash=p_hash for update;
  if sess.id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  select password_changed_at into revision from public.app_accounts where profile_id=uid;
  if sess.account_revision is null or sess.account_revision<>revision then raise exception 'REAUTH_REQUIRED'; end if;
  return sess;
end $$;

create function public.face_enrollment_claim(p_hash text,p_id uuid,p_claim uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare sess public.face_enrollment_sessions; stamp timestamptz:=clock_timestamp();
begin
  sess:=private.face_session(p_hash,p_id);
  if sess.state<>'ISSUED' then raise exception 'SESSION_USED'; end if;
  if sess.expires_at<=stamp then raise exception 'SESSION_EXPIRED'; end if;
  if not exists(select 1 from public.face_model_versions where id=sess.model_version and status='EVALUATION') then raise exception 'MODEL_UNAVAILABLE'; end if;
  if (select count(*) from public.face_enrollment_sessions where user_id=sess.user_id and claimed_at>stamp-interval '1 hour')>=5
    then raise exception 'ENROLLMENT_LIMIT'; end if;
  if sess.recovery_grant_id is not null and not exists(select 1 from public.face_reenrollment_grants where id=sess.recovery_grant_id
    and consumed_at is null and revoked_at is null and expires_at>stamp) then raise exception 'REENROLLMENT_APPROVAL_REQUIRED'; end if;
  update public.face_enrollment_sessions set state='PROCESSING',claimed_at=stamp,claim_id=p_claim where id=p_id;
  return jsonb_build_object('userId',sess.user_id,'modelVersion',sess.model_version,'steps',sess.challenge_steps);
end $$;

create function public.face_enrollment_finish(p_hash text,p_id uuid,p_claim uuid,p_template uuid,p_envelope jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare sess public.face_enrollment_sessions; stamp timestamptz:=clock_timestamp();
begin
  sess:=private.face_session(p_hash,p_id);
  if sess.state<>'PROCESSING' or sess.claim_id is distinct from p_claim then raise exception 'SESSION_USED'; end if;
  if sess.expires_at<=stamp or sess.claimed_at<stamp-interval '30 seconds' then raise exception 'SESSION_EXPIRED'; end if;
  perform 1 from public.face_model_versions where id=sess.model_version and status='EVALUATION' for share;
  if not found then raise exception 'MODEL_UNAVAILABLE'; end if;
  if p_envelope->>'modelVersion' is distinct from sess.model_version then raise exception 'MODEL_VERSION_MISMATCH'; end if;
  if p_envelope->>'encryption_version'<>'aes-256-gcm-v1' then raise exception 'VALIDATION_ERROR'; end if;
  if sess.recovery_grant_id is not null then
    update public.face_reenrollment_grants set consumed_at=stamp where id=sess.recovery_grant_id and user_id=sess.user_id
      and consumed_at is null and revoked_at is null and expires_at>stamp;
    if not found then raise exception 'REENROLLMENT_APPROVAL_REQUIRED'; end if;
  elsif exists(select 1 from public.biometric_templates where user_id=sess.user_id) then raise exception 'REENROLLMENT_APPROVAL_REQUIRED'; end if;
  update public.biometric_templates set status='REVOKED',revoked_at=stamp where user_id=sess.user_id and status<>'REVOKED';
  insert into public.biometric_templates(id,user_id,model_version,status,ciphertext,encryption_version,key_id,nonce,auth_tag)
    values(p_template,sess.user_id,sess.model_version,'ACTIVE',(p_envelope->>'ciphertext')::bytea,
      p_envelope->>'encryption_version',p_envelope->>'key_id',(p_envelope->>'nonce')::bytea,(p_envelope->>'auth_tag')::bytea);
  update public.face_enrollment_sessions set state='SUCCEEDED',completed_at=stamp where id=p_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_data)
    values(sess.user_id,'FACE_ENROLLMENT_SUCCEEDED','face_enrollment',p_id,jsonb_build_object('modelVersion',sess.model_version));
  return jsonb_build_object('status','ACTIVE','modelVersion',sess.model_version);
end $$;

create function public.face_enrollment_fail(p_hash text,p_id uuid,p_claim uuid,p_code text) returns void
language plpgsql security invoker set search_path='' as $$
declare sess public.face_enrollment_sessions; uid uuid; stamp timestamptz:=clock_timestamp();
begin
  -- Failure may arrive after logout/deactivation; only the already authenticated claim can close it.
  select user_id into uid from public.face_enrollment_sessions where id=p_id and auth_session_hash=p_hash;
  if uid is null then return; end if;
  perform 1 from public.profiles where id=uid for update;
  select * into sess from public.face_enrollment_sessions where id=p_id and auth_session_hash=p_hash for update;
  if sess.state='PROCESSING' and sess.claim_id=p_claim then
    update public.face_enrollment_sessions set state='FAILED',completed_at=stamp,failure_code=p_code where id=p_id;
    insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_data)
      values(uid,'FACE_ENROLLMENT_FAILED','face_enrollment',p_id,jsonb_build_object('failureCode',p_code,'modelVersion',sess.model_version));
  end if;
end $$;

create function public.face_enrollment_status(p_hash text,p_model text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid; t public.biometric_templates;
begin
  uid:=private.face_actor(p_hash,'USER');
  select * into t from public.biometric_templates where user_id=uid order by created_at desc limit 1;
  return jsonb_build_object('status',case when t.id is null then 'NOT_ENROLLED'
    when t.status='ACTIVE' and t.model_version<>p_model then 'REENROLLMENT_REQUIRED' else t.status end,'modelVersion',t.model_version);
end $$;

create function public.face_enrollment_session_status(p_hash text,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare sess public.face_enrollment_sessions;
begin
  sess:=private.face_session(p_hash,p_id);
  return jsonb_build_object('sessionId',sess.id,'state',case when sess.state in('ISSUED','PROCESSING') and
    (sess.expires_at<=clock_timestamp() or (sess.state='PROCESSING' and sess.claimed_at<=clock_timestamp()-interval '30 seconds'))
    then 'EXPIRED' else sess.state end,'failureCode',sess.failure_code);
end $$;

create function public.face_enrollment_grant(p_hash text,p_user uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid; expiry timestamptz; stamp timestamptz:=clock_timestamp();
begin
  actor:=private.face_actor(p_hash,'SUPER_ADMIN');
  perform 1 from public.profiles where id=p_user and role='USER' and is_active for update;
  if not found then raise exception 'ACCOUNT_INACTIVE'; end if;
  update public.face_reenrollment_grants set revoked_at=stamp where user_id=p_user and consumed_at is null and revoked_at is null;
  insert into public.face_reenrollment_grants(user_id,actor_id,created_at,expires_at)
    values(p_user,actor,stamp,stamp+interval '24 hours') returning expires_at into expiry;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_data)
    values(actor,'FACE_REENROLLMENT_AUTHORIZED','face_enrollment',p_user,jsonb_build_object('expiresAt',expiry,'identityReviewed',true));
  return jsonb_build_object('expiresAt',expiry);
end $$;

create function public.face_teacher_set_active(p_hash text,p_user uuid,p_active boolean) returns void
language plpgsql security invoker set search_path='' as $$
declare actor uuid; was_active boolean; stamp timestamptz:=clock_timestamp();
begin
  actor:=private.face_actor(p_hash,'SUPER_ADMIN');
  select is_active into was_active from public.profiles where id=p_user and role='USER' for update;
  if was_active is null then raise exception 'ROLE_FORBIDDEN'; end if;
  if was_active=p_active then return; end if;
  update public.profiles set is_active=p_active where id=p_user;
  if not p_active then
    update public.biometric_templates set status='DISABLED' where user_id=p_user and status='ACTIVE';
    update public.app_sessions set revoked_at=stamp where profile_id=p_user and revoked_at is null;
    update public.face_reenrollment_grants set revoked_at=stamp where user_id=p_user and consumed_at is null and revoked_at is null;
    update public.face_enrollment_sessions set state='FAILED',claimed_at=coalesce(claimed_at,stamp),completed_at=stamp,
      failure_code='ACCOUNT_INACTIVE' where user_id=p_user and state in('ISSUED','PROCESSING');
  end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data)
    values(actor,case when p_active then 'TEACHER_ACTIVATED' else 'TEACHER_DEACTIVATED' end,'teacher',p_user,
      jsonb_build_object('isActive',was_active),jsonb_build_object('isActive',p_active));
end $$;

-- Terminal sessions cannot be revived by an accidental backend update.
create function private.face_terminal_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.state in('SUCCEEDED','FAILED') and new is distinct from old then raise exception 'SESSION_USED'; end if;
  return new;
end $$;
create trigger face_terminal_guard before update on public.face_enrollment_sessions for each row execute function private.face_terminal_guard();

do $$ declare fn record; begin
  for fn in select p.oid::regprocedure as signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and (p.proname like 'face_enrollment_%' or p.proname='face_teacher_set_active'))
      or (n.nspname='private' and p.proname in('face_actor','face_session','face_terminal_guard')) loop
    execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
    execute format('grant execute on function %s to service_role',fn.signature);
  end loop;
end $$;
