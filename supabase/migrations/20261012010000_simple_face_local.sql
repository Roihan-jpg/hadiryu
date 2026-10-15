-- Local recognition-only profile. Historical PAD profiles and data are retained.
alter table public.face_model_versions add column verification_mode text not null default 'CHALLENGE_PAD'
  check (verification_mode in ('CHALLENGE_PAD','SIMPLE_LOCAL'));
alter table public.face_model_versions alter column pad_name drop not null,
  alter column pad_version drop not null, alter column pad_weights_version drop not null,
  alter column pad_weights_sha256 drop not null;
alter table public.face_model_versions add constraint face_model_pad_mode check (
  (verification_mode='SIMPLE_LOCAL' and pad_name is null and pad_version is null and pad_weights_version is null and pad_weights_sha256 is null)
  or (verification_mode='CHALLENGE_PAD' and pad_name is not null and pad_version is not null and pad_weights_version is not null and pad_weights_sha256 is not null));
alter table public.face_enrollment_sessions add column enrollment_mode text not null default 'CHALLENGE_PAD'
  check (enrollment_mode in ('CHALLENGE_PAD','SIMPLE_LOCAL'));
alter table public.face_enrollment_sessions drop constraint face_enrollment_sessions_challenge_steps_check;
alter table public.face_enrollment_sessions add constraint face_enrollment_steps_mode check (
  (enrollment_mode='SIMPLE_LOCAL' and cardinality(challenge_steps)=0)
  or (enrollment_mode='CHALLENGE_PAD' and cardinality(challenge_steps)=2
    and challenge_steps <@ array['BLINK','TURN_LEFT','TURN_RIGHT']::text[]
    and 'BLINK'=any(challenge_steps) and challenge_steps[1]<>challenge_steps[2]));
create function private.face_enrollment_mode() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  select verification_mode into new.enrollment_mode from public.face_model_versions where id=new.model_version;
  return new;
end $$;
create trigger face_enrollment_mode before insert on public.face_enrollment_sessions for each row execute function private.face_enrollment_mode();

create table public.face_attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  auth_session_hash text not null,
  account_revision timestamptz not null,
  purpose text not null check(purpose in('CHECK_IN','CHECKOUT')),
  work_date date not null,
  template_id uuid not null references public.biometric_templates(id) on delete restrict,
  model_version text not null references public.face_model_versions(id) on delete restrict,
  state text not null default 'ISSUED' check(state in('ISSUED','PROCESSING','SUCCEEDED','FAILED')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  completed_at timestamptz,
  claim_id uuid,
  failure_code text check(length(failure_code) between 1 and 100),
  result jsonb,
  foreign key(auth_session_hash,user_id) references public.app_sessions(token_hash,profile_id) on delete cascade,
  check(expires_at>created_at and expires_at<=created_at+interval '90 seconds'),
  check((state<>'ISSUED')=(claimed_at is not null)),
  check((state in('SUCCEEDED','FAILED'))=(completed_at is not null)),
  check((state='SUCCEEDED')=(result is not null)),
  check((state='FAILED')=(failure_code is not null))
);
create index face_attendance_attempts on public.face_attendance_sessions(user_id,created_at desc);
alter table public.face_attendance_sessions enable row level security;
revoke all on public.face_attendance_sessions from public,anon,authenticated;
grant select,insert,update,delete on public.face_attendance_sessions to service_role;
create trigger face_attendance_terminal_guard before update on public.face_attendance_sessions for each row execute function private.face_terminal_guard();

