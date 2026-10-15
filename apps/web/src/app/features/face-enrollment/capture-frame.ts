import { FaceEnrollmentFrameSchema, FACE_FRAME_MAX_BYTES } from '@absensi/contracts';

export function captureFaceFrame(video:HTMLVideoElement) {
  if(!video.videoWidth||!video.videoHeight)throw new Error('Kamera belum siap.');
  const canvas=document.createElement('canvas');
  try{
    const scale=Math.min(640/video.videoWidth,480/video.videoHeight,1);
    canvas.width=Math.floor(video.videoWidth*scale);canvas.height=Math.floor(video.videoHeight*scale);
    const context=canvas.getContext('2d');if(!context)throw new Error('Kamera tidak dapat diproses.');
    context.drawImage(video,0,0,canvas.width,canvas.height);
    for(const quality of [.85,.7,.5]){
      const data=canvas.toDataURL('image/jpeg',quality).split(',')[1]!;
      if(data.length*3/4<=FACE_FRAME_MAX_BYTES)return FaceEnrollmentFrameSchema.parse({mimeType:'image/jpeg',data});
    }
    throw new Error('Gambar kamera terlalu besar.');
  }finally{canvas.width=0;canvas.height=0;}
}
