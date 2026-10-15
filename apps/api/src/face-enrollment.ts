import {
  FaceEnrollmentSessionRequestSchema, FaceEnrollmentSubmissionSchema, FaceReenrollmentGrantRequestSchema,
  FACE_REQUEST_MAX_BYTES, type AuthUser, type FaceEnrollmentSession, type FaceEnrollmentStatus,
} from '@absensi/contracts';
import express, { type Express, type Request } from 'express';
import { z } from 'zod';
import { ACCESS_COOKIE_NAME, AppError, createSessionGuard, requireRole, sendAppError, type AuthService } from './auth.js';
import { createCsrfProtectionMiddleware, createRateLimiter } from './security.js';

export interface FaceEnrollmentService {
  status(token: string): Promise<FaceEnrollmentStatus>;
  issue(token: string, password: string): Promise<FaceEnrollmentSession>;
  submit(token: string, input: z.infer<typeof FaceEnrollmentSubmissionSchema>, signal: AbortSignal): Promise<FaceEnrollmentStatus>;
  session(token: string, id: string): Promise<unknown>;
  grant(token: string, userId: string): Promise<unknown>;
}
const base = '/api/face/enrollment';
function token(request: Request): string { return (request.cookies as Record<string,string>)[ACCESS_COOKIE_NAME]!; }
function inputError(): AppError { return new AppError(400,'VALIDATION_ERROR','Data enrollment tidak valid'); }
export function registerFaceEnrollmentRoutes(app: Express, auth: AuthService, service?: FaceEnrollmentService): void {
  const guards = [createSessionGuard(auth), requireRole('USER')];
  app.use(base, (req,res,next)=>{
    if(req.path==='/submit') {
      res.locals['faceEnrollmentStartedAt']=performance.now();
      res.set('Connection','close');
      const deadline=setTimeout(()=> {
        if(res.headersSent) { req.destroy(); return; }
        // Flush the structured error before closing a stalled upload socket.
        res.once('finish',()=>req.destroy());
        sendAppError(res,new AppError(408,'UPLOAD_TIMEOUT','Upload enrollment terlalu lama'));
      },15_000);
      const clear=()=>clearTimeout(deadline);
      req.once('end',clear);req.once('close',clear);res.once('finish',clear);
      res.once('finish',()=> { if(!req.complete) req.resume(); });
    }
    next();
  }, ...guards, createCsrfProtectionMiddleware(true),
    createRateLimiter({windowMs:60_000,max:30}), (_req,res,next) => {
    const user = res.locals['authUser'] as AuthUser;
    res.set('Cache-Control','no-store');
    if (!user.isActive) return sendAppError(res,new AppError(403,'ACCOUNT_INACTIVE','Akun dinonaktifkan'));
    if (!service) return sendAppError(res,new AppError(409,'ENROLLMENT_UNAVAILABLE','Enrollment lokal belum diaktifkan'));
    next();
  });
  app.get(`${base}/status`, async (req,res,next) => {
    try { res.json(await service!.status(token(req))); } catch(error) { if(error instanceof AppError) sendAppError(res,error); else next(error); }
  });
  app.post(`${base}/sessions`, async (req,res,next) => {
    try {
      const parsed=FaceEnrollmentSessionRequestSchema.safeParse(req.body);
      if(!parsed.success) throw inputError();
      res.json(await service!.issue(token(req),parsed.data.password));
    } catch(error) { if(error instanceof AppError) sendAppError(res,error); else next(error); }
  });
  app.get(`${base}/sessions/:id`, async (req,res,next) => {
    try { res.json(await service!.session(token(req),z.uuid().parse(req.params['id']))); }
    catch(error) { next(error instanceof z.ZodError ? inputError():error); }
  });
  app.post(`${base}/submit`, express.json({ limit: FACE_REQUEST_MAX_BYTES, inflate:false }), async (req,res,next) => {
    if(res.writableEnded || req.destroyed) return;
    const remaining=30_000-(performance.now()-(res.locals['faceEnrollmentStartedAt'] as number));
    if(remaining<=0) return sendAppError(res,new AppError(408,'INFERENCE_TIMEOUT','Batas waktu enrollment berakhir'));
    const controller=new AbortController();
    const deadline=setTimeout(()=>controller.abort(),remaining);
    const onClose=()=> { if(!res.writableEnded) controller.abort(); };
    res.once('close',onClose);
    try {
      const parsed=FaceEnrollmentSubmissionSchema.safeParse(req.body);
      if(!parsed.success) throw inputError();
      res.json(await service!.submit(token(req),parsed.data,controller.signal));
    } catch(error) { if(error instanceof AppError) sendAppError(res,error); else next(error); }
    finally { clearTimeout(deadline); res.off('close',onClose); }
  });
  app.post('/api/admin/teachers/:id/face-reenrollment',createSessionGuard(auth),requireRole('SUPER_ADMIN'),createCsrfProtectionMiddleware(true),async(req,res,next)=>{
    try {
      if(!service) throw new AppError(409,'ENROLLMENT_UNAVAILABLE','Enrollment lokal belum diaktifkan');
      if(!FaceReenrollmentGrantRequestSchema.safeParse(req.body).success) throw inputError();
      res.set('Cache-Control','no-store').json(await service.grant(token(req),z.uuid().parse(req.params['id'])));
    } catch(error) { next(error instanceof z.ZodError?inputError():error); }
  });
}
