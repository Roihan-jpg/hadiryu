import {
  EnrollmentStepsSchema, FaceEnrollmentSessionSchema, FaceEnrollmentStatusSchema,
  FaceEnrollmentSessionStatusSchema, FaceReenrollmentGrantSchema, FaceInferenceResultSchema,
  FacePadDiagnosticsSchema,
  type FaceInferenceRequest, type FaceInferenceResult, type FaceEnrollmentSubmission,
} from '@absensi/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomUUID, randomInt } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './auth.js';
import type { FaceEnrollmentService } from './face-enrollment.js';
import { FaceTemplateCipher } from './face-template.js';
import { verifyPassword, type SupabaseAuthConfig } from './supabase-auth.js';

export interface FaceInferenceClient {
  ready(): Promise<void>;
  enroll(input: FaceInferenceRequest, signal: AbortSignal): Promise<FaceInferenceResult>;
}
const errors: Record<string,number> = {
  AUTH_REQUIRED:401,INVALID_CREDENTIALS:401,REAUTH_REQUIRED:401,ACCOUNT_INACTIVE:403,ROLE_FORBIDDEN:403,
  ACCOUNT_LOCKED:423,REAUTH_LIMIT:429,ENROLLMENT_LIMIT:429,SESSION_NOT_FOUND:404,SESSION_USED:409,
  SESSION_EXPIRED:410,SESSION_BUSY:409,REENROLLMENT_APPROVAL_REQUIRED:409,MODEL_UNAVAILABLE:503,
  MODEL_VERSION_MISMATCH:409,VALIDATION_ERROR:400,
  REENROLLMENT_NOT_NEEDED:409,
};
function dbFailure(message: string): AppError {
  const code=Object.keys(errors).find((candidate)=>message===candidate || message.endsWith(candidate));
  return code ? new AppError(errors[code]!,code,code==='REENROLLMENT_NOT_NEEDED'
    ? 'Guru belum memiliki template wajah. Pendaftaran pertama dapat dilakukan langsung dari Profil Saya tanpa izin daftar ulang.'
    : 'Enrollment tidak dapat dilanjutkan. Periksa sesi atau hubungi admin.')
    : new AppError(500,'ENROLLMENT_STORAGE_FAILED','Enrollment tidak dapat disimpan');
}
export function faceSessionHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export class SupabaseFaceEnrollmentService implements FaceEnrollmentService {
  private readonly client: SupabaseClient;
  constructor(config: SupabaseAuthConfig, private readonly modelVersion:string,
    private readonly inference: FaceInferenceClient, private readonly cipher:FaceTemplateCipher) {
    if(!['localhost','127.0.0.1'].includes(new URL(config.url).hostname)) throw new Error('Enrollment requires local Supabase');
    this.client=createClient(config.url,config.secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
  }
  private async rpc(name:string, args:Record<string,unknown>):Promise<unknown> {
    const {data,error}=await this.client.rpc(name,args);
    if(error) throw dbFailure(error.message);
    const rejected=z.object({error:z.string()}).safeParse(data);
    if(rejected.success) throw dbFailure(rejected.data.error);
    return data;
  }
  async status(token:string) {
    const status=FaceEnrollmentStatusSchema.parse(await this.rpc('face_enrollment_status',{p_hash:faceSessionHash(token),p_model:this.modelVersion}));
    if(status.status==='ACTIVE') {
      const userId=await this.client.from('app_sessions').select('profile_id').eq('token_hash',faceSessionHash(token)).single();
      if(userId.error) throw new AppError(401,'AUTH_REQUIRED','Sesi tidak valid');
      const stored=await this.client.from('biometric_templates').select('id,ciphertext,nonce,auth_tag,key_id,encryption_version')
        .eq('user_id',userId.data['profile_id'] as string).eq('status','ACTIVE').single();
      if(stored.error) throw new AppError(503,'ENROLLMENT_STORAGE_FAILED','Template tidak dapat dibaca');
      try {
        const envelope=z.strictObject({id:z.uuid(),ciphertext:z.string(),nonce:z.string(),auth_tag:z.string(),key_id:z.string(),encryption_version:z.string()}).parse(stored.data);
        const plain=this.cipher.decrypt({userId:userId.data['profile_id'] as string,templateId:envelope.id,modelVersion:status.modelVersion!},envelope);
        plain.fill(0);
      } catch { return {...status,status:'REENROLLMENT_REQUIRED' as const}; }
    }
    return status;
  }
  async issue(token:string,password:string) {
    await this.inference.ready();
    const hash=faceSessionHash(token);
    const proof=z.strictObject({attemptId:z.uuid(),passwordHash:z.string(),accountRevision:z.string()}).parse(
      await this.rpc('face_enrollment_reauth',{p_hash:hash}));
    const valid=await verifyPassword(password,proof.passwordHash);
    const direction=randomInt(2)===0?'TURN_LEFT':'TURN_RIGHT';
    const steps=randomInt(2)===0?['BLINK',direction]:[direction,'BLINK'];
    return FaceEnrollmentSessionSchema.parse(await this.rpc('face_enrollment_issue',{
      p_hash:hash,p_attempt:proof.attemptId,p_valid:valid,p_model:this.modelVersion,p_steps:steps,
    }));
  }
  async submit(token:string,input:FaceEnrollmentSubmission,signal:AbortSignal) {
    const hash=faceSessionHash(token), claimId=randomUUID();
    const claimed=z.strictObject({userId:z.uuid(),modelVersion:z.string(),steps:EnrollmentStepsSchema}).parse(
      await this.rpc('face_enrollment_claim',{p_hash:hash,p_id:input.sessionId,p_claim:claimId}));
    let result:FaceInferenceResult|undefined;
    try {
      if(claimed.modelVersion!==this.modelVersion) throw new AppError(409,'MODEL_VERSION_MISMATCH','Model berubah. Minta sesi enrollment baru.');
      signal.throwIfAborted();
      result=FaceInferenceResultSchema.parse(await this.inference.enroll({...input,modelVersion:claimed.modelVersion,steps:claimed.steps},signal));
      signal.throwIfAborted();
      if(result.modelVersion!==claimed.modelVersion) throw new AppError(409,'MODEL_VERSION_MISMATCH','Versi model inference tidak sesuai');
      const norm=Math.sqrt(result.embedding.reduce((total,value)=>total+value*value,0));
      if(Math.abs(norm-1)>0.001) throw new AppError(503,'INFERENCE_INVALID_RESPONSE','Hasil inference tidak valid');
      const id=randomUUID();
      const envelope=this.cipher.encrypt({userId:claimed.userId,templateId:id,modelVersion:claimed.modelVersion},result.embedding);
      return FaceEnrollmentStatusSchema.parse(await this.rpc('face_enrollment_finish',{
        p_hash:hash,p_id:input.sessionId,p_claim:claimId,p_template:id,p_envelope:{...envelope,modelVersion:claimed.modelVersion},
      }));
    } catch(error) {
      const safeCode=error instanceof AppError?error.code:signal.aborted?'INFERENCE_TIMEOUT':'INFERENCE_FAILED';
      const diagnostics=error instanceof AppError && safeCode==='PAD_FAILED'?FacePadDiagnosticsSchema.safeParse(error.details):undefined;
      const baseFailureCode=diagnostics?.success
        ?diagnostics.data.stages.every(stage=>stage.rejected===stage.evaluated)?'PAD_FAILED_ALL_FRAMES':'PAD_FAILED_SOME_FRAMES'
        :safeCode;
      const failureCode=diagnostics?.success && diagnostics.data.rejectionKind
        ?baseFailureCode+'_'+diagnostics.data.rejectionKind:baseFailureCode;
      await this.rpc('face_enrollment_fail',{p_hash:hash,p_id:input.sessionId,p_claim:claimId,p_code:failureCode});
      if(error instanceof AppError) throw error;
      throw new AppError(503,safeCode,'Enrollment gagal. Minta sesi baru untuk mencoba kembali.');
    } finally { result?.embedding.fill(0); }
  }
  async session(token:string,id:string) {
    return FaceEnrollmentSessionStatusSchema.parse(await this.rpc('face_enrollment_session_status',{p_hash:faceSessionHash(token),p_id:id}));
  }
  async grant(token:string,userId:string) {
    return FaceReenrollmentGrantSchema.parse(await this.rpc('face_enrollment_grant',{p_hash:faceSessionHash(token),p_user:userId}));
  }
}
