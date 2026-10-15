import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { FaceInferenceRequest } from '@absensi/contracts';
import { PrivateFaceInferenceClient } from './face-inference-client.js';

const response=vi.hoisted(()=>({body: {} as unknown}));
vi.mock('node:https',()=>({request:(_url:unknown,_options:unknown,callback:(res:unknown)=>void)=>{
  const req=new EventEmitter() as EventEmitter & {end:()=>void;destroy:()=>void};
  req.destroy=()=>{req.emit('close');};
  req.end=()=>queueMicrotask(()=>{
    const res=Object.assign(new EventEmitter(),{statusCode:422});callback(res);
    res.emit('data',Buffer.from(JSON.stringify(response.body)));res.emit('end');req.emit('close');
  });
  return req;
}}));

describe('private inference rejection boundary',()=>{
  const input:FaceInferenceRequest={sessionId:'50000000-0000-4000-8000-000000000001',modelVersion:'test',
    steps:['BLINK','TURN_RIGHT'],challengeFrameCounts:[8,8],frames:Array.from({length:19},()=>({mimeType:'image/jpeg',data:'/9j/AA=='}))};
  const stages=[{stage:'BLINK',evaluated:8,rejected:1},{stage:'TURN_RIGHT',evaluated:8,rejected:0},
    {stage:'FRONT',evaluated:1,rejected:0},{stage:'LEFT',evaluated:1,rejected:0},{stage:'RIGHT',evaluated:1,rejected:0}];
  const client=new PrivateFaceInferenceClient('https://127.0.0.1:9443',
    {ca:Buffer.alloc(0),cert:Buffer.alloc(0),key:Buffer.alloc(0)},'test');
  it('forwards categorical diagnostics with rejection and rejects unexpected biometric fields',async()=>{
    response.body={error:{code:'PAD_FAILED',details:{stages}}};
    await expect(client.enroll(input,new AbortController().signal)).rejects.toMatchObject({code:'PAD_FAILED',status:422,details:{stages}});
    response.body={error:{code:'PAD_FAILED',details:{stages,rejectionKind:'BELOW_ACCEPTANCE'}}};
    await expect(client.enroll(input,new AbortController().signal)).rejects.toMatchObject({code:'PAD_FAILED',status:422,details:{stages,rejectionKind:'BELOW_ACCEPTANCE'}});
    response.body={error:{code:'PAD_FAILED',details:{stages,score:.1,image:'private-value'}}};
    await expect(client.enroll(input,new AbortController().signal)).rejects.toMatchObject({code:'INFERENCE_UNAVAILABLE',status:503,details:undefined});
    response.body={error:{code:'PAD_FAILED',details:{stages:stages.map(stage=>stage.stage==='TURN_RIGHT'?{...stage,stage:'TURN_LEFT'}:stage)}}};
    await expect(client.enroll(input,new AbortController().signal)).rejects.toMatchObject({code:'INFERENCE_INVALID_RESPONSE',status:503,details:undefined});
  });
});
