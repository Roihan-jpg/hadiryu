import {
  SimpleFaceSessionSchema, SimpleFaceActionSchema, SimpleFaceEnrollmentSubmissionSchema,
  SimpleFaceAttendanceSubmissionSchema, FaceInferenceResultSchema, FaceEnrollmentStatusSchema,
  AttendanceRecordSchema,
  type AuthUser, type SimpleFaceAction, type SimpleFaceInferenceRequest,
} from '@absensi/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { AppError, ACCESS_COOKIE_NAME, createSessionGuard, requireRole, sendAppError, type AuthService } from './auth.js';
import { createCsrfProtectionMiddleware, createRateLimiter } from './security.js';
import { faceSessionHash, SupabaseFaceEnrollmentService, type FaceInferenceClient } from './supabase-face-enrollment.js';
import { FaceTemplateCipher } from './face-template.js';
import { verifyPassword, type SupabaseAuthConfig } from './supabase-auth.js';
import { createAttendanceService, validatedLocation, jakartaDateTime, type SaveCheckInInput, type SaveCheckoutInput } from './attendance.js';
import { SupabaseAttendanceRepository, checkInStorageRecord, checkoutStorageRecord, toFaceAttendance } from './supabase-attendance.js';

export interface SimpleInferenceClient extends FaceInferenceClient {
  simple(input: SimpleFaceInferenceRequest, signal: AbortSignal): Promise<z.infer<typeof FaceInferenceResultSchema>>;
}
const EnvelopeSchema = z.strictObject({ ciphertext:z.string(),nonce:z.string(),auth_tag:z.string(),key_id:z.string(),encryption_version:z.string() });
const ClaimSchema = z.strictObject({ userId:z.uuid(),modelVersion:z.string(),action:SimpleFaceActionSchema,templateId:z.uuid(),envelope:EnvelopeSchema });
const errorStatus:Record<string,number>={AUTH_REQUIRED:401,REAUTH_REQUIRED:401,INVALID_CREDENTIALS:401,ACCOUNT_INACTIVE:403,ROLE_FORBIDDEN:403,
  ACCOUNT_LOCKED:423,SESSION_NOT_FOUND:404,SESSION_USED:409,SESSION_EXPIRED:410,SESSION_BUSY:409,REAUTH_LIMIT:429,ENROLLMENT_LIMIT:429,
  FACE_ATTEMPT_LIMIT:429,FACE_ENROLLMENT_REQUIRED:409,REENROLLMENT_REQUIRED:409,REENROLLMENT_APPROVAL_REQUIRED:409,
  MODEL_UNAVAILABLE:503,MODEL_VERSION_MISMATCH:409,VALIDATION_ERROR:400,REENROLLMENT_NOT_NEEDED:409,ATTENDANCE_CONFLICT:409};

export function faceMatches(reference:number[],candidate:number[]):boolean {
  const normalized=(values:number[])=>values.length===128 && values.every(Number.isFinite)
    && Math.abs(Math.sqrt(values.reduce((total,v)=>total+v*v,0))-1)<=.001;
  if(!normalized(reference)||!normalized(candidate)) throw new AppError(503,'INFERENCE_INVALID_RESPONSE','Hasil pengenalan wajah tidak valid');
  return reference.reduce((total,v,index)=>total+v*candidate[index]!,0)>=.363;
}

class ClaimAttendanceRepository extends SupabaseAttendanceRepository {
  pendingRecord:Record<string,unknown>|null=null;
  constructor(config:SupabaseAuthConfig,private readonly readRecord:()=>Promise<Record<string,unknown>>){super(config);}
  override async saveCheckIn(input:SaveCheckInInput){
    this.pendingRecord={id:randomUUID(),created_at:input.checkInAt,updated_at:input.checkInAt,
      check_out_at:null,check_out_latitude:null,check_out_longitude:null,check_out_accuracy_meters:null,
      check_out_distance_meters:null,check_out_boundary_clearance_meters:null,worked_minutes:null,work_deficit_minutes:null,
      ...checkInStorageRecord(input)};
    return toFaceAttendance(this.pendingRecord);
  }
  override async saveCheckout(input:SaveCheckoutInput){
    this.pendingRecord={...await this.readRecord(),...checkoutStorageRecord(input)};
    const record=toFaceAttendance(this.pendingRecord);
    if(record.status!=='COMPLETED')throw new AppError(500,'ATTENDANCE_SAVE_FAILED','Absen pulang belum tersimpan');
    return record;
  }
}

