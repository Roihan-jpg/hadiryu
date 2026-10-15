import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseSimpleFaceService, type SimpleInferenceClient } from './simple-face.js';
import { FaceTemplateCipher } from './face-template.js';
import { faceSessionHash } from './supabase-face-enrollment.js';
import { hashPassword, type SupabaseAuthConfig } from './supabase-auth.js';
import { SupabaseAttendanceRepository } from './supabase-attendance.js';
import { jakartaDateTime } from './attendance.js';

// Real DB/domain transactions; synthetic inference and schedule/location fixtures, not camera acceptance.
describe('simple face local database transactions',()=>{
  let client:SupabaseClient,config:SupabaseAuthConfig,passwordHash:string;
  const users:string[]=[],version='simple-test-'+randomUUID(),cipher=new FaceTemplateCipher('test',randomBytes(32));
  const vector=Array.from({length:128},(_,i)=>i===0?1:0),frame={mimeType:'image/jpeg' as const,data:'AAAA'};
  const location={latitude:0,longitude:0,accuracyMeters:10};
  const date=()=>jakartaDateTime(new Date()).workDate;
  const signal=()=>new AbortController().signal;
  function sql(statement:string){
    const result=spawnSync('docker',['exec','supabase_db_absensi-guru','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',statement],{encoding:'utf8'});
    if(result.status!==0)throw new Error('Fixture SQL failed');
  }
  beforeAll(async()=>{
    const result=spawnSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{cwd:new URL('../../../',import.meta.url),encoding:'utf8'});
    if(result.status!==0)throw new Error('Local Supabase required');
    const status=JSON.parse(result.stdout) as Record<string,string>;
    config={url:status['API_URL']!,publishableKey:status['PUBLISHABLE_KEY']!,secretKey:status['SECRET_KEY']!};
    client=createClient(config.url,config.secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
    passwordHash=await hashPassword('Face1234');
    const model=await client.from('face_model_versions').insert({id:version,verification_mode:'SIMPLE_LOCAL',recognition_name:'test',recognition_version:'1',
      recognition_weights_version:'1',recognition_weights_sha256:'a'.repeat(64),runtime_name:'declared-inference-double',runtime_version:'1',
      embedding_dimensions:128,preprocessing_version:'test',status:'EVALUATION'});
    if(model.error)throw new Error('Model fixture failed');
    vi.spyOn(SupabaseAttendanceRepository.prototype,'findCalendarException').mockImplementation(async()=>({id:randomUUID(),workDate:date(),name:'Fixture',exceptionType:'WORKING_DAY',scheduleType:'WEEKDAY'}));
    vi.spyOn(SupabaseAttendanceRepository.prototype,'findSchedule').mockImplementation(async()=>{
      const minute=jakartaDateTime(new Date()).minuteOfDay;
      const boundary=String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
      return {id:randomUUID(),scheduleType:'WEEKDAY',checkInOpen:'00:00',workStart:'00:00',checkInClose:boundary,checkoutOpen:boundary,workEnd:'23:59',checkoutClose:'23:59',targetMinutes:1,effectiveFrom:date(),effectiveTo:null};
    });
    vi.spyOn(SupabaseAttendanceRepository.prototype,'findGeofence').mockImplementation(async()=>({id:randomUUID(),shape:'CIRCLE',latitude:0,longitude:0,radiusMeters:1000,maxAccuracyMeters:20,effectiveFrom:date(),effectiveTo:null}));
  },30_000);
  afterAll(async()=>{
    vi.restoreAllMocks();
    if(!client)return;
    if(users.length){
      sql(`set session_replication_role=replica; delete from public.audit_logs where actor_id in (${users.map(id=>`'${id}'`).join(',')}); delete from public.attendance_records where teacher_id in (${users.map(id=>`'${id}'`).join(',')});`);
      for(const [table,column] of [['face_attendance_sessions','user_id'],['biometric_templates','user_id'],['face_enrollment_sessions','user_id'],['face_reenrollment_grants','user_id'],['face_reauth_attempts','user_id'],['app_sessions','profile_id'],['app_accounts','profile_id'],['profiles','id']]){
        const result=await client.from(table!).delete().in(column!,users);if(result.error)throw new Error('Fixture cleanup failed: '+table);
      }
    }
    await client.from('face_model_versions').delete().eq('id',version);
  });
  async function actor(role='USER',active=true){
    const id=randomUUID(),token=randomBytes(32).toString('base64url');users.push(id);
    for(const result of [await client.from('profiles').insert({id,nip:'simple-'+id.slice(0,8),full_name:'Simple Fixture',role,is_active:active,must_change_password:false}),
      await client.from('app_accounts').insert({profile_id:id,password_hash:passwordHash}),
      await client.from('app_sessions').insert({profile_id:id,token_hash:faceSessionHash(token),expires_at:new Date(Date.now()+3600_000).toISOString()})]){
      if(result.error)throw new Error('Actor fixture failed');
    }
    return {id,token};
  }
  function engine(before?:()=>Promise<void>,candidate=vector):SimpleInferenceClient{
    return {ready:async()=>{},enroll:async()=>{throw new Error('Legacy inference forbidden');},simple:async()=>{
      await before?.();return {modelVersion:version,embedding:[...candidate],durationMs:1};
    }};
  }
  function service(inference=engine()){return new SupabaseSimpleFaceService(config,version,inference,cipher);}
  async function enrolled(){const user=await actor(),svc=service();const sess=await svc.issueEnrollment(user.token,'Face1234');
    expect(sess.mode).toBe('SIMPLE_LOCAL');await svc.enroll(user.token,{sessionId:sess.sessionId,frames:[frame,frame,frame]},signal());return user;}
  it('requires password, binds enrollment ownership, encrypts the template and rejects reuse',async()=>{
    const a=await actor(),b=await actor(),svc=service();
    await expect(svc.issueEnrollment(a.token,'Wrong123')).rejects.toMatchObject({code:'INVALID_CREDENTIALS'});
    const sess=await svc.issueEnrollment(a.token,'Face1234');
    const body={sessionId:sess.sessionId,frames:[frame,frame,frame]};
    await expect(svc.enroll(b.token,body,signal())).rejects.toMatchObject({code:'SESSION_NOT_FOUND'});
    await expect(svc.enroll(a.token,body,signal())).resolves.toEqual({status:'ACTIVE',modelVersion:version});
    await expect(svc.enroll(a.token,body,signal())).rejects.toMatchObject({code:'SESSION_USED'});
    expect((await client.from('biometric_templates').select('ciphertext,key_id,status').eq('user_id',a.id)).data?.[0]).toMatchObject({key_id:'test',status:'ACTIVE'});
    const photo=(await client.from('face_enrollment_portraits').select('ciphertext,key_id,mime_type').eq('user_id',a.id)).data!;
    expect(photo).toHaveLength(1);expect(photo[0]).toMatchObject({key_id:'test',mime_type:'image/jpeg'});
    expect(photo[0]!.ciphertext).not.toBe('\\x000000');
    const admin={id:b.id,nip:'fixture',fullName:'Fixture',role:'SUPER_ADMIN' as const,isActive:true,mustChangePassword:false};
    expect((await svc.adminPortrait(admin,a.id)).bytes).toEqual(Buffer.from('AAAA','base64'));
    await expect(svc.adminPortrait({...admin,role:'USER'},a.id)).rejects.toMatchObject({code:'ROLE_FORBIDDEN'});
  });
  it('commits check-in/checkout with the session and returns the same result after a lost response',async()=>{
    const a=await enrolled(),svc=service();
    for(const action of ['CHECK_IN','CHECKOUT'] as const){
      const sess=await svc.issueAttendance(a.token,action),body={sessionId:sess.sessionId,frame,location};
      const result=await svc.submitAttendance(a.token,body,signal());
      expect(result.status).toBe(action==='CHECK_IN'?'CHECKED_IN':'COMPLETED');
      expect(await svc.submitAttendance(a.token,body,signal())).toEqual(result);
      expect((await client.from('face_attendance_sessions').select('state').eq('id',sess.sessionId).single()).data?.state).toBe('SUCCEEDED');
    }
    expect((await client.from('attendance_records').select('id').eq('teacher_id',a.id)).data).toHaveLength(1);
  });
  it('allows only one parallel request to run inference',async()=>{
    const a=await enrolled();let release!:()=>void,entered!:()=>void;
    const waiting=new Promise<void>(resolve=>{release=resolve;});const began=new Promise<void>(resolve=>{entered=resolve;});
    const infer=vi.fn(async()=>{entered();await waiting;});const svc=service(engine(infer));
    const sess=await svc.issueAttendance(a.token,'CHECK_IN'),body={sessionId:sess.sessionId,frame,location};
    const first=svc.submitAttendance(a.token,body,signal());await began;
    await expect(svc.submitAttendance(a.token,body,signal())).rejects.toMatchObject({code:'SESSION_USED'});
    release();await first;expect(infer).toHaveBeenCalledOnce();
  });
  it('rejects a different face, wrong owner and out-of-zone location without recording attendance',async()=>{
    const a=await enrolled(),b=await actor(),svc=service(engine(undefined,vector.map((_,i)=>i===1?1:0)));
    const sess=await svc.issueAttendance(a.token,'CHECK_IN'),body={sessionId:sess.sessionId,frame,location};
    await expect(svc.submitAttendance(b.token,body,signal())).rejects.toMatchObject({code:'SESSION_NOT_FOUND'});
    await expect(svc.submitAttendance(a.token,body,signal())).rejects.toMatchObject({code:'FACE_NOT_MATCHED'});
    const next=await service().issueAttendance(a.token,'CHECK_IN');
    await expect(service().submitAttendance(a.token,{...body,sessionId:next.sessionId,location:{...location,latitude:1}},signal())).rejects.toMatchObject({code:'OUTSIDE_GEOFENCE'});
    expect((await client.from('attendance_records').select('id').eq('teacher_id',a.id)).data).toHaveLength(0);
  });
  it('rejects expired sessions, wrong role, disabled accounts, unavailable inference and incompatible templates',async()=>{
    const a=await enrolled(),svc=service(),sess=await svc.issueAttendance(a.token,'CHECK_IN');
    sql(`update public.face_attendance_sessions set created_at=now()-interval '120 seconds',expires_at=now()-interval '30 seconds' where id='${sess.sessionId}'`);
    await expect(svc.submitAttendance(a.token,{sessionId:sess.sessionId,frame,location},signal())).rejects.toMatchObject({code:'SESSION_EXPIRED'});
    const admin=await actor('SUPER_ADMIN'),disabled=await actor('USER',false);
    await expect(svc.issueEnrollment(admin.token,'Face1234')).rejects.toMatchObject({code:'ROLE_FORBIDDEN'});
    await expect(svc.issueEnrollment(disabled.token,'Face1234')).rejects.toMatchObject({code:'ACCOUNT_INACTIVE'});
    await expect(new SupabaseSimpleFaceService(config,'different',engine(),cipher).issueAttendance(a.token,'CHECK_IN')).rejects.toMatchObject({code:'MODEL_UNAVAILABLE'});
    const failing=engine();failing.simple=async()=>{throw new Error('unavailable');};
    const fresh=await svc.issueAttendance(a.token,'CHECK_IN');
    await expect(service(failing).submitAttendance(a.token,{sessionId:fresh.sessionId,frame,location},signal())).rejects.toMatchObject({code:'INFERENCE_UNAVAILABLE'});
  });
  it('cannot commit after deactivation or password revision during inference',async()=>{
    for(const action of ['disable','password']){
      const a=await enrolled(),svc=service(engine(async()=>{
        if(action==='disable')await client.from('profiles').update({is_active:false}).eq('id',a.id);
        else await client.from('app_accounts').update({password_changed_at:new Date(Date.now()+1000).toISOString()}).eq('profile_id',a.id);
      }));
      const sess=await svc.issueAttendance(a.token,'CHECK_IN');
      await expect(svc.submitAttendance(a.token,{sessionId:sess.sessionId,frame,location},signal())).rejects.toBeDefined();
      expect((await client.from('attendance_records').select('id').eq('teacher_id',a.id)).data).toHaveLength(0);
    }
  });
  it('rolls back attendance and session success when the audit insert fails',async()=>{
    const a=await enrolled(),svc=service(),sess=await svc.issueAttendance(a.token,'CHECK_IN');
    const name='simple_audit_'+a.id.replaceAll('-','');
    sql(`create function private.${name}() returns trigger language plpgsql as $$ begin if new.actor_id='${a.id}' and new.action='FACE_ATTENDANCE_SUCCEEDED' then raise exception 'TEST_AUDIT_UNAVAILABLE'; end if; return new; end $$;
      create trigger ${name} before insert on public.audit_logs for each row execute function private.${name}();`);
    try{
      await expect(svc.submitAttendance(a.token,{sessionId:sess.sessionId,frame,location},signal())).rejects.toMatchObject({code:'FACE_STORAGE_FAILED'});
      expect((await client.from('attendance_records').select('id').eq('teacher_id',a.id)).data).toHaveLength(0);
      expect((await client.from('face_attendance_sessions').select('state').eq('id',sess.sessionId).single()).data?.state).toBe('FAILED');
    }finally{sql(`drop trigger ${name} on public.audit_logs; drop function private.${name}();`);}
  });
  it('rolls back both template and reference photo when enrollment audit fails',async()=>{
    const a=await actor(),svc=service(),sess=await svc.issueEnrollment(a.token,'Face1234');
    const name='portrait_audit_'+a.id.replaceAll('-','');
    sql(`create function private.${name}() returns trigger language plpgsql as $$ begin if new.actor_id='${a.id}' and new.action='FACE_ENROLLMENT_SUCCEEDED' then raise exception 'TEST_AUDIT_UNAVAILABLE'; end if; return new; end $$;
      create trigger ${name} before insert on public.audit_logs for each row execute function private.${name}();`);
    try{
      await expect(svc.enroll(a.token,{sessionId:sess.sessionId,frames:[frame,frame,frame]},signal())).rejects.toMatchObject({code:'FACE_STORAGE_FAILED'});
      expect((await client.from('biometric_templates').select('id').eq('user_id',a.id)).data).toHaveLength(0);
      expect((await client.from('face_enrollment_portraits').select('template_id').eq('user_id',a.id)).data).toHaveLength(0);
    }finally{sql(`drop trigger ${name} on public.audit_logs; drop function private.${name}();`);}
  });
});
