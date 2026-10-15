import { request } from 'node:https';
import { z } from 'zod';
import { FaceInferenceRequestSchema, FaceInferenceResultSchema, FaceInferenceErrorSchema, SimpleFaceInferenceRequestSchema, type SimpleFaceInferenceRequest, type FaceInferenceRequest } from '@absensi/contracts';
import { AppError } from './auth.js';
import type { FaceInferenceClient } from './supabase-face-enrollment.js';

export class PrivateFaceInferenceClient implements FaceInferenceClient {
  constructor(private readonly origin:string,private readonly tls:{ca:Buffer;cert:Buffer;key:Buffer},private readonly modelVersion:string) {
    const url=new URL(origin);
    if(url.protocol!=='https:' || url.hostname!=='127.0.0.1' || url.pathname!=='/' || url.username || url.password)
      throw new Error('Private inference must use loopback HTTPS');
  }
  private send(path:string,input?:FaceInferenceRequest|SimpleFaceInferenceRequest,signal?:AbortSignal):Promise<unknown> {
    return new Promise((resolve,reject)=>{
      const bytes=input?Buffer.from(JSON.stringify('operation' in input ? SimpleFaceInferenceRequestSchema.parse(input) : FaceInferenceRequestSchema.parse(input))):undefined;
      const req=request(new URL(path,this.origin),{...this.tls,method:bytes?'POST':'GET',signal,
        headers:bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{},rejectUnauthorized:true},res=>{
        const parts:Buffer[]=[];let length=0;
        res.on('data',(part:Buffer)=> {
          length+=part.length;
          if(length>16_384) {
            reject(new AppError(503,'INFERENCE_INVALID_RESPONSE','Respons inference tidak valid'));
            req.destroy(new Error('Inference response limit'));
          } else parts.push(part);
        });
        res.on('error',()=>reject(new AppError(503,'INFERENCE_UNAVAILABLE','Service inference tidak tersedia')));
        res.on('end',()=>{
          try {
            const body:unknown=JSON.parse(Buffer.concat(parts).toString());
            if(res.statusCode!==200) {
              const parsed=FaceInferenceErrorSchema.safeParse(body);
              const code=parsed.success ? parsed.data.error.code:'INFERENCE_UNAVAILABLE';
              const details=parsed.success && parsed.data.error.code==='PAD_FAILED'?parsed.data.error.details:undefined;
              if(details && input && 'steps' in input){
                const expected=[...input.steps,'FRONT','LEFT','RIGHT'];
                const counts=[...input.challengeFrameCounts,1,1,1];
                if(details.stages.some((stage,index)=>stage.stage!==expected[index] || stage.evaluated!==counts[index])){
                  reject(new AppError(503,'INFERENCE_INVALID_RESPONSE','Respons inference tidak valid'));
                  return;
                }
              }
              reject(new AppError(code==='INFERENCE_BUSY'?429:code==='MODEL_UNAVAILABLE'||code==='INFERENCE_UNAVAILABLE'||code==='INFERENCE_TIMEOUT'?503:422,code,'Pemeriksaan wajah gagal. Ikuti petunjuk dan coba sesi baru.',details));
            } else resolve(body);
          } catch { reject(new AppError(503,'INFERENCE_INVALID_RESPONSE','Respons inference tidak valid')); }
        });
      });
      const deadline=setTimeout(()=> {
        reject(new AppError(503,'INFERENCE_TIMEOUT','Service inference melewati batas waktu'));
        req.destroy(new Error('Inference deadline'));
      },12_000);
      req.once('close',()=>clearTimeout(deadline));
      req.on('error',()=>reject(new AppError(503,signal?.aborted?'INFERENCE_TIMEOUT':'INFERENCE_UNAVAILABLE','Service inference tidak tersedia')));
      req.end(bytes);
    });
  }
  async ready():Promise<void> {
    const parsed=z.strictObject({ready:z.literal(true),modelVersion:z.string()}).safeParse(await this.send('/ready'));
    if(!parsed.success) throw new AppError(503,'INFERENCE_INVALID_RESPONSE','Service inference belum siap');
    const body=parsed.data;
    if(body.modelVersion!==this.modelVersion) throw new AppError(409,'MODEL_VERSION_MISMATCH','Versi service inference berbeda');
  }
  async enroll(input:FaceInferenceRequest,signal:AbortSignal) {
    const parsed=FaceInferenceResultSchema.safeParse(await this.send('/v1/enrollment',input,signal));
    if(!parsed.success) throw new AppError(503,'INFERENCE_INVALID_RESPONSE','Respons inference tidak valid');
    return parsed.data;
  }
  async simple(input:SimpleFaceInferenceRequest,signal:AbortSignal) {
    const parsed=FaceInferenceResultSchema.safeParse(await this.send('/v1/simple',input,signal));
    if(!parsed.success || parsed.data.modelVersion!==this.modelVersion) throw new AppError(503,'INFERENCE_INVALID_RESPONSE','Respons inference tidak valid');
    return parsed.data;
  }
}