export class SupabaseSimpleFaceService {
  private readonly client:SupabaseClient;
  private readonly legacy:SupabaseFaceEnrollmentService;
  constructor(private readonly config:SupabaseAuthConfig,private readonly modelVersion:string,
    private readonly inference:SimpleInferenceClient,private readonly cipher:FaceTemplateCipher){
    if(!['localhost','127.0.0.1'].includes(new URL(config.url).hostname))throw new Error('Simple face is local only');
    this.client=createClient(config.url,config.secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
    this.legacy=new SupabaseFaceEnrollmentService(config,modelVersion,inference,cipher);
  }
  private async rpc(name:string,args:Record<string,unknown>):Promise<unknown>{
    const {data,error}=await this.client.rpc(name,args);
    const rejection=z.object({error:z.string()}).safeParse(data);
    if(error||rejection.success){
      const message=error?.message??(rejection.success?rejection.data.error:'');
      const code=Object.keys(errorStatus).find(key=>message===key||message.endsWith(key));
      throw new AppError(code?errorStatus[code]!:500,code??'FACE_STORAGE_FAILED',code==='FACE_ENROLLMENT_REQUIRED'
        ?'Daftarkan wajah melalui Profil Saya terlebih dahulu.':code==='REENROLLMENT_REQUIRED'
        ?'Versi template berubah. Minta izin daftar ulang dan daftarkan wajah kembali.':'Pemeriksaan wajah belum dapat dilanjutkan.');
    }
    return data;
  }
  async status(token:string){return {...await this.legacy.status(token),mode:'SIMPLE_LOCAL' as const};}
  session(token:string,id:string){return this.legacy.session(token,id);}
  grant(token:string,id:string){return this.legacy.grant(token,id);}
  async issueEnrollment(token:string,password:string){
    await this.inference.ready();
    const hash=faceSessionHash(token);
    const proof=z.object({attemptId:z.uuid(),passwordHash:z.string()}).parse(await this.rpc('face_enrollment_reauth',{p_hash:hash}));
    const value=z.object({sessionId:z.uuid(),expiresAt:z.string(),modelVersion:z.string(),steps:z.array(z.string()).length(0)}).parse(
      await this.rpc('face_enrollment_issue',{p_hash:hash,p_attempt:proof.attemptId,p_valid:await verifyPassword(password,proof.passwordHash),p_model:this.modelVersion,p_steps:[]}));
    return SimpleFaceSessionSchema.parse({sessionId:value.sessionId,expiresAt:value.expiresAt,modelVersion:value.modelVersion,mode:'SIMPLE_LOCAL'});
  }
  async enroll(token:string,body:z.infer<typeof SimpleFaceEnrollmentSubmissionSchema>,signal:AbortSignal){
    const hash=faceSessionHash(token),claim=randomUUID();
    const owner=z.strictObject({userId:z.uuid(),modelVersion:z.string(),steps:z.array(z.string()).length(0)}).parse(
      await this.rpc('face_enrollment_claim',{p_hash:hash,p_id:body.sessionId,p_claim:claim}));
    let result:z.infer<typeof FaceInferenceResultSchema>|undefined;
    try{
      if(owner.modelVersion!==this.modelVersion)throw new AppError(409,'MODEL_VERSION_MISMATCH','Daftarkan wajah dengan versi terbaru');
      result=await this.extract({sessionId:body.sessionId,modelVersion:owner.modelVersion,operation:'ENROLLMENT',frames:body.frames},signal);
      const id=randomUUID();
      const envelope=this.cipher.encrypt({userId:owner.userId,templateId:id,modelVersion:owner.modelVersion},result.embedding);
      const photo=body.frames[0]!;
      const bytes=Buffer.from(photo.data,'base64');
      let portrait:ReturnType<FaceTemplateCipher['encryptPortrait']>;
      try{portrait=this.cipher.encryptPortrait({userId:owner.userId,templateId:id,modelVersion:owner.modelVersion},photo.mimeType,bytes);}
      finally{bytes.fill(0);}
      signal.throwIfAborted();
      return FaceEnrollmentStatusSchema.parse(await this.rpc('face_enrollment_finish',{p_hash:hash,p_id:body.sessionId,p_claim:claim,p_template:id,
        p_envelope:{...envelope,modelVersion:owner.modelVersion,portrait:{...portrait,mimeType:photo.mimeType}}}));
    }catch(error){
      await this.rpc('face_enrollment_fail',{p_hash:hash,p_id:body.sessionId,p_claim:claim,p_code:error instanceof AppError?error.code:'INFERENCE_FAILED'});
      if(error instanceof AppError)throw error;
      throw new AppError(503,signal.aborted?'INFERENCE_TIMEOUT':'INFERENCE_UNAVAILABLE','Pendaftaran belum tersimpan. Pemeriksaan belum dapat diselesaikan.');
    }finally{result?.embedding.fill(0);}
  }
  async issueAttendance(token:string,action:SimpleFaceAction){
    await this.inference.ready();
    return SimpleFaceSessionSchema.parse(await this.rpc('face_attendance_issue',{p_hash:faceSessionHash(token),p_action:action,p_model:this.modelVersion}));
  }
  async adminPortrait(admin:AuthUser,userId:string){
    if(admin.role!=='SUPER_ADMIN'||!admin.isActive)throw new AppError(403,'ROLE_FORBIDDEN','Foto pendaftaran hanya dapat dilihat SuperAdmin.');
    const target=await this.client.from('profiles').select('id').eq('id',userId).eq('role','USER').maybeSingle();
    if(target.error)throw new AppError(503,'PHOTO_UNAVAILABLE','Foto pendaftaran belum dapat dimuat.');
    if(!target.data)throw new AppError(404,'PHOTO_NOT_FOUND','Foto pendaftaran belum tersedia.');
    const template=await this.client.from('biometric_templates').select('id,model_version').eq('user_id',userId).in('status',['ACTIVE','DISABLED']).order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(template.error)throw new AppError(503,'PHOTO_UNAVAILABLE','Foto pendaftaran belum dapat dimuat.');
    if(!template.data)throw new AppError(404,'PHOTO_NOT_FOUND','Foto pendaftaran belum tersedia.');
    const row=await this.client.from('face_enrollment_portraits').select('mime_type,ciphertext,nonce,auth_tag,key_id,encryption_version').eq('template_id',template.data.id).eq('user_id',userId).maybeSingle();
    if(row.error)throw new AppError(503,'PHOTO_UNAVAILABLE','Foto pendaftaran belum dapat dimuat.');
    if(!row.data)throw new AppError(404,'PHOTO_NOT_FOUND','Foto pendaftaran lama belum tersedia.');
    const photo=EnvelopeSchema.extend({mime_type:z.enum(['image/jpeg','image/png'])}).parse(row.data);
    try{return {mimeType:photo.mime_type,bytes:this.cipher.decryptPortrait({userId,templateId:template.data.id,modelVersion:template.data.model_version},photo.mime_type,photo)};}
    catch{throw new AppError(503,'PHOTO_UNAVAILABLE','Foto pendaftaran belum dapat dibaca.');}
  }
  private async extract(input:SimpleFaceInferenceRequest,signal:AbortSignal){
    signal.throwIfAborted();
    const result=FaceInferenceResultSchema.parse(await this.inference.simple(input,signal));
    signal.throwIfAborted();
    if(result.modelVersion!==this.modelVersion){result.embedding.fill(0);throw new AppError(409,'MODEL_VERSION_MISMATCH','Versi pengenal wajah berubah');}
    try { faceMatches(result.embedding,result.embedding); }
    catch(error){result.embedding.fill(0);throw error;}
    return result;
  }
  async submitAttendance(token:string,body:z.infer<typeof SimpleFaceAttendanceSubmissionSchema>,signal:AbortSignal){
    const hash=faceSessionHash(token),claim=randomUUID();
    const value=await this.rpc('face_attendance_claim',{p_hash:hash,p_id:body.sessionId,p_claim:claim});
    const replay=z.strictObject({result:z.unknown()}).safeParse(value);
    if(replay.success)return AttendanceRecordSchema.parse(replay.data.result);
    const owner=ClaimSchema.parse(value);
    let result:z.infer<typeof FaceInferenceResultSchema>|undefined,reference:number[]|undefined;
    try{
      if(owner.modelVersion!==this.modelVersion)throw new AppError(409,'REENROLLMENT_REQUIRED','Daftarkan wajah kembali');
      const repository=new ClaimAttendanceRepository(this.config,async()=>{
        const stored=await this.client.from('attendance_records').select('*').eq('teacher_id',owner.userId).eq('work_date',jakartaDateTime(new Date()).workDate).single();
        if(stored.error)throw new AppError(500,'ATTENDANCE_SAVE_FAILED','Absensi tidak dapat dibaca');
        return z.record(z.string(),z.unknown()).parse(stored.data);
      });
      const geofence=await repository.findGeofence(jakartaDateTime(new Date()).workDate);
      if(!geofence)throw new AppError(422,'GEOFENCE_NOT_CONFIGURED','Lokasi sekolah belum tersedia');
      validatedLocation(body.location,geofence);
      try { reference=this.cipher.decrypt({userId:owner.userId,templateId:owner.templateId,modelVersion:owner.modelVersion},owner.envelope); }
      catch { throw new AppError(409,'REENROLLMENT_REQUIRED','Template tidak dapat digunakan. Daftarkan wajah kembali.'); }
      result=await this.extract({sessionId:body.sessionId,modelVersion:owner.modelVersion,operation:'VERIFICATION',frames:[body.frame]},signal);
      if(!faceMatches(reference,result.embedding))throw new AppError(422,'FACE_NOT_MATCHED','Wajah tidak cocok dengan akun Anda.');
      const attendance=createAttendanceService(repository);
      const response=owner.action==='CHECK_IN'?await attendance.checkIn({id:owner.userId,role:'USER'},body.location)
        :await attendance.checkout({id:owner.userId,role:'USER'},body.location);
      signal.throwIfAborted();
      return AttendanceRecordSchema.parse(await this.rpc('face_attendance_finish',{p_hash:hash,p_id:body.sessionId,p_claim:claim,
        p_record:{record:repository.pendingRecord??{},response}}));
    }catch(error){
      await this.rpc('face_attendance_fail',{p_hash:hash,p_id:body.sessionId,p_claim:claim,p_code:error instanceof AppError?error.code:signal.aborted?'INFERENCE_TIMEOUT':'INFERENCE_FAILED'});
      if(error instanceof AppError)throw error;
      throw new AppError(503,signal.aborted?'INFERENCE_TIMEOUT':'INFERENCE_UNAVAILABLE','Pemeriksaan belum selesai. Absensi belum tercatat.');
    }finally{reference?.fill(0);result?.embedding.fill(0);}
  }
}

function token(req:Request):string{return (req.cookies as Record<string,string>)[ACCESS_COOKIE_NAME]!;}
function faceRouteError(res:Response,next:NextFunction,error:unknown):void {
  if(error instanceof AppError)sendAppError(res,error);
  else if(error instanceof z.ZodError)sendAppError(res,new AppError(400,'VALIDATION_ERROR','Data gambar, sesi, atau lokasi tidak valid'));
  else next(error);
}
export type SimpleFaceService=Pick<SupabaseSimpleFaceService,'status'|'session'|'grant'|'issueEnrollment'|'enroll'|'issueAttendance'|'submitAttendance'> & {adminPortrait?:SupabaseSimpleFaceService['adminPortrait']};
export function registerSimpleFaceRoutes(app:Express,auth:AuthService,service:SimpleFaceService):void{
  app.get('/api/admin/teachers/:id/face-photo',createSessionGuard(auth),requireRole('SUPER_ADMIN'),async(req,res,next)=>{
    try{
      if(!(res.locals['authUser'] as AuthUser).isActive)throw new AppError(403,'ACCOUNT_INACTIVE','Akun dinonaktifkan.');
      if(!service.adminPortrait)throw new AppError(404,'PHOTO_NOT_FOUND','Foto pendaftaran belum tersedia.');
      const photo=await service.adminPortrait(res.locals['authUser'] as AuthUser,z.uuid().parse(req.params['id']));
      res.once('finish',()=>photo.bytes.fill(0));res.once('close',()=>photo.bytes.fill(0));
      res.set({'Cache-Control':'no-store','Content-Type':photo.mimeType,'Content-Disposition':'inline','X-Content-Type-Options':'nosniff'}).send(photo.bytes);
    }catch(error){faceRouteError(res,next,error);}
  });
  app.use(['/api/face/enrollment/submit','/api/attendance/face/submit'],(req,res,next)=>{
    res.locals['faceStartedAt']=performance.now();res.set('Connection','close');
    const uploadDeadline=setTimeout(()=>{
      if(res.headersSent){req.destroy();return;}
      res.once('finish',()=>req.destroy());sendAppError(res,new AppError(408,'UPLOAD_TIMEOUT','Pengiriman gambar terlalu lama.'));
    },15_000);
    const clear=()=>clearTimeout(uploadDeadline);req.once('end',clear);req.once('close',clear);res.once('finish',clear);
    next();
  });
  const guards=[createSessionGuard(auth),requireRole('USER'),createCsrfProtectionMiddleware(true),createRateLimiter({windowMs:60_000,max:30})];
  app.use(['/api/face/enrollment','/api/attendance/face'],...guards,(_req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(!(res.locals['authUser'] as {isActive:boolean}).isActive){sendAppError(res,new AppError(403,'ACCOUNT_INACTIVE','Akun dinonaktifkan'));return;}
    next();
  });
  app.get('/api/face/enrollment/status',async(req,res,next)=>{try{res.json(await service.status(token(req)));}catch(e){faceRouteError(res,next,e);}});
  app.post('/api/face/enrollment/sessions',async(req,res,next)=>{try{
    const {FaceEnrollmentSessionRequestSchema}=await import('@absensi/contracts');
    const input=FaceEnrollmentSessionRequestSchema.parse(req.body);res.json(await service.issueEnrollment(token(req),input.password));
  }catch(e){faceRouteError(res,next,e);}});
  app.get('/api/face/enrollment/sessions/:id',async(req,res,next)=>{try{res.json(await service.session(token(req),z.uuid().parse(req.params['id'])));}catch(e){faceRouteError(res,next,e);}});
  app.post('/api/attendance/face/sessions',async(req,res,next)=>{try{
    const {SimpleFaceAttendanceSessionRequestSchema}=await import('@absensi/contracts');
    res.json(await service.issueAttendance(token(req),SimpleFaceAttendanceSessionRequestSchema.parse(req.body).action));
  }catch(e){faceRouteError(res,next,e);}});
  for(const enrollment of [true,false]){
    const path=enrollment?'/api/face/enrollment/submit':'/api/attendance/face/submit';
    app.post(path,express.json({limit:enrollment?'1100kb':'512kb',inflate:false}),async(req,res,next)=>{
      if(res.writableEnded||req.destroyed)return;
      const remaining=30_000-(performance.now()-(res.locals['faceStartedAt'] as number));
      if(remaining<=0){sendAppError(res,new AppError(408,'INFERENCE_TIMEOUT','Pemeriksaan melewati batas waktu.'));return;}
      const controller=new AbortController();const deadline=setTimeout(()=>controller.abort(),remaining);
      const onClose=()=>{if(!res.writableEnded)controller.abort();};res.once('close',onClose);
      try{res.json(enrollment?await service.enroll(token(req),SimpleFaceEnrollmentSubmissionSchema.parse(req.body),controller.signal)
        :await service.submitAttendance(token(req),SimpleFaceAttendanceSubmissionSchema.parse(req.body),controller.signal));}
      catch(e){faceRouteError(res,next,e);}
      finally{clearTimeout(deadline);res.off('close',onClose);}
    });
  }
  app.post('/api/admin/teachers/:id/face-reenrollment',createSessionGuard(auth),requireRole('SUPER_ADMIN'),createCsrfProtectionMiddleware(true),async(req,res,next)=>{
    try{const {FaceReenrollmentGrantRequestSchema}=await import('@absensi/contracts');FaceReenrollmentGrantRequestSchema.parse(req.body);
      res.json(await service.grant(token(req),z.uuid().parse(req.params['id'])));}catch(e){faceRouteError(res,next,e);}
  });
}