create function public.face_attendance_issue(p_hash text,p_action text,p_model text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid; t public.biometric_templates; sess public.face_attendance_sessions; stamp timestamptz:=clock_timestamp();
begin
  uid:=private.face_actor(p_hash,'USER');
  if p_action not in('CHECK_IN','CHECKOUT') then raise exception 'VALIDATION_ERROR'; end if;
  perform 1 from public.face_model_versions where id=p_model and verification_mode='SIMPLE_LOCAL' and status='EVALUATION' for share;
  if not found then raise exception 'MODEL_UNAVAILABLE'; end if;
  select * into t from public.biometric_templates where user_id=uid and status='ACTIVE' for share;
  if t.id is null then raise exception 'FACE_ENROLLMENT_REQUIRED'; end if;
  if t.model_version<>p_model then raise exception 'REENROLLMENT_REQUIRED'; end if;
  if (select count(*) from public.face_attendance_sessions where user_id=uid and created_at>stamp-interval '5 minutes')>=10 then raise exception 'FACE_ATTEMPT_LIMIT'; end if;
  insert into public.face_attendance_sessions(user_id,auth_session_hash,account_revision,purpose,work_date,template_id,model_version,created_at,expires_at)
    values(uid,p_hash,(select password_changed_at from public.app_accounts where profile_id=uid),p_action,
      (stamp at time zone 'Asia/Jakarta')::date,t.id,p_model,stamp,stamp+interval '90 seconds') returning * into sess;
  return jsonb_build_object('sessionId',sess.id,'expiresAt',sess.expires_at,'modelVersion',sess.model_version,'mode','SIMPLE_LOCAL');
end $$;

create function private.face_attendance_session(p_hash text,p_id uuid) returns public.face_attendance_sessions
language plpgsql security invoker set search_path='' as $$
declare uid uuid; sess public.face_attendance_sessions;
begin
  uid:=private.face_actor(p_hash,'USER');
  select * into sess from public.face_attendance_sessions where id=p_id and user_id=uid and auth_session_hash=p_hash for update;
  if sess.id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if sess.account_revision is distinct from (select password_changed_at from public.app_accounts where profile_id=uid) then raise exception 'REAUTH_REQUIRED'; end if;
  return sess;
end $$;

create function public.face_attendance_claim(p_hash text,p_id uuid,p_claim uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare sess public.face_attendance_sessions; t public.biometric_templates; stamp timestamptz:=clock_timestamp();
begin
  sess:=private.face_attendance_session(p_hash,p_id);
  if sess.state='SUCCEEDED' then return jsonb_build_object('result',sess.result); end if;
  if sess.state<>'ISSUED' then raise exception 'SESSION_USED'; end if;
  if sess.expires_at<=stamp or sess.work_date<>(stamp at time zone 'Asia/Jakarta')::date then raise exception 'SESSION_EXPIRED'; end if;
  select * into t from public.biometric_templates where id=sess.template_id and user_id=sess.user_id and status='ACTIVE' for share;
  if t.id is null then raise exception 'FACE_ENROLLMENT_REQUIRED'; end if;
  if t.model_version<>sess.model_version then raise exception 'REENROLLMENT_REQUIRED'; end if;
  update public.face_attendance_sessions set state='PROCESSING',claimed_at=stamp,claim_id=p_claim where id=p_id;
  return jsonb_build_object('userId',sess.user_id,'modelVersion',sess.model_version,'action',sess.purpose,'templateId',t.id,
    'envelope',jsonb_build_object('ciphertext',t.ciphertext,'nonce',t.nonce,'auth_tag',t.auth_tag,'key_id',t.key_id,'encryption_version',t.encryption_version));
end $$;

-- Called only by Express after recognition and the existing attendance domain validation.
create function public.face_attendance_finish(p_hash text,p_id uuid,p_claim uuid,p_record jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare sess public.face_attendance_sessions; rec public.attendance_records; stamp timestamptz:=clock_timestamp();
begin
  sess:=private.face_attendance_session(p_hash,p_id);
  if sess.state='SUCCEEDED' then return sess.result; end if;
  if sess.state<>'PROCESSING' or sess.claim_id is distinct from p_claim then raise exception 'SESSION_USED'; end if;
  if sess.expires_at<=stamp or sess.claimed_at<stamp-interval '30 seconds' or sess.work_date<>(stamp at time zone 'Asia/Jakarta')::date then raise exception 'SESSION_EXPIRED'; end if;
  perform 1 from public.face_model_versions where id=sess.model_version and status='EVALUATION' and verification_mode='SIMPLE_LOCAL' for share;
  if not found then raise exception 'MODEL_UNAVAILABLE'; end if;
  perform 1 from public.biometric_templates where id=sess.template_id and user_id=sess.user_id and status='ACTIVE' and model_version=sess.model_version for share;
  if not found then raise exception 'REENROLLMENT_REQUIRED'; end if;
  select * into rec from public.attendance_records where teacher_id=sess.user_id and work_date=sess.work_date for update;
  if p_record<>'{}'::jsonb then
    if p_record->>'teacher_id' is distinct from sess.user_id::text or p_record->>'work_date' is distinct from sess.work_date::text then raise exception 'VALIDATION_ERROR'; end if;
    if sess.purpose='CHECK_IN' and rec.id is null then
      rec:=jsonb_populate_record(null::public.attendance_records,p_record);
      rec.id:=gen_random_uuid(); rec.created_at:=stamp; rec.updated_at:=stamp;
      if rec.status::text<>'CHECKED_IN' or rec.check_out_at is not null or abs(extract(epoch from stamp-rec.check_in_at))>5 then raise exception 'VALIDATION_ERROR'; end if;
      insert into public.attendance_records select (rec).* returning * into rec;
    elsif sess.purpose='CHECKOUT' and rec.status::text='CHECKED_IN' then
      if p_record->>'id' is distinct from rec.id::text or abs(extract(epoch from stamp-(p_record->>'check_out_at')::timestamptz))>5 then raise exception 'VALIDATION_ERROR'; end if;
      update public.attendance_records set check_out_at=(p_record->>'check_out_at')::timestamptz,
        check_out_latitude=(p_record->>'check_out_latitude')::numeric, check_out_longitude=(p_record->>'check_out_longitude')::numeric,
        check_out_accuracy_meters=(p_record->>'check_out_accuracy_meters')::numeric, check_out_distance_meters=(p_record->>'check_out_distance_meters')::numeric,
        check_out_boundary_clearance_meters=(p_record->>'check_out_boundary_clearance_meters')::numeric,
        worked_minutes=(p_record->>'worked_minutes')::integer, work_deficit_minutes=(p_record->>'work_deficit_minutes')::integer, status='COMPLETED'
        where id=rec.id returning * into rec;
    end if;
  end if;
  if rec.id is null or (sess.purpose='CHECKOUT' and rec.status::text<>'COMPLETED') then raise exception 'ATTENDANCE_SAVE_FAILED'; end if;
  update public.face_attendance_sessions set state='SUCCEEDED',completed_at=stamp,result=to_jsonb(rec) where id=p_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_data)
    values(sess.user_id,'FACE_ATTENDANCE_SUCCEEDED','face_attendance',p_id,jsonb_build_object('modelVersion',sess.model_version,'purpose',sess.purpose,'attendanceId',rec.id));
  return to_jsonb(rec);
end $$;

create function public.face_attendance_fail(p_hash text,p_id uuid,p_claim uuid,p_code text) returns void
language plpgsql security invoker set search_path='' as $$
declare uid uuid;
begin
  select user_id into uid from public.face_attendance_sessions where id=p_id and auth_session_hash=p_hash;
  if uid is null then return; end if;
  perform 1 from public.profiles where id=uid for update;
  update public.face_attendance_sessions set state='FAILED',completed_at=clock_timestamp(),failure_code=p_code
    where id=p_id and auth_session_hash=p_hash and claim_id=p_claim and state='PROCESSING';
  if found then
    insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_data)
      values(uid,'FACE_ATTENDANCE_FAILED','face_attendance',p_id,jsonb_build_object('failureCode',p_code));
  end if;
end $$;

do $$ declare fn record; begin
  for fn in select p.oid::regprocedure as signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname like 'face_attendance_%') or
      (n.nspname='private' and p.proname in('face_attendance_session','face_enrollment_mode')) loop
    execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
    execute format('grant execute on function %s to service_role',fn.signature);
  end loop;
end $$;
create or replace function public.face_enrollment_issue(p_hash text,p_attempt uuid,p_valid boolean,p_model text,p_steps text[])
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
  if not (cardinality(p_steps)=0 and exists(select 1 from public.face_model_versions where id=p_model and verification_mode='SIMPLE_LOCAL')) and (cardinality(p_steps)<>2 or not ('BLINK'=any(p_steps)) or p_steps[1]=p_steps[2]
     or not (p_steps<@array['BLINK','TURN_LEFT','TURN_RIGHT']::text[])) then raise exception 'VALIDATION_ERROR'; end if;
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
