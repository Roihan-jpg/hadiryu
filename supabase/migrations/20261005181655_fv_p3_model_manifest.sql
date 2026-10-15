alter table public.face_model_versions
  add column full_manifest jsonb,
  add column pipeline_sha256 text check(pipeline_sha256 ~ '^[a-f0-9]{64}$');
create function private.face_model_identity_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') then
    raise exception 'MODEL_VERSION_IMMUTABLE';
  end if;
  return new;
end $$;
revoke all on function private.face_model_identity_guard() from public,anon,authenticated;
grant execute on function private.face_model_identity_guard() to service_role;
create trigger face_model_identity_guard before update on public.face_model_versions
  for each row execute function private.face_model_identity_guard();
