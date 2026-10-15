-- One encrypted reference photo per enrollment; the other frames remain transient.
alter table public.biometric_templates add constraint biometric_template_owner_unique unique(id,user_id);
create table public.face_enrollment_portraits (
  template_id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete restrict,
  mime_type text not null check(mime_type in('image/jpeg','image/png')),
  ciphertext bytea not null check(octet_length(ciphertext) between 1 and 262144),
  nonce bytea not null check(octet_length(nonce)=12),
  auth_tag bytea not null check(octet_length(auth_tag)=16),
  key_id text not null check(length(key_id) between 1 and 200),
  encryption_version text not null check(encryption_version='aes-256-gcm-portrait-v1'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(template_id,user_id) references public.biometric_templates(id,user_id) on delete cascade
);
create index face_enrollment_portraits_user on public.face_enrollment_portraits(user_id);
alter table public.face_enrollment_portraits enable row level security;
revoke all on public.face_enrollment_portraits from public,anon,authenticated;
grant select,insert,delete on public.face_enrollment_portraits to service_role;

create or replace function public.face_enrollment_finish(p_hash text,p_id uuid,p_claim uuid,p_template uuid,p_envelope jsonb)
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
  if sess.enrollment_mode='SIMPLE_LOCAL' then
    if p_envelope->'portrait' is null then raise exception 'VALIDATION_ERROR'; end if;
    insert into public.face_enrollment_portraits(template_id,user_id,mime_type,ciphertext,nonce,auth_tag,key_id,encryption_version)
      values(p_template,sess.user_id,p_envelope->'portrait'->>'mimeType',(p_envelope->'portrait'->>'ciphertext')::bytea,
        (p_envelope->'portrait'->>'nonce')::bytea,(p_envelope->'portrait'->>'auth_tag')::bytea,
        p_envelope->'portrait'->>'key_id',p_envelope->'portrait'->>'encryption_version');
  end if;
  update public.face_enrollment_sessions set state='SUCCEEDED',completed_at=stamp where id=p_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_data)
    values(sess.user_id,'FACE_ENROLLMENT_SUCCEEDED','face_enrollment',p_id,jsonb_build_object('modelVersion',sess.model_version));
  return jsonb_build_object('status','ACTIVE','modelVersion',sess.model_version);
end $$;
