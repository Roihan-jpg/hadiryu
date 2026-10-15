import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { FaceEnrollmentSubmission } from '@absensi/contracts';
import { SupabaseFaceEnrollmentService, faceSessionHash, type FaceInferenceClient } from './supabase-face-enrollment.js';
import { FaceTemplateCipher } from './face-template.js';
import { hashPassword, type SupabaseAuthConfig } from './supabase-auth.js';
import { AppError } from './auth.js';

// This integration suite exercises real database transactions with a declared test inference double.
// It does not constitute model/camera acceptance.
describe('enrollment database security and race',()=>{
  let client:SupabaseClient,config:SupabaseAuthConfig,passwordHash:string;
  const users:string[]=[];
  const version='test-'+randomUUID();
  const cipher=new FaceTemplateCipher('test',randomBytes(32));
  const embedding=Array.from({length:128},()=>1/Math.sqrt(128));
  beforeAll(async()=>{
    const result=spawnSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{cwd:new URL('../../../',import.meta.url),encoding:'utf8'});
    if(result.status!==0) throw new Error('Local Supabase required for enrollment integration tests');
    const status=JSON.parse(result.stdout) as Record<string,string>;
    config={url:status['API_URL']!,publishableKey:status['PUBLISHABLE_KEY']!,secretKey:status['SECRET_KEY']!};
    client=createClient(config.url,config.secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
    passwordHash=await hashPassword('Face1234');
    const {error}=await client.from('face_model_versions').insert({id:version,recognition_name:'test',recognition_version:'v1',recognition_weights_version:'v1',
      recognition_weights_sha256:'a'.repeat(64),pad_name:'test',pad_version:'v1',pad_weights_version:'v1',pad_weights_sha256:'b'.repeat(64),
      runtime_name:'test-double',runtime_version:'v1',embedding_dimensions:128,preprocessing_version:'v1',status:'EVALUATION'});
    if(error) throw new Error('Test model setup failed');
  },30_000);
  afterAll(async()=>{
    if(!client || users.length===0) return;
    const ids=users.map(id=>`'${id}'`).join(',');
    const cleanup=spawnSync('docker',['exec','supabase_db_absensi-guru','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',
      `set session_replication_role=replica; delete from public.audit_logs where actor_id in (${ids});`],{encoding:'utf8'});
    if(cleanup.status!==0) throw new Error('Local audit fixture cleanup failed');
    for(const table of ['biometric_templates','face_enrollment_sessions','face_reenrollment_grants','face_reauth_attempts','app_sessions','app_accounts','profiles']){
      const column=table==='audit_logs'?'actor_id':table==='app_accounts'||table==='app_sessions'?'profile_id':table==='profiles'?'id':'user_id';
      const {error}=await client.from(table).delete().in(column,users);
      if(error) throw new Error('Enrollment test cleanup failed: '+table);
    }
    await client.from('face_model_versions').delete().eq('id',version);
  });
  async function actor(role='USER',active=true){
    const id=randomUUID(),token=randomBytes(32).toString('base64url');users.push(id);
    const operations=[
      await client.from('profiles').insert({id,nip:'fv-'+id.slice(0,8),full_name:'Enrollment Test',role,is_active:active,must_change_password:false}),
      await client.from('app_accounts').insert({profile_id:id,password_hash:passwordHash}),
      await client.from('app_sessions').insert({profile_id:id,token_hash:faceSessionHash(token),expires_at:new Date(Date.now()+3600_000).toISOString()}),
    ];
    if(operations.some(value=>value.error)) throw new Error('Test actor setup failed');
    return {id,token};
  }
  function engine(options:{before?:()=>Promise<void>;modelVersion?:string;code?:string}={}):FaceInferenceClient {
    return {ready:async()=>{},enroll:async()=>{
      await options.before?.();
      if(options.code) throw new AppError(503,options.code,'test failure');
      return {embedding:[...embedding],modelVersion:options.modelVersion??version,durationMs:2};
    }};
  }
  function service(inference=engine()) {return new SupabaseFaceEnrollmentService(config,version,inference,cipher);}
  function body(sessionId:string):FaceEnrollmentSubmission {
    return {sessionId,challengeFrameCounts:[8,8],frames:Array.from({length:19},()=>({mimeType:'image/jpeg',data:'/9j/AA=='}))};
  }
  it('persists categorical PAD rejection only and cannot create a template for any failed frame',async()=>{
    const a=await actor();
    const stages=[{stage:'BLINK',evaluated:8,rejected:1},{stage:'TURN_RIGHT',evaluated:8,rejected:0},
      {stage:'FRONT',evaluated:1,rejected:0},{stage:'LEFT',evaluated:1,rejected:0},{stage:'RIGHT',evaluated:1,rejected:0}];
    for(const allRejected of [false,true]){
      const details={stages:stages.map(stage=>({...stage,rejected:allRejected?stage.evaluated:stage.rejected}))};
      const inference:FaceInferenceClient={ready:async()=>{},enroll:async()=>{throw new AppError(422,'PAD_FAILED','test rejection',details);}};
      const svc=service(inference),sess=await svc.issue(a.token,'Face1234');
      await expect(svc.submit(a.token,body(sess.sessionId),new AbortController().signal)).rejects.toMatchObject({code:'PAD_FAILED',details});
      expect(await svc.session(a.token,sess.sessionId)).toMatchObject({state:'FAILED',failureCode:allRejected?'PAD_FAILED_ALL_FRAMES':'PAD_FAILED_SOME_FRAMES'});
      expect((await client.from('biometric_templates').select('id').eq('user_id',a.id)).data).toHaveLength(0);
      const audit=await client.from('audit_logs').select('after_data').eq('entity_id',sess.sessionId).eq('action','FACE_ENROLLMENT_FAILED').single();
      expect(audit.data?.after_data).toEqual({failureCode:allRejected?'PAD_FAILED_ALL_FRAMES':'PAD_FAILED_SOME_FRAMES',modelVersion:version});
    }
  });
  const signal=()=>new AbortController().signal;
  it('stores only the bounded rejection category while keeping failed enrollment and no template',async()=>{
    for(const rejectionKind of ['MODEL_NOT_REAL','BELOW_ACCEPTANCE','MIXED']){
      const a=await actor();
      const details={rejectionKind,stages:[
        {stage:'BLINK',evaluated:8,rejected:8},{stage:'TURN_RIGHT',evaluated:8,rejected:8},
        {stage:'FRONT',evaluated:1,rejected:1},{stage:'LEFT',evaluated:1,rejected:1},{stage:'RIGHT',evaluated:1,rejected:1},
      ]};
      const svc=service({ready:async()=>{},enroll:async()=>{throw new AppError(422,'PAD_FAILED','test rejection',details);}});
      const session=await svc.issue(a.token,'Face1234');
      await expect(svc.submit(a.token,body(session.sessionId),signal())).rejects.toMatchObject({code:'PAD_FAILED',details});
      const failureCode='PAD_FAILED_ALL_FRAMES_'+rejectionKind;
      expect(await svc.session(a.token,session.sessionId)).toMatchObject({state:'FAILED',failureCode});
      expect((await client.from('biometric_templates').select('id').eq('user_id',a.id)).data).toHaveLength(0);
      const audit=await client.from('audit_logs').select('after_data').eq('entity_id',session.sessionId).eq('action','FACE_ENROLLMENT_FAILED').single();
      expect(audit.data?.after_data).toEqual({failureCode,modelVersion:version});
    }
  });
  it('binds A and B ownership, requires reauth, denies wrong role and disabled accounts',async()=>{
    const a=await actor(),b=await actor(),svc=service();
    const session=await svc.issue(a.token,'Face1234');
    await expect(svc.submit(b.token,body(session.sessionId),signal())).rejects.toMatchObject({code:'SESSION_NOT_FOUND'});
    await expect(svc.issue(b.token,'Wrong123')).rejects.toMatchObject({code:'INVALID_CREDENTIALS'});
    for(const x of [await actor('SUPER_ADMIN'),await actor('SECURITY_GUARD'),await actor('USER',false)]){
      await expect(svc.issue(x.token,'Face1234')).rejects.toMatchObject({status:403});
    }
    const stamp=new Date().toISOString();
    const {error}=await client.from('face_enrollment_sessions').insert({user_id:b.id,auth_session_hash:faceSessionHash(a.token),purpose:'ENROLLMENT',
      model_version:version,challenge_steps:['BLINK','TURN_LEFT'],created_at:stamp,reauthenticated_at:stamp,expires_at:new Date(Date.now()+90_000).toISOString()});
    expect(error?.code).toBe('23503');
  });
  it('rejects expired session without executing inference',async()=>{
    let calls=0;
    const a=await actor(),svc=service(engine({before:async()=>{calls++;}})),sess=await svc.issue(a.token,'Face1234');
    const oldMs=Date.now()-180_000,old=new Date(oldMs).toISOString();
    const changed=await client.from('face_enrollment_sessions').update({created_at:old,reauthenticated_at:old,
      expires_at:new Date(oldMs+90_000).toISOString()}).eq('id',sess.sessionId);
    expect(changed.error).toBeNull();
    await expect(svc.submit(a.token,body(sess.sessionId),signal())).rejects.toMatchObject({code:'SESSION_EXPIRED'});
    expect(calls).toBe(0);
  });
  it('parallel submissions produce one template, and reuse is rejected',async()=>{
    const a=await actor();let calls=0;
    const svc=service(engine({before:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,75));}}));
    const sess=await svc.issue(a.token,'Face1234');
    const results=await Promise.allSettled([svc.submit(a.token,body(sess.sessionId),signal()),svc.submit(a.token,body(sess.sessionId),signal())]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(calls).toBe(1);
    const {data}=await client.from('biometric_templates').select('*').eq('user_id',a.id);
    expect(data).toHaveLength(1);
    const row=data![0]!;
    expect(cipher.decrypt({userId:a.id,templateId:row['id'] as string,modelVersion:version},row as never)).toEqual(embedding);
    expect(row['embedding']).toBeUndefined();
    await expect(svc.submit(a.token,body(sess.sessionId),signal())).rejects.toMatchObject({code:'SESSION_USED'});
    const audit=await client.from('audit_logs').select('after_data').eq('actor_id',a.id);
    expect(JSON.stringify(audit.data)).not.toMatch(/embedding|ciphertext|padScore|Face1234/);
  });
  it('fails safely for unavailable model and mismatched inference version',async()=>{
    for(const inference of [engine({code:'MODEL_UNAVAILABLE'}),engine({modelVersion:'incompatible'})]){
      const a=await actor(),svc=service(inference),sess=await svc.issue(a.token,'Face1234');
      await expect(svc.submit(a.token,body(sess.sessionId),signal())).rejects.toBeInstanceOf(AppError);
      expect((await svc.session(a.token,sess.sessionId)).state).toBe('FAILED');
      expect((await svc.status(a.token)).status).toBe('NOT_ENROLLED');
    }
  });
  it('password reset, logout, and deactivate during inference prevent a template commit',async()=>{
    const admin=await actor('SUPER_ADMIN');
    for(const mutation of ['password','logout','deactivate']){
      const a=await actor();
      const svc=service(engine({before:async()=>{
        if(mutation==='password') await client.from('app_accounts').update({password_changed_at:new Date(Date.now()+1000).toISOString()}).eq('profile_id',a.id);
        if(mutation==='logout') await client.from('app_sessions').update({revoked_at:new Date().toISOString()}).eq('token_hash',faceSessionHash(a.token));
        if(mutation==='deactivate') {const {error}=await client.rpc('face_teacher_set_active',{p_hash:faceSessionHash(admin.token),p_user:a.id,p_active:false});if(error) throw new Error('Deactivation failed');}
      }}));
      const sess=await svc.issue(a.token,'Face1234');
      await expect(svc.submit(a.token,body(sess.sessionId),signal())).rejects.toBeInstanceOf(AppError);
      expect((await client.from('biometric_templates').select('id').eq('user_id',a.id)).data).toHaveLength(0);
    }
  });
  it('requires reviewed one-use recovery; freezes rather than deletes or restores',async()=>{
    const admin=await actor('SUPER_ADMIN'),a=await actor(),svc=service();
    let sess=await svc.issue(a.token,'Face1234');await svc.submit(a.token,body(sess.sessionId),signal());
    await expect(svc.issue(a.token,'Face1234')).rejects.toMatchObject({code:'REENROLLMENT_APPROVAL_REQUIRED'});
    await client.rpc('face_teacher_set_active',{p_hash:faceSessionHash(admin.token),p_user:a.id,p_active:false});
    expect((await client.from('biometric_templates').select('status').eq('user_id',a.id)).data?.[0]?.['status']).toBe('DISABLED');
    await client.rpc('face_teacher_set_active',{p_hash:faceSessionHash(admin.token),p_user:a.id,p_active:true});
    const newToken=randomBytes(32).toString('base64url');
    await client.from('app_sessions').insert({profile_id:a.id,token_hash:faceSessionHash(newToken),expires_at:new Date(Date.now()+3600_000).toISOString()});
    expect((await svc.status(newToken)).status).toBe('DISABLED');
    await svc.grant(admin.token,a.id);sess=await svc.issue(newToken,'Face1234');
    await svc.submit(newToken,body(sess.sessionId),signal());
    const rows=await client.from('biometric_templates').select('status').eq('user_id',a.id);
    expect(rows.data?.map(row=>row['status']).sort()).toEqual(['ACTIVE','REVOKED']);
    await expect(svc.issue(newToken,'Face1234')).rejects.toMatchObject({code:'REENROLLMENT_APPROVAL_REQUIRED'});
  });
  it('denies a recovery grant before first enrollment and freezes on every disable path',async()=>{
    const admin=await actor('SUPER_ADMIN'),a=await actor(),svc=service();
    await expect(svc.grant(admin.token,a.id)).rejects.toMatchObject({code:'REENROLLMENT_NOT_NEEDED',
      message:'Guru belum memiliki template wajah. Pendaftaran pertama dapat dilakukan langsung dari Profil Saya tanpa izin daftar ulang.'});
    expect((await client.from('face_reenrollment_grants').select('id').eq('user_id',a.id)).data).toHaveLength(0);
    const sess=await svc.issue(a.token,'Face1234');await svc.submit(a.token,body(sess.sessionId),signal());
    const disabled=await client.from('profiles').update({is_active:false}).eq('id',a.id);expect(disabled.error).toBeNull();
    const active=await client.from('profiles').update({is_active:true}).eq('id',a.id);expect(active.error).toBeNull();
    expect((await client.from('biometric_templates').select('status').eq('user_id',a.id)).data?.[0]?.['status']).toBe('DISABLED');
    expect((await client.from('app_sessions').select('revoked_at').eq('profile_id',a.id)).data?.[0]?.['revoked_at']).not.toBeNull();
  });
  it('persists lockout failures and submission limits',async()=>{
    const a=await actor(),svc=service();
    for(let i=0;i<5;i++) await expect(svc.issue(a.token,'Wrong123')).rejects.toMatchObject({code:'INVALID_CREDENTIALS'});
    await expect(svc.issue(a.token,'Face1234')).rejects.toMatchObject({code:'REAUTH_LIMIT'});
    const b=await actor(),failing=service(engine({code:'MODEL_UNAVAILABLE'}));
    for(let i=0;i<5;i++) {const sess=await failing.issue(b.token,'Face1234');await expect(failing.submit(b.token,body(sess.sessionId),signal())).rejects.toMatchObject({code:'MODEL_UNAVAILABLE'});}
    const sess=await failing.issue(b.token,'Face1234');
    await expect(failing.submit(b.token,body(sess.sessionId),signal())).rejects.toMatchObject({code:'ENROLLMENT_LIMIT'});
  });
  it('reports incompatible model or lost cipher key explicitly',async()=>{
    const a=await actor(),svc=service(),sess=await svc.issue(a.token,'Face1234');
    await svc.submit(a.token,body(sess.sessionId),signal());
    const otherModel=new SupabaseFaceEnrollmentService(config,'other-model',engine(),cipher);
    expect((await otherModel.status(a.token)).status).toBe('REENROLLMENT_REQUIRED');
    const lostKey=new SupabaseFaceEnrollmentService(config,version,engine(),new FaceTemplateCipher('test',randomBytes(32)));
    expect((await lostKey.status(a.token)).status).toBe('REENROLLMENT_REQUIRED');
  });
  it('rolls back a template when the success audit cannot be written',async()=>{
    const a=await actor(),svc=service(),sess=await svc.issue(a.token,'Face1234');
    const name='fv_p3_audit_'+a.id.replaceAll('-','');
    const sql=(statement:string)=>{
      const result=spawnSync('docker',['exec','supabase_db_absensi-guru','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',statement],{encoding:'utf8'});
      if(result.status!==0)throw new Error('Local fault fixture operation failed');
    };
    sql(`create function private.${name}() returns trigger language plpgsql as $$ begin if new.actor_id='${a.id}' and new.action='FACE_ENROLLMENT_SUCCEEDED' then raise exception 'TEST_AUDIT_UNAVAILABLE'; end if; return new; end $$;
      create trigger ${name} before insert on public.audit_logs for each row execute function private.${name}();`);
    try{
      await expect(svc.submit(a.token,body(sess.sessionId),signal())).rejects.toMatchObject({code:'ENROLLMENT_STORAGE_FAILED'});
      expect((await client.from('biometric_templates').select('id').eq('user_id',a.id)).data).toHaveLength(0);
      expect((await svc.session(a.token,sess.sessionId)).state).toBe('FAILED');
    }finally{sql(`drop trigger ${name} on public.audit_logs; drop function private.${name}();`);}
  });
});
