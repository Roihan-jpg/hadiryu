-- No model is approved or registered by this migration. Enrollment remains gated.
create table public.face_model_versions (
  id text primary key check (length(id) between 1 and 200),
  recognition_name text not null,
  recognition_version text not null,
  recognition_weights_version text not null,
  recognition_weights_sha256 text not null check (recognition_weights_sha256 ~ '^[a-f0-9]{64}$'),
  pad_name text not null,
  pad_version text not null,
  pad_weights_version text not null,
  pad_weights_sha256 text not null check (pad_weights_sha256 ~ '^[a-f0-9]{64}$'),
  runtime_name text not null,
  runtime_version text not null,
  embedding_dimensions integer not null check (embedding_dimensions between 1 and 4096),
  preprocessing_version text not null,
  status text not null default 'EVALUATION' check (status in ('EVALUATION', 'APPROVED', 'REVOKED')),
  created_at timestamptz not null default now()
);

create table public.biometric_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  model_version text not null references public.face_model_versions(id) on delete restrict,
  status text not null check (status in ('ACTIVE', 'DISABLED', 'REVOKED')),
  -- Envelope metadata supports a future approved cipher/key rotation; no key material.
  ciphertext bytea not null check (octet_length(ciphertext) between 1 and 65536),
  encryption_version text not null check (length(encryption_version) between 1 and 100),
  key_id text not null check (length(key_id) between 1 and 200),
  nonce bytea not null check (octet_length(nonce) between 12 and 32),
  auth_tag bytea not null check (octet_length(auth_tag) between 16 and 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint biometric_template_revocation_check check ((status = 'REVOKED') = (revoked_at is not null))
);
create unique index biometric_templates_one_active_user on public.biometric_templates(user_id) where status = 'ACTIVE';
create trigger biometric_templates_updated_at before update on public.biometric_templates
  for each row execute function private.set_updated_at();

create table public.face_enrollment_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  auth_session_hash text not null references public.app_sessions(token_hash) on delete cascade,
  purpose text not null check (purpose = 'ENROLLMENT'),
  model_version text not null references public.face_model_versions(id) on delete restrict,
  challenge_steps text[] not null check (
    cardinality(challenge_steps) between 2 and 3
    and challenge_steps <@ array['BLINK','TURN_LEFT','TURN_RIGHT']::text[]
    and 'BLINK' = any(challenge_steps)
    and ('TURN_LEFT' = any(challenge_steps) or 'TURN_RIGHT' = any(challenge_steps))
  ),
  state text not null default 'ISSUED' check (state in ('ISSUED', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
  reauthenticated_at timestamptz not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  completed_at timestamptz,
  failure_code text check (length(failure_code) between 1 and 100),
  constraint face_enrollment_ttl_check check (
    expires_at > created_at and expires_at <= created_at + interval '120 seconds'
    and reauthenticated_at <= created_at and reauthenticated_at >= created_at - interval '60 seconds'
  ),
  constraint face_enrollment_claim_check check ((state <> 'ISSUED') = (claimed_at is not null)),
  constraint face_enrollment_completion_check check ((state in ('SUCCEEDED','FAILED')) = (completed_at is not null)),
  constraint face_enrollment_failure_check check ((state = 'FAILED') = (failure_code is not null))
);
create index face_enrollment_attempts_user_time on public.face_enrollment_sessions(user_id, created_at desc);

alter table public.face_model_versions enable row level security;
alter table public.biometric_templates enable row level security;
alter table public.face_enrollment_sessions enable row level security;
revoke all on public.face_model_versions, public.biometric_templates, public.face_enrollment_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.face_model_versions, public.biometric_templates, public.face_enrollment_sessions to service_role;

-- Extend the existing recursive audit guard; enrollment audits contain metadata only.
create or replace function private.audit_data_has_sensitive_key(p_data jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare entry record; normalized text;
begin
  if p_data is null then return false; end if;
  if pg_catalog.jsonb_typeof(p_data) = 'object' then
    for entry in select key, value from pg_catalog.jsonb_each(p_data) loop
      normalized := pg_catalog.regexp_replace(pg_catalog.lower(entry.key), '[-_]', '', 'g');
      if (normalized <> 'mustchangepassword' and normalized ~ '(password|passphrase|token|secret|cookie|authorization|apikey|servicekey)$')
        or normalized ~ '^(frames?|images?|templates?|ciphertext|nonce|authtag)$'
        or normalized ~ '(embedding|facetemplate|encryptedtemplate|rawimage|rawframe|capturedframe|biometric|facematchscore|padscore|spoofscore|livenessscore)'
        or private.audit_data_has_sensitive_key(entry.value)
      then return true; end if;
    end loop;
  elsif pg_catalog.jsonb_typeof(p_data) = 'array' then
    for entry in select value from pg_catalog.jsonb_array_elements(p_data) loop
      if private.audit_data_has_sensitive_key(entry.value) then return true; end if;
    end loop;
  end if;
  return false;
end;
$$;
