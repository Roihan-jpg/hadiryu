import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FaceEnrollmentPage } from './face-enrollment-page';
import { HttpErrorResponse } from '@angular/common/http';

describe('enrollment camera and password lifecycle',()=>{
  const original=navigator.mediaDevices;
  afterEach(()=>Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:original}));
  function create(){
    TestBed.configureTestingModule({providers:[provideRouter([]),provideHttpClient(),provideHttpClientTesting()]});
    const fixture=TestBed.createComponent(FaceEnrollmentPage);fixture.detectChanges();
    const http=TestBed.inject(HttpTestingController);
    http.expectOne('/api/face/enrollment/status').flush({status:'NOT_ENROLLED',modelVersion:null});
    return {fixture,http};
  }
  it('explains the first enrollment status and gives actionable PAD and quality errors',async()=>{
    const {fixture,http}=create();await fixture.whenStable();fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Belum terdaftar');
    expect(fixture.nativeElement.textContent).toContain('tanpa izin daftar ulang');
    const page=fixture.componentInstance as unknown as {message:(cause:unknown)=>string};
    expect(page.message(new HttpErrorResponse({status:422,error:{error:{code:'PAD_FAILED'}}}))).toContain('pemeriksaan anti-spoof');
    expect(page.message(new HttpErrorResponse({status:422,error:{error:{code:'PAD_FAILED'}}}))).toContain('belum dapat memastikan');
    expect(page.message(new HttpErrorResponse({status:422,error:{error:{code:'PAD_FAILED'}}}))).toContain('Pendaftaran belum tersimpan');
    expect(page.message(new HttpErrorResponse({status:422,error:{error:{code:'QUALITY_FAILED'}}}))).toContain('tajam');
    fixture.destroy();http.verify();
  });
  it('names rejected stages from bounded server metadata and never displays scores or arbitrary details',async()=>{
    const {fixture,http}=create();await fixture.whenStable();
    const page=fixture.componentInstance as unknown as {message:(error:unknown)=>string};
    const stages=[{stage:'BLINK',evaluated:8,rejected:1},{stage:'TURN_RIGHT',evaluated:8,rejected:0},
      {stage:'FRONT',evaluated:1,rejected:0},{stage:'LEFT',evaluated:1,rejected:0},{stage:'RIGHT',evaluated:1,rejected:0}];
    const error=(details:unknown)=>new HttpErrorResponse({status:422,error:{error:{code:'PAD_FAILED',details}}});
    expect(page.message(error({stages}))).toContain('kedipan');
    expect(page.message(error({stages}))).toContain('Pose depan, kiri, dan kanan lolos');
    expect(page.message(error({stages,rejectionKind:'BELOW_ACCEPTANCE'}))).toContain('ambang penerimaan');
    expect(page.message(error({stages,score:.1,images:['private-material']}))).not.toContain('private-material');
    expect(page.message(error({stages,score:.1}))).not.toContain('kedipan');
    http.verify();
  });
  it('guides each blink phase and completes a brief blink within the bounded evidence window',async()=>{
    const {fixture,http}=create();await fixture.whenStable();
    const page=fixture.componentInstance as unknown as {runId:number;session:unknown;
      sample:(run:number)=>Promise<unknown>;captureChallenge:(run:number,step:string)=>Promise<number>;frames:unknown[]};
    page.runId=1;page.session={expiresAt:new Date(Date.now()+120_000).toISOString()};
    const ready={faceCount:1,brightness:110,faceWidth:.42,centered:true,blinkLeft:0,blinkRight:0,yaw:0};
    const frames=[ready,{...ready,blinkLeft:.9,blinkRight:.9},...Array.from({length:6},()=>ready)];
    const feedback:string[]=[];
    vi.spyOn(page,'sample').mockImplementation(async()=>{
      feedback.push(fixture.componentInstance.feedback());
      return {frame:{mimeType:'image/jpeg',data:'/9j/AA=='},signals:frames.shift()!};
    });
    expect(await page.captureChallenge(1,'BLINK')).toBe(8);
    expect(feedback.some(value=>value.includes('Tutup kedua mata'))).toBe(true);
    expect(feedback.some(value=>value.includes('Buka kembali'))).toBe(true);
    expect(page.frames).toHaveLength(8);
    fixture.destroy();http.verify();
  });
  it('analyzes the bounded image sent to the server and preserves detail instead of using low JPEG quality',async()=>{
    const {fixture,http}=create();await fixture.whenStable();
    const page=fixture.componentInstance as unknown as {runId:number;session:unknown;landmarker:unknown;
      sample:(run:number)=>Promise<{frame:{data:string}}>;canvas:HTMLCanvasElement};
    const video=fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperties(video,{videoWidth:{value:1920},videoHeight:{value:1080}});
    const context={drawImage:vi.fn(),scale:vi.fn(),translate:vi.fn(),getImageData:vi.fn(()=>({data:new Uint8ClampedArray(16).fill(110)}))};
    vi.spyOn(page.canvas,'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const encode=vi.spyOn(page.canvas,'toDataURL').mockReturnValue('data:image/jpeg;base64,/9j/AA==');
    const detect=vi.fn<(source:CanvasImageSource,time:number)=>{faceLandmarks:never[];faceBlendshapes:never[]}>(()=>({faceLandmarks:[],faceBlendshapes:[]}));
    const close=vi.fn();
    page.runId=1;page.session={expiresAt:new Date(Date.now()+120_000).toISOString()};
    page.landmarker={detectForVideo:detect,close};
    expect((await page.sample(1)).frame.data).toBe('/9j/AA==');
    expect(detect.mock.calls[0]?.[0]).toBe(page.canvas);
    expect(page.canvas.width).toBe(640);expect(page.canvas.height).toBe(360);
    expect(context.drawImage).toHaveBeenCalledWith(video,0,0,640,360);
    expect(context.scale).not.toHaveBeenCalled();expect(context.translate).not.toHaveBeenCalled();
    expect(encode).toHaveBeenCalledWith('image/jpeg',.85);
    fixture.destroy();http.verify();
  });
  it('does not request camera before consent and successful password confirmation',async()=>{
    const getUserMedia=vi.fn();Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia}});
    const {fixture,http}=create();await Promise.resolve();
    await fixture.componentInstance.start();expect(getUserMedia).not.toHaveBeenCalled();
    fixture.componentInstance.consent=true;fixture.componentInstance.password='Face1234';
    const started=fixture.componentInstance.start();
    const req=http.expectOne('/api/face/enrollment/sessions');expect(req.request.body).toEqual({password:'Face1234'});
    expect(fixture.componentInstance.password).toBe('');
    req.flush({error:{code:'INVALID_CREDENTIALS'}},{status:401,statusText:'Unauthorized'});
    await started;expect(getUserMedia).not.toHaveBeenCalled();expect(fixture.componentInstance.state()).toBe('ERROR');
    fixture.destroy();http.verify();
  });
  it('captures small poses from the front reference despite one jitter frame, without accepting stillness or the wrong direction',async()=>{
    const {fixture,http}=create();await fixture.whenStable();
    const page=fixture.componentInstance as unknown as {runId:number;session:unknown;frames:unknown[];
      sample:(run:number)=>Promise<unknown>;capturePose:(run:number,pose:string)=>Promise<void>};
    page.runId=1;page.session={expiresAt:new Date(Date.now()+120_000).toISOString()};
    const ready={faceCount:1,brightness:110,faceWidth:.42,centered:true,blinkLeft:0,blinkRight:0};
    let yaws=[.07,.07,.07,.07];
    vi.spyOn(page,'sample').mockImplementation(async()=>{
      if(!yaws.length)throw new Error('Signal sequence exhausted');
      return {frame:{mimeType:'image/jpeg',data:'/9j/AA=='},signals:{...ready,yaw:yaws.shift()!}};
    });
    await page.capturePose(1,'FRONT');
    yaws=[.205,.20,.175,.21,.20];
    await expect(page.capturePose(1,'LEFT')).resolves.toBeUndefined();
    yaws=[-.065,-.07,-.035,-.08,-.065];
    await expect(page.capturePose(1,'RIGHT')).resolves.toBeUndefined();
    expect(page.frames).toHaveLength(3);
    for(const yaw of [.07,-.065]){
      yaws=Array.from({length:6},()=>yaw);
      await expect(page.capturePose(1,'LEFT')).rejects.toThrow('Signal sequence exhausted');
      expect(page.frames).toHaveLength(3);
    }
    fixture.destroy();http.verify();
  });
  it('keeps the camera preview free of decorative overlays while capturing',async()=>{
    const {fixture,http}=create();await fixture.whenStable();fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.face-frame')).toBeNull();
    fixture.componentInstance.state.set('CAPTURING');fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('video')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.face-frame')).toBeNull();
    fixture.componentInstance.state.set('SUBMITTING');fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.face-frame')).toBeNull();
    fixture.destroy();http.verify();
  });
  it('guides the turn back from left through neutral, shows capture progress, and explains automatic submission',async()=>{
    const {fixture,http}=create();await fixture.whenStable();
    const page=fixture.componentInstance as unknown as {runId:number;session:unknown;frontYaw:number|null;frames:unknown[];
      sample:(run:number)=>Promise<unknown>;capturePose:(run:number,pose:string)=>Promise<void>};
    page.runId=1;page.session={expiresAt:new Date(Date.now()+120_000).toISOString()};page.frontYaw=.07;
    const ready={faceCount:1,brightness:110,faceWidth:.42,centered:true,blinkLeft:0,blinkRight:0};
    const yaws=[.2,.07,-.065,-.07,-.08,-.065];
    const messages:string[]=[];
    vi.spyOn(page,'sample').mockImplementation(async()=>{
      messages.push(fixture.componentInstance.feedback());
      if(!yaws.length)throw new Error('Signal sequence exhausted');
      return {frame:{mimeType:'image/jpeg',data:'/9j/AA=='},signals:{...ready,yaw:yaws.shift()!}};
    });
    await page.capturePose(1,'RIGHT');
    expect(messages.some(value=>value.includes('Kembali hadap depan'))).toBe(true);
    expect(messages.some(value=>value.includes('Sudah pas'))).toBe(true);
    expect(fixture.componentInstance.feedback()).toContain('Pose kanan berhasil diambil');
    fixture.componentInstance.state.set('CAPTURING');fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('pemeriksaan otomatis');
    fixture.componentInstance.captureStage.set('Langkah 5 dari 5 — pose kanan Anda');fixture.detectChanges();
    const progress=fixture.nativeElement.querySelector('progress') as HTMLProgressElement;
    expect(progress.value).toBe(100);expect(progress.getAttribute('aria-label')).toBe('Kestabilan pose');
    fixture.destroy();http.verify();
  });
  it('prevents double start and stops a camera stream arriving after navigation',async()=>{
    const stop=vi.fn();let resolve!:(value:MediaStream)=>void;
    const pending=new Promise<MediaStream>(done=>resolve=done);
    const getUserMedia=vi.fn().mockReturnValue(pending);Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia}});
    const {fixture,http}=create();await Promise.resolve();
    fixture.componentInstance.consent=true;fixture.componentInstance.password='Face1234';
    const started=fixture.componentInstance.start();await fixture.componentInstance.start();
    http.expectOne('/api/face/enrollment/sessions').flush({sessionId:crypto.randomUUID(),expiresAt:new Date(Date.now()+120_000).toISOString(),
      steps:['BLINK','TURN_LEFT'],modelVersion:'local-v1'});
    await Promise.resolve();expect(getUserMedia).toHaveBeenCalledOnce();
    fixture.destroy();resolve({getTracks:()=>[{stop}]} as unknown as MediaStream);await started;
    expect(stop).toHaveBeenCalledOnce();http.verify();
  });
});
