import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { AuthUser } from '@absensi/contracts';
import { createApp } from './app.js';
import { AppError, type AuthService } from './auth.js';
import type { SimpleFaceService } from './simple-face.js';
const user:AuthUser={id:'50000000-0000-4000-8000-000000000001',nip:'fixture',fullName:'Fixture',role:'USER',isActive:true,mustChangePassword:false};
const unused=async()=>{throw new Error('unused');};
const auth=(override:Partial<AuthUser>={}):AuthService=>({authenticate:async()=>({...user,...override}),login:unused,refresh:unused,changePassword:unused,logout:async()=>{}});
const service:SimpleFaceService={status:async()=>({status:'NOT_ENROLLED',modelVersion:null,mode:'SIMPLE_LOCAL'}),session:unused,grant:unused,issueEnrollment:unused,enroll:unused,issueAttendance:unused,submitAttendance:unused};
const body={sessionId:user.id,frame:{mimeType:'image/jpeg',data:'AAAA'},location:{latitude:0,longitude:0,accuracyMeters:10}};
describe('simple face HTTP enforcement',()=>{
  it('returns the private photo only to an active SuperAdmin, with no cache or biometric JSON',async()=>{
    const portrait=vi.fn(async()=>({mimeType:'image/png' as const,bytes:Buffer.from([137,80,78,71])}));
    for(const override of [{role:'USER' as const},{role:'SUPER_ADMIN' as const,isActive:false}]){
      const result=await request(createApp({authService:auth(override),simpleFaceService:{...service,adminPortrait:portrait}}))
        .get(`/api/admin/teachers/${user.id}/face-photo`).set('Cookie','absensi_session=fixture');
      expect(result.status).toBe(403);
    }
    expect(portrait).not.toHaveBeenCalled();
    const app=createApp({authService:auth({role:'SUPER_ADMIN'}),simpleFaceService:{...service,adminPortrait:portrait}});
    expect((await request(app).get(`/api/admin/teachers/${user.id}/face-photo`)).status).toBe(401);
    const result=await request(app).get(`/api/admin/teachers/${user.id}/face-photo`).set('Cookie','absensi_session=fixture');
    expect(result.status).toBe(200);expect(result.headers['cache-control']).toContain('no-store');
    expect(result.headers['content-type']).toContain('image/png');expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(portrait).toHaveBeenCalledOnce();expect(result.body).toEqual(Buffer.from([137,80,78,71]));
  });
  it('blocks both ordinary Guru attendance endpoints instead of allowing bypass',async()=>{
    const app=createApp({authService:auth(),simpleFaceService:service});
    for(const path of ['check-in','checkout']){
      const result=await request(app).post('/api/attendance/'+path).set('Cookie','absensi_session=fixture').set('X-Requested-With','XMLHttpRequest').send(body.location);
      expect(result.status).toBe(409);expect(result.body.error.code).toBe('FACE_VERIFICATION_REQUIRED');
    }
  });
  it('does not enforce the new mode on Satpam or a production/default app',async()=>{
    for(const app of [createApp({authService:auth({role:'SECURITY_GUARD'}),simpleFaceService:service}),createApp({authService:auth()})]){
      const result=await request(app).post('/api/attendance/check-in').set('Cookie','absensi_session=fixture').set('X-Requested-With','XMLHttpRequest').send(body.location);
      expect(result.body.error.code).not.toBe('FACE_VERIFICATION_REQUIRED');
    }
  });
  it('rejects missing login, wrong role, disabled accounts and missing CSRF header',async()=>{
    expect((await request(createApp({authService:auth(),simpleFaceService:service})).get('/api/face/enrollment/status')).status).toBe(401);
    for(const override of [{role:'SUPER_ADMIN' as const},{isActive:false}]){
      const result=await request(createApp({authService:auth(override),simpleFaceService:service})).get('/api/face/enrollment/status').set('Cookie','absensi_session=fixture');expect(result.status).toBe(403);
    }
    const result=await request(createApp({authService:auth(),simpleFaceService:service})).post('/api/attendance/face/submit').set('Cookie','absensi_session=fixture').send(body);
    expect(result.status).toBe(403);
  });
  it('rejects oversized uploads and frontend identity before invoking inference',async()=>{
    const submit=vi.fn(service.submitAttendance),app=createApp({authService:auth(),simpleFaceService:{...service,submitAttendance:submit}});
    const send=(input:object)=>request(app).post('/api/attendance/face/submit').set('Cookie','absensi_session=fixture').set('X-Requested-With','XMLHttpRequest').send(input);
    expect((await send({...body,userId:user.id})).status).toBe(400);
    expect((await send({...body,frame:{...body.frame,data:'A'.repeat(600000)}})).status).toBe(413);
    expect(submit).not.toHaveBeenCalled();
  });
  it('returns structured inference failure without returning material or a success',async()=>{
    const app=createApp({authService:auth(),simpleFaceService:{...service,submitAttendance:async()=>{throw new AppError(503,'INFERENCE_TIMEOUT','Pemeriksaan melewati batas waktu');}}});
    const result=await request(app).post('/api/attendance/face/submit').set('Cookie','absensi_session=fixture').set('X-Requested-With','XMLHttpRequest').send(body);
    expect(result.status).toBe(503);expect(result.body.error.code).toBe('INFERENCE_TIMEOUT');expect(result.body.embedding).toBeUndefined();
  });
});
