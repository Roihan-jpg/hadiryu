alter table public.profiles
  drop constraint profiles_id_fkey,
  alter column must_change_password set default false,
  add column profile_photo_storage_path text,
  add column profile_photo_mime_type text,
  add column profile_photo_size_bytes integer,
  add column profile_photo_updated_at timestamptz;

update public.profiles
set must_change_password = false,
    temporary_password_expires_at = null;

alter table public.profiles
  add constraint profiles_photo_complete_check check (
    (
      profile_photo_storage_path is null
      and profile_photo_mime_type is null
      and profile_photo_size_bytes is null
      and profile_photo_updated_at is null
    )
    or (
      profile_photo_storage_path is not null
      and profile_photo_mime_type in ('image/jpeg', 'image/png', 'image/webp')
      and profile_photo_size_bytes between 1 and 2097152
      and profile_photo_updated_at is not null
    )
  );

create table public.app_accounts (
  profile_id uuid primary key references public.profiles (id) on delete restrict,
  password_hash text not null,
  password_changed_at timestamptz not null default now(),
  failed_login_attempts smallint not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_accounts_password_hash_check check (
    password_hash ~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$'
  ),
  constraint app_accounts_failed_login_attempts_check check (
    failed_login_attempts between 0 and 5
  )
);

create table public.app_sessions (
  token_hash text primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint app_sessions_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint app_sessions_expiry_check check (expires_at > created_at),
  constraint app_sessions_revocation_check check (
    revoked_at is null or revoked_at >= created_at
  )
);

create index app_sessions_profile_active_idx
  on public.app_sessions (profile_id, expires_at desc)
  where revoked_at is null;
create index app_sessions_expiry_idx
  on public.app_sessions (expires_at)
  where revoked_at is null;

create trigger app_accounts_set_updated_at
before update on public.app_accounts
for each row execute function private.set_updated_at();

alter table public.app_accounts enable row level security;
alter table public.app_sessions enable row level security;

revoke all on table public.app_accounts from public, anon, authenticated;
revoke all on table public.app_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.app_accounts to service_role;
grant select, insert, update, delete on table public.app_sessions to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'profile-photos',
  'profile-photos',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
