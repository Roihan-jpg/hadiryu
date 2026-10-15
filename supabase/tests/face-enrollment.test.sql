begin;
select plan(17);

select has_table('public', 'face_model_versions', 'model registry exists');
select has_table('public', 'biometric_templates', 'encrypted template storage exists');
select has_table('public', 'face_enrollment_sessions', 'enrollment session storage exists');
select is((select count(*)::integer from pg_catalog.pg_tables
  where schemaname = 'public' and tablename in ('face_model_versions', 'biometric_templates', 'face_enrollment_sessions') and rowsecurity), 3,
  'RLS enabled on all biometric tables');
select ok(not has_table_privilege('anon', 'public.biometric_templates', 'SELECT'), 'anon cannot read templates');
select ok(not has_table_privilege('authenticated', 'public.biometric_templates', 'SELECT'), 'browser cannot read templates');
select ok(not has_table_privilege('authenticated', 'public.biometric_templates', 'INSERT'), 'browser cannot enroll directly');
select ok(not has_table_privilege('authenticated', 'public.face_enrollment_sessions', 'SELECT'), 'browser cannot read sessions');
select ok(not has_table_privilege('authenticated', 'public.face_enrollment_sessions', 'UPDATE'), 'browser cannot claim sessions');
select ok(has_table_privilege('service_role', 'public.biometric_templates', 'DELETE'), 'backend retains hard-delete capability');
select is((select count(*)::integer from pg_catalog.pg_policies where schemaname = 'public'
  and tablename in ('face_model_versions', 'biometric_templates', 'face_enrollment_sessions')), 0,
  'no browser biometric policies');
select ok(private.audit_data_has_sensitive_key('{"nested":{"embedding":[0.1,0.2]}}'), 'audit rejects embedding');
select ok(private.audit_data_has_sensitive_key('{"rawImages":["image-data"]}'), 'audit rejects image material');
select ok(private.audit_data_has_sensitive_key('{"encryptedTemplate":"ciphertext"}'), 'audit rejects encrypted template');
select ok(private.audit_data_has_sensitive_key('{"padScore":0.99}'), 'audit rejects unneeded raw score');
select ok(not private.audit_data_has_sensitive_key('{"modelVersion":"v1","sessionId":"opaque","failureCode":"MODEL_UNAVAILABLE"}'),
  'security metadata remains allowed');
select ok(not private.audit_data_has_sensitive_key('{"templateChecksum":"excel-template-sha256"}'), 'Excel checksum audit remains allowed');
select * from finish();
rollback;
