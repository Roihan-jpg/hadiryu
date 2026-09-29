create function private.audit_data_has_sensitive_key(p_data jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  entry record;
begin
  if p_data is null then
    return false;
  end if;

  if pg_catalog.jsonb_typeof(p_data) = 'object' then
    for entry in select key, value from pg_catalog.jsonb_each(p_data)
    loop
      if (
        pg_catalog.regexp_replace(pg_catalog.lower(entry.key), '[-_]', '', 'g')
          <> 'mustchangepassword'
        and pg_catalog.regexp_replace(pg_catalog.lower(entry.key), '[-_]', '', 'g')
          ~ '(password|passphrase|token|secret|cookie|authorization|apikey|servicekey)$'
      )
        or private.audit_data_has_sensitive_key(entry.value)
      then
        return true;
      end if;
    end loop;
  elsif pg_catalog.jsonb_typeof(p_data) = 'array' then
    for entry in select value from pg_catalog.jsonb_array_elements(p_data)
    loop
      if private.audit_data_has_sensitive_key(entry.value) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

create function private.guard_audit_log_secrets()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if private.audit_data_has_sensitive_key(new.before_data)
    or private.audit_data_has_sensitive_key(new.after_data)
  then
    raise exception using
      errcode = 'P0001',
      message = 'AUDIT_DATA_CONTAINS_SECRET';
  end if;

  return new;
end;
$$;

revoke execute on function private.audit_data_has_sensitive_key(jsonb)
  from public, anon, authenticated;
revoke execute on function private.guard_audit_log_secrets()
  from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.audit_data_has_sensitive_key(jsonb)
  to service_role;

create trigger audit_logs_guard_secrets
before insert on public.audit_logs
for each row execute function private.guard_audit_log_secrets();
