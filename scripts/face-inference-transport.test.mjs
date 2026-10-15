import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readPrivateInferenceOrigin } from './face-local-port.mjs';
const root=resolve(import.meta.dirname,'..');
const directory=resolve(root,'.cache/face/private');
const ca=await readFile(resolve(directory,'ca.pem'));
const cert=await readFile(resolve(directory,'client.pem'));
const key=await readFile(resolve(directory,'client.key'));
const inferenceOrigin=readPrivateInferenceOrigin();
function call(path,options={},body){
  return new Promise((done,reject)=>{
    const bytes=body?Buffer.from(JSON.stringify(body)):undefined;
    const req=request(inferenceOrigin+path,{ca,cert,key,method:bytes?'POST':'GET',...options,
      headers:{...(bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{}),...options.headers}},res=>{
      const parts=[];res.on('data',value=>parts.push(value));res.on('end',()=>done({status:res.statusCode,body:JSON.parse(Buffer.concat(parts).toString())}));
    });
    req.setTimeout(15000,()=>req.destroy());req.on('error',reject);req.end(bytes);
  });
}
test('mTLS allows designated Express certificate and rejects other callers',async()=>{
  assert.equal((await call('/health')).status,200);
  const ready=(await call('/ready')).body;
  assert.equal(ready.ready,true);
  const source=resolve(root,'services/face-inference');
  const manifest=JSON.parse(await readFile(resolve(source,'simple-model-manifest.json'),'utf8'));
  const hash=createHash('sha256');
  for(const file of ['simple-model-manifest.json','simple_pipeline.py','policy.py','identity.py','requirements.lock']) {
    hash.update(await readFile(resolve(source,file)));hash.update('\0');
  }
  assert.equal(ready.modelVersion,manifest.modelVersion+'-'+hash.digest('hex').slice(0,16));
  await assert.rejects(call('/health',{cert:undefined,key:undefined}));
  const otherCert=await readFile(resolve(directory,'other-client.pem'));
  const otherKey=await readFile(resolve(directory,'other-client.key'));
  assert.equal((await call('/health',{cert:otherCert,key:otherKey})).status,403);
  assert.equal((await call('/health',{headers:{Origin:'https://localhost:4200'}})).status,403);
});
test('real service rejects corrupt media and version mismatch',async()=>{
  const body={sessionId:randomUUID(),modelVersion:(await call('/ready')).body.modelVersion,operation:'ENROLLMENT',frames:Array.from({length:3},()=>({mimeType:'image/jpeg',data:'AAAA'}))};
  assert.equal((await call('/v1/simple',{},body)).body.error.code,'INVALID_IMAGE');
  assert.equal((await call('/v1/simple',{}, {...body,modelVersion:'incompatible'})).body.error.code,'MODEL_VERSION_MISMATCH');
  assert.equal((await call('/v1/simple',{}, {...body,userId:randomUUID()})).status,422);
  assert.equal((await call('/v1/simple',{method:'POST',headers:{'Content-Length':4194305}})).body.error.code,'IMAGE_LIMIT');
});
test('concurrency 1/5/10 stays bounded and never turns corrupt input into success',async(context)=>{
  const version=(await call('/ready')).body.modelVersion;
  const body={sessionId:randomUUID(),modelVersion:version,operation:'ENROLLMENT',
    frames:Array.from({length:3},()=>({mimeType:'image/jpeg',data:'AAAA'}))};
  for(const concurrency of [1,5,10]) {
    const start=performance.now();
    const results=await Promise.all(Array.from({length:concurrency},()=>call('/v1/simple',{},body)));
    assert.ok(results.every(result=>result.status===422 || result.status===429));
    context.diagnostic(JSON.stringify({workload:'corrupt-input-burst',concurrency,elapsedMs:performance.now()-start,
      rejectedBusy:results.filter(result=>result.status===429).length}));
  }
});
