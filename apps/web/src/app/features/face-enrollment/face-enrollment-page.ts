import { Component, DestroyRef, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FaceEnrollmentSessionSchema, FaceEnrollmentStatusSchema, FaceEnrollmentSubmissionSchema,
  FacePadDiagnosticsSchema,
  SimpleFaceSessionSchema, SimpleFaceEnrollmentSubmissionSchema, type SimpleFaceSession,
  FACE_FRAME_MAX_BYTES, FACE_MOTION_POLICY, type FaceEnrollmentSession, type FaceEnrollmentSubmission,
} from '@absensi/contracts';
import { CameraSession } from '../face-challenge/camera-session';
import { captureFaceFrame } from './capture-frame';
import { advanceChallenge, evaluateFrame, type FrameSignals } from '../face-challenge/face-challenge-evaluator';

type CapturedFrame=FaceEnrollmentSubmission['frames'][number];
const MODEL='/assets/face-enrollment/landmarker.task';
@Component({
  selector:'app-face-enrollment-page',
  imports:[FormsModule,RouterLink,MatButtonModule,MatCheckboxModule,MatFormFieldModule,MatInputModule],
  templateUrl:'./face-enrollment-page.html',styleUrl:'./face-enrollment-page.scss',
})
export class FaceEnrollmentPage {
  @ViewChild('preview') private preview?:ElementRef<HTMLVideoElement>;
  private readonly http=inject(HttpClient);
  private readonly destroyRef=inject(DestroyRef);
  private camera:CameraSession|null=null;
  private landmarker:import('@mediapipe/tasks-vision').FaceLandmarker|null=null;
  private runId=0;
  private destroyed=false;
  private readonly canvas=document.createElement('canvas');
  private session:FaceEnrollmentSession|null=null;
  readonly simpleMode=signal(false);
  private simpleExpiresAt:string|null=null;
  private simpleSession:SimpleFaceSession|null=null;
  readonly previewRatio=signal(4/3);
  readonly frameCaptured=signal(false);
  private frames:CapturedFrame[]=[];
  private frontYaw:number|null=null;
  readonly state=signal<'LOADING'|'IDLE'|'STARTING'|'CAPTURING'|'SUBMITTING'|'DONE'|'ERROR'>('LOADING');
  readonly enrollmentStatus=signal('');
  readonly feedback=signal('Memuat status enrollment…');
  readonly error=signal<string|null>(null);
  readonly captureStage=signal('');
  readonly poseProgress=signal(0);
  statusLabel():string {
    return ({NOT_ENROLLED:'Belum terdaftar',ACTIVE:'Terdaftar',DISABLED:'Template dinonaktifkan',REVOKED:'Template dicabut',
      REENROLLMENT_REQUIRED:'Perlu pendaftaran ulang'} as Record<string,string>)[this.enrollmentStatus()]??this.enrollmentStatus();
  }
  password='';
  consent=false;
  constructor(){
    this.destroyRef.onDestroy(()=>{this.destroyed=true;this.runId++;this.cleanup();this.password='';});
    void this.loadStatus();
  }
  private async loadStatus():Promise<void>{
    try{
      const response=await firstValueFrom(this.http.get<unknown>('/api/face/enrollment/status').pipe(takeUntilDestroyed(this.destroyRef)));
      if(this.destroyed) return;
      const status=FaceEnrollmentStatusSchema.parse(response);
      this.enrollmentStatus.set(status.status);
      this.simpleMode.set(status.mode==='SIMPLE_LOCAL');
      this.state.set('IDLE');this.feedback.set(status.mode==='SIMPLE_LOCAL'?'Daftarkan wajah sekali untuk Absen Masuk dan Absen Pulang.':'Enrollment lokal tersedia. Absensi berjalan seperti biasa.');
    }catch(cause){if(!this.destroyed){this.state.set('ERROR');this.error.set(this.message(cause));}}
  }
  async start():Promise<void>{
    if(['STARTING','CAPTURING','SUBMITTING','LOADING'].includes(this.state())) return;
    if(!this.consent || this.password.length<8){this.error.set('Baca pemberitahuan dan isi password Anda.');return;}
    const run=++this.runId;
    this.cleanup();this.error.set(null);this.state.set('STARTING');
    let password=this.password;this.password='';
    try{
      const response=await firstValueFrom(this.http.post<unknown>('/api/face/enrollment/sessions',{password}).pipe(takeUntilDestroyed(this.destroyRef)));
      password='';if(!this.current(run)) return;
      const simple=SimpleFaceSessionSchema.safeParse(response);
      if(simple.success){this.simpleMode.set(true);this.simpleExpiresAt=simple.data.expiresAt;this.simpleSession=simple.data;}
      else this.session=FaceEnrollmentSessionSchema.parse(response);
      if(!navigator.mediaDevices?.getUserMedia) throw new Error('Kamera memerlukan HTTPS yang dipercaya perangkat.');
      this.camera=new CameraSession(navigator.mediaDevices);
      const stream=await this.camera.start();if(!stream || !this.current(run)) return;
      const video=this.preview?.nativeElement;if(!video) throw new Error('Pratinjau kamera tidak tersedia.');
      video.srcObject=stream;await video.play();if(!this.current(run)) return;
      if(simple.success){
        this.state.set('CAPTURING');this.captureStage.set('Hadapkan wajah ke kamera');
        this.previewRatio.set(video.videoWidth/video.videoHeight||4/3);
        this.feedback.set('Posisikan wajah di tengah oval, lalu tekan Daftarkan wajah.');
        return;
      }
      this.feedback.set('Menyiapkan panduan kamera…');
      const {FaceLandmarker,FilesetResolver}=await import('@mediapipe/tasks-vision');
      const fileset=await FilesetResolver.forVisionTasks('/assets/mediapipe');
      const landmarker=await FaceLandmarker.createFromOptions(fileset,{baseOptions:{modelAssetPath:MODEL,delegate:'CPU'},
        runningMode:'VIDEO',numFaces:2,outputFaceBlendshapes:true});
      if(!this.current(run)){landmarker.close();return;}
      this.landmarker=landmarker;this.state.set('CAPTURING');
      const session=this.session;
      if(!session)throw new Error('Sesi pendaftaran tidak tersedia.');
      const counts:[number,number]=[0,0];
      for(let index=0;index<2;index++){
        const step=session.steps[index]!;
        this.captureStage.set(`Langkah ${index+1} dari 5 — ${step==='BLINK'?'kedip':step==='TURN_LEFT'?'toleh kiri Anda':'toleh kanan Anda'}`);
        counts[index]=await this.captureChallenge(run,step);
      }
      for(const [index,pose] of (['FRONT','LEFT','RIGHT'] as const).entries()) {
        this.captureStage.set(`Langkah ${index+3} dari 5 — pose ${pose==='FRONT'?'depan':pose==='LEFT'?'kiri Anda':'kanan Anda'}`);
        await this.capturePose(run,pose);
      }
      if(!this.current(run)) return;
      const submission=FaceEnrollmentSubmissionSchema.parse({sessionId:session.sessionId,frames:this.frames,challengeFrameCounts:counts});
      this.stopCamera();this.captureStage.set('Semua gambar sudah diambil');this.state.set('SUBMITTING');this.feedback.set('Pemeriksaan otomatis sedang berlangsung. Tunggu hasil pendaftaran…');
      const status=FaceEnrollmentStatusSchema.parse(await firstValueFrom(this.http.post<unknown>('/api/face/enrollment/submit',submission)
        .pipe(takeUntilDestroyed(this.destroyRef))));
      if(!this.current(run)) return;
      this.enrollmentStatus.set(status.status);this.state.set('DONE');
      this.feedback.set('Enrollment berhasil. Template wajah terenkripsi tersimpan. Absensi tetap seperti biasa.');
    }catch(cause){if(this.current(run)){this.state.set('ERROR');this.error.set(this.message(cause));}}
    finally{if(this.current(run)&&this.state()!=='CAPTURING')this.cleanup();}
  }
  async submitSimple():Promise<void>{
    if(this.state()!=='CAPTURING'||!this.simpleSession)return;
    const run=this.runId,session=this.simpleSession;
    this.state.set('SUBMITTING');this.error.set(null);this.frameCaptured.set(false);
    this.feedback.set('Tahan wajah di tengah oval. Mengambil tiga gambar depan…');
    try{
      const video=this.preview?.nativeElement;if(!video)throw new Error('Kamera belum tersedia.');
      const frames:CapturedFrame[]=[];
      for(let index=0;index<3;index++){
        await new Promise(resolve=>setTimeout(resolve,350));this.check(run);
        frames.push(captureFaceFrame(video));this.poseProgress.set(Math.round((index+1)/3*100));
      }
      this.frameCaptured.set(true);this.stopCamera();this.feedback.set('Gambar ditangkap. Memeriksa dan menyimpan pendaftaran…');
      const input=SimpleFaceEnrollmentSubmissionSchema.parse({sessionId:session.sessionId,frames});
      const status=FaceEnrollmentStatusSchema.parse(await firstValueFrom(this.http.post<unknown>('/api/face/enrollment/submit',input).pipe(takeUntilDestroyed(this.destroyRef))));
      if(!this.current(run))return;
      if(status.status!=='ACTIVE')throw new Error('Pendaftaran belum tersimpan.');
      this.enrollmentStatus.set(status.status);this.state.set('DONE');this.feedback.set('Wajah terdaftar. Anda dapat melakukan Absen Masuk dan Absen Pulang.');
    }catch(error){if(this.current(run)){this.state.set('ERROR');this.error.set(this.message(error));}}
    finally{if(this.current(run))this.cleanup();}
  }
  cancel():void{this.runId++;this.cleanup();this.password='';this.state.set('IDLE');this.feedback.set('Kamera berhenti. Gunakan sesi baru untuk mencoba lagi.');}
  private current(run:number):boolean{return !this.destroyed && run===this.runId;}
  private check(run:number):void{
    if(!this.current(run))throw new Error('Enrollment dibatalkan.');
    const expiresAt=this.session?.expiresAt??this.simpleExpiresAt;
    if(!expiresAt || Date.now()>=Date.parse(expiresAt))throw new Error('Sesi berakhir. Konfirmasi password dan mulai kembali.');
  }
  private async sample(run:number):Promise<{frame:CapturedFrame;signals:FrameSignals}>{
    await new Promise(resolve=>setTimeout(resolve,84));this.check(run);
    const video=this.preview!.nativeElement;
    const scale=Math.min(640/video.videoWidth,480/video.videoHeight,1);
    this.canvas.width=Math.floor(video.videoWidth*scale);this.canvas.height=Math.floor(video.videoHeight*scale);
    const context=this.canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('Kamera tidak dapat diproses.');
    context.drawImage(video,0,0,this.canvas.width,this.canvas.height);
    // Analyze the upload resolution, not a potentially much larger camera feed.
    const result=this.landmarker!.detectForVideo(this.canvas,performance.now());
    const points=result.faceLandmarks[0];const xs=points?.map(point=>point.x)??[];
    const width=xs.length?Math.max(...xs)-Math.min(...xs):0;
    const shapes=result.faceBlendshapes[0]?.categories??[];
    const score=(name:string)=>shapes.find(item=>item.categoryName===name)?.score??0;
    const cheeks=Math.abs((points?.[454]?.x??0)-(points?.[234]?.x??0));
    const pixels=context.getImageData(0,0,this.canvas.width,this.canvas.height).data;
    let light=0;for(let i=0;i<pixels.length;i+=16)light+=(pixels[i]!+pixels[i+1]!+pixels[i+2]!)/3;
    const signals:FrameSignals={faceCount:result.faceLandmarks.length,brightness:light/Math.ceil(pixels.length/16),faceWidth:width,
      centered:xs.length>0 && Math.abs((Math.min(...xs)+Math.max(...xs))/2-.5)<.18,blinkLeft:score('eyeBlinkLeft'),blinkRight:score('eyeBlinkRight'),
      yaw:cheeks>.01?((points?.[1]?.x??0)-((points?.[234]?.x??0)+(points?.[454]?.x??0))/2)/cheeks:0};
    const data=this.canvas.toDataURL('image/jpeg',.85).split(',')[1]!;
    if(data.length*3/4>FACE_FRAME_MAX_BYTES)throw new Error('Frame kamera terlalu besar.');
    return {frame:{mimeType:'image/jpeg',data},signals};
  }
  private async captureChallenge(run:number,step:FaceEnrollmentSession['steps'][number]):Promise<number>{
    const ring:Awaited<ReturnType<FaceEnrollmentPage['sample']>>[]=[];
    while(this.current(run)){
      const sample=await this.sample(run);const quality=evaluateFrame(sample.signals);
      if(quality.status!=='READY'){this.feedback.set(quality.message);ring.length=0;continue;}
      ring.push(sample);if(ring.length>24)ring.shift();
      let progress={stepIndex:0,sawOpenEyes:false,sawClosedEyes:false,neutralYaw:null as number|null};
      for(const item of ring) {
        progress=advanceChallenge(progress,step,item.signals);
        if(progress.stepIndex>0)break;
      }
      if(progress.stepIndex>0 && ring.length>=8){this.frames.push(...ring.map(item=>item.frame));return ring.length;}
      this.feedback.set(progress.stepIndex>0?'Gerakan terbaca. Tahan sebentar.':step==='BLINK'
        ?progress.sawClosedEyes?'Buka kembali kedua mata.':progress.sawOpenEyes?'Tutup kedua mata sebentar, lalu buka kembali.':'Hadap depan dan buka kedua mata.'
        :progress.neutralYaw===null?'Hadap depan terlebih dahulu.':step==='TURN_LEFT'
          ?'Toleh sedikit ke kiri Anda — hidung bergerak ke kiri layar.':'Toleh sedikit ke kanan Anda — hidung bergerak ke kanan layar.');
    }
    throw new Error('Enrollment dibatalkan.');
  }
  private async capturePose(run:number,pose:'FRONT'|'LEFT'|'RIGHT'):Promise<void>{
    const recent:boolean[]=[];
    this.poseProgress.set(0);
    const name=pose==='FRONT'?'depan':pose==='LEFT'?'kiri':'kanan';
    const instruction=pose==='FRONT'?'Hadap depan dan tahan sebentar.':`Toleh sedikit ke ${name} Anda, lalu tahan sebentar.`;
    this.feedback.set(instruction);
    while(this.current(run)){
      const sample=await this.sample(run);const quality=evaluateFrame(sample.signals);
      const yaw=sample.signals.yaw;
      const delta=yaw-(this.frontYaw??0);
      const matches=pose==='FRONT'?Math.abs(yaw)<FACE_MOTION_POLICY.neutralYawMaximum
        :this.frontYaw!==null && (pose==='LEFT'
          ?delta>FACE_MOTION_POLICY.turnYawMinimum && delta<FACE_MOTION_POLICY.turnYawMaximum
          :delta<-FACE_MOTION_POLICY.turnYawMinimum && delta>-FACE_MOTION_POLICY.turnYawMaximum);
      const good=quality.status==='READY' && matches;
      recent.push(good);if(recent.length>FACE_MOTION_POLICY.poseWindowSamples)recent.shift();
      const goodCount=recent.filter(Boolean).length;
      this.poseProgress.set(Math.round(goodCount/FACE_MOTION_POLICY.poseGoodSamples*100));
      this.feedback.set(quality.status!=='READY'?quality.message
        :good?`Sudah pas — tahan sebentar (${goodCount}/${FACE_MOTION_POLICY.poseGoodSamples}).`
          :pose!=='FRONT' && Math.abs(delta)>=FACE_MOTION_POLICY.turnYawMaximum?'Tolehan terlalu jauh. Putar sedikit kembali ke depan.'
            :(pose==='RIGHT' && delta>0) || (pose==='LEFT' && delta<0)?`Kembali hadap depan, lalu toleh sedikit ke ${name} Anda.`:instruction);
      // Allow one noisy sample, but only send a currently valid pose to the server.
      if(good && goodCount>=FACE_MOTION_POLICY.poseGoodSamples){
        if(pose==='FRONT')this.frontYaw=yaw;
        this.frames.push(sample.frame);this.feedback.set(`Pose ${name} berhasil diambil.`);return;
      }
    }
    throw new Error('Enrollment dibatalkan.');
  }
  private stopCamera():void{this.landmarker?.close();this.landmarker=null;this.camera?.stop();this.camera=null;
    const video=this.preview?.nativeElement;if(video){video.pause();video.srcObject=null;}}
  private cleanup():void{this.stopCamera();this.captureStage.set('');this.poseProgress.set(0);this.frames=[];this.frontYaw=null;this.session=null;this.simpleExpiresAt=null;this.simpleSession=null;this.canvas.width=0;this.canvas.height=0;}
  private message(cause:unknown):string{
    if(cause instanceof HttpErrorResponse){const code=(cause.error as {error?:{code?:string}}|null)?.error?.code;
      if(code==='REENROLLMENT_APPROVAL_REQUIRED')return 'Template sudah ada. Minta SuperAdmin memeriksa identitas dan memberi izin daftar ulang.';
      if(code==='INVALID_CREDENTIALS')return 'Password salah. Periksa password akun Anda.';
      if(code==='REAUTH_LIMIT'||code==='ENROLLMENT_LIMIT')return 'Batas percobaan tercapai. Coba kembali setelah masa pembatasan berakhir.';
      if(code==='ENROLLMENT_UNAVAILABLE')return 'Enrollment hanya tersedia pada lingkungan evaluasi lokal yang sudah diaktifkan.';
      if(code==='FACE_NOT_CENTERED')return 'Posisikan wajah tepat di tengah oval lalu mulai pendaftaran kembali.';
      if(code==='PAD_FAILED'){
        const details=FacePadDiagnosticsSchema.safeParse((cause.error as {error?:{details?:unknown}}|null)?.error?.details);
        const names={BLINK:'kedipan',TURN_LEFT:'gerakan kiri',TURN_RIGHT:'gerakan kanan',FRONT:'pose depan',LEFT:'pose kiri',RIGHT:'pose kanan'};
        const summary=details.success?' Ditolak pada: '+details.data.stages.filter(item=>item.rejected>0).map(item=>names[item.stage]).join(', ')+'.'
          +(details.data.stages.filter(item=>['FRONT','LEFT','RIGHT'].includes(item.stage)).every(item=>item.rejected===0)
            ?' Pose depan, kiri, dan kanan lolos pemeriksaan anti-spoof.':''):'';
        const assessment=details.success && details.data.rejectionKind==='BELOW_ACCEPTANCE'
          ?' Gambar yang ditolak lebih dekat ke kelas asli, tetapi belum mencapai ambang penerimaan.':'';
        return 'Hasil pemeriksaan anti-spoof belum dapat memastikan keaslian gambar.'+summary+assessment+' Pendaftaran belum tersimpan. Jika berulang, admin perlu mengevaluasi pemeriksaan kamera. Pendaftaran pertama tetap tidak memerlukan izin daftar ulang.';
      }
      if(code==='QUALITY_FAILED')return 'Gambar wajah belum cukup terang, tajam, atau berada di tengah (QUALITY_FAILED). Bersihkan lensa, gunakan cahaya dari depan dan tahan HP stabil saat mengambil pose. Mulai sesi baru.';
      if(code==='POSE_FAILED'||code==='CHALLENGE_FAILED')return 'Gerakan belum sesuai ('+code+'). Ikuti satu instruksi sampai tahap berganti; kiri dan kanan mengikuti tubuh Anda. Mulai sesi baru.';
      if(code==='SESSION_EXPIRED')return 'Sesi berakhir. Konfirmasi password dan mulai kembali.';
      if(code==='ONE_FACE_REQUIRED')return 'Server harus melihat tepat satu wajah. Pastikan seluruh wajah terlihat dan tidak ada orang lain dalam kamera. Mulai sesi baru.';
      return 'Enrollment gagal'+(code?' ('+code+')':'')+'. Minta sesi baru untuk mencoba lagi.';
    }
    return cause instanceof Error?cause.message:'Enrollment gagal. Mulai kembali.';
  }
}
