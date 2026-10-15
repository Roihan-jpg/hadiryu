import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { AuthUser } from '@absensi/contracts';
import { createApp } from './app.js';
import type { AuthService } from './auth.js';
import type { FaceEnrollmentService } from './face-enrollment.js';
import { AppError } from './auth.js';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

const user:AuthUser={id:'50000000-0000-4000-8000-000000000001',nip:'test',fullName:'Guru',role:'USER',isActive:true,mustChangePassword:false};
const unused=async()=>{throw new Error('unused');};
const auth=(override:Partial<AuthUser>={}):AuthService=>({authenticate:async()=>({...user,...override}),login:unused,refresh:unused,changePassword:unused,logout:async()=>{}});
const service:FaceEnrollmentService={status:async()=>({status:'NOT_ENROLLED',modelVersion:null}),issue:unused,submit:unused,session:unused,grant:unused};
describe('enrollment HTTP boundary',()=>{
  it('denies anonymous, wrong role, disabled and unavailable enrollment',async()=>{
    const anonymous=await request(createApp({authService:auth(),faceEnrollmentService:service})).get('/api/face/enrollment/status');
    expect(anonymous.status).toBe(401);
    for(const override of [{role:'SECURITY_GUARD' as const},{role:'SUPER_ADMIN' as const},{isActive:false}]){
      const result=await request(createApp({authService:auth(override),faceEnrollmentService:service})).get('/api/face/enrollment/status').set('Cookie','absensi_session=test');
      expect(result.status).toBe(403);
    }
    const disabled=await request(createApp({authService:auth()})).get('/api/face/enrollment/status').set('Cookie','absensi_session=test');
    expect(disabled.body.error.code).toBe('ENROLLMENT_UNAVAILABLE');
  });
  it('requires CSRF protection and password, rejects userId and client verdict',async()=>{
    const app=createApp({authService:auth(),faceEnrollmentService:service});
    const missing=await request(app).post('/api/face/enrollment/sessions').set('Cookie','absensi_session=test').send({password:'Good1234'});
    expect(missing.status).toBe(403);
    for(const payload of [{},{password:'Good1234',userId:'other'},{password:'Good1234',challengePassed:true}]){
      const result=await request(app).post('/api/face/enrollment/sessions').set('Cookie','absensi_session=test').set('X-Requested-With','XMLHttpRequest').send(payload);
      expect(result.status).toBe(400);
    }
  });
  it('authenticates before parsing the large submission and bounds actual wire bytes',async()=>{
    const app=createApp({authService:auth(),faceEnrollmentService:service});
    const body={data:'x'.repeat(4*1024*1024)};
    const anonymous=await request(app).post('/api/face/enrollment/submit').set('Content-Type','application/json').send('not-json');
    expect(anonymous.status).toBe(401);
    const oversized=await request(app).post('/api/face/enrollment/submit').set('Cookie','absensi_session=test').set('X-Requested-With','XMLHttpRequest').send(body);
    expect(oversized.status).toBe(413);
  });
  it('has safe no-store status and does not accept invalid session ids',async()=>{
    const app=createApp({authService:auth(),faceEnrollmentService:service});
    const status=await request(app).get('/api/face/enrollment/status').set('Cookie','absensi_session=test');
    expect(status.headers['cache-control']).toBe('no-store');
    expect(status.body).toEqual({status:'NOT_ENROLLED',modelVersion:null});
    const invalid=await request(app).get('/api/face/enrollment/sessions/not-uuid').set('Cookie','absensi_session=test');
    expect(invalid.status).toBe(400);
  });
  it('returns a structured timeout for a stalled upload without invoking inference',async()=>{
    let called=false;
    const server=createApp({authService:auth(),faceEnrollmentService:{...service,submit:async()=>{
      called=true;return {status:'ACTIVE',modelVersion:'test'};
    }}}).listen(0,'127.0.0.1');
    await new Promise<void>(resolve=>server.once('listening',resolve));
    try {
      const result=await new Promise<{status:number;code:string}>((resolve,reject)=>{
        const req=httpRequest({hostname:'127.0.0.1',port:(server.address() as AddressInfo).port,
          path:'/api/face/enrollment/submit',method:'POST',headers:{
            Cookie:'absensi_session=test','X-Requested-With':'XMLHttpRequest',
            'Content-Type':'application/json','Content-Length':'100',
          }},res=>{
          let body='';res.on('data',(part:Buffer)=>body+=part.toString());
          res.on('end',()=>resolve({status:res.statusCode!,code:JSON.parse(body).error.code}));
        });
        req.on('error',reject);req.write('{');
      });
      expect(result).toEqual({status:408,code:'UPLOAD_TIMEOUT'});
      expect(called).toBe(false);
    } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
  },25_000);
  it('includes upload time in the 30 second submission deadline',async()=>{
    const server=createApp({authService:auth(),faceEnrollmentService:{...service,submit:async(_token,_input,signal)=>
      new Promise((_resolve,reject)=>{
        const fail=()=>reject(new AppError(503,'INFERENCE_TIMEOUT','test deadline'));
        if(signal.aborted) fail();else signal.addEventListener('abort',fail,{once:true});
      })}}).listen(0,'127.0.0.1');
    await new Promise<void>(resolve=>server.once('listening',resolve));
    const body=JSON.stringify({sessionId:user.id,challengeFrameCounts:[8,8],
      frames:Array.from({length:19},()=>({mimeType:'image/jpeg',data:'/9j/AA=='}))});
    const started=performance.now();
    try {
      const code=await new Promise<string>((resolve,reject)=>{
        const req=httpRequest({hostname:'127.0.0.1',port:(server.address() as AddressInfo).port,
          path:'/api/face/enrollment/submit',method:'POST',headers:{Cookie:'absensi_session=test',
            'X-Requested-With':'XMLHttpRequest','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
          let response='';res.on('data',(part:Buffer)=>response+=part.toString());
          res.on('end',()=>resolve(JSON.parse(response).error.code));
        });
        req.on('error',reject);req.write(body.slice(0,1));
        setTimeout(()=>req.end(body.slice(1)),2000);
      });
      expect(code).toBe('INFERENCE_TIMEOUT');
      expect(performance.now()-started).toBeLessThan(31_500);
    } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
  },35_000);
});
