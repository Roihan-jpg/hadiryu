-- Store the domain-calculated response in the same transaction as attendance.
create or replace function public.face_attendance_finish(p_hash text,p_id uuid,p_claim uuid,p_record jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare sess public.face_attendance_sessions; rec public.attendance_records; stamp timestamptz:=clock_timestamp(); data jsonb:=coalesce(p_record->'record',p_record); response jsonb:=p_record->'response';
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
  if data<>'{}'::jsonb then
    if data->>'teacher_id' is distinct from sess.user_id::text or data->>'work_date' is distinct from sess.work_date::text then raise exception 'VALIDATION_ERROR'; end if;
    if sess.purpose='CHECK_IN' and rec.id is null then
      rec:=jsonb_populate_record(null::public.attendance_records,data);
      rec.id:=coalesce(rec.id,gen_random_uuid()); rec.created_at:=stamp; rec.updated_at:=stamp;
      if rec.status::text<>'CHECKED_IN' or rec.check_out_at is not null or abs(extract(epoch from stamp-rec.check_in_at))>5 then raise exception 'VALIDATION_ERROR'; end if;
      insert into public.attendance_records select (rec).* returning * into rec;
    elsif sess.purpose='CHECKOUT' and rec.status::text='CHECKED_IN' then
      if data->>'id' is distinct from rec.id::text or abs(extract(epoch from stamp-(data->>'check_out_at')::timestamptz))>5 then raise exception 'VALIDATION_ERROR'; end if;
      update public.attendance_records set check_out_at=(data->>'check_out_at')::timestamptz,
        check_out_latitude=(data->>'check_out_latitude')::numeric, check_out_longitude=(data->>'check_out_longitude')::numeric,
        check_out_accuracy_meters=(data->>'check_out_accuracy_meters')::numeric, check_out_distance_meters=(data->>'check_out_distance_meters')::numeric,
        check_out_boundary_clearance_meters=(data->>'check_out_boundary_clearance_meters')::numeric,
        worked_minutes=(data->>'worked_minutes')::integer, work_deficit_minutes=(data->>'work_deficit_minutes')::integer, status='COMPLETED'
        where id=rec.id returning * into rec;
    end if;
  end if;
  if rec.id is null or (sess.purpose='CHECKOUT' and rec.status::text<>'COMPLETED') then raise exception 'ATTENDANCE_SAVE_FAILED'; end if;
  if response is not null and (response->>'id' is distinct from rec.id::text or response->>'workDate' is distinct from rec.work_date::text or response->>'status' is distinct from rec.status::text or (response->>'checkInAt')::timestamptz is distinct from rec.check_in_at or (sess.purpose='CHECKOUT' and (response->>'checkOutAt')::timestamptz is distinct from rec.check_out_at)) then raise exception 'ATTENDANCE_CONFLICT'; end if;
  update public.face_attendance_sessions set state='SUCCEEDED',completed_at=stamp,result=coalesce(response,to_jsonb(rec)) where id=p_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_data)
    values(sess.user_id,'FACE_ATTENDANCE_SUCCEEDED','face_attendance',p_id,jsonb_build_object('modelVersion',sess.model_version,'purpose',sess.purpose,'attendanceId',rec.id));
  return coalesce(response,to_jsonb(rec));
end $$;
