import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { privateInferenceOrigin } from './face-local-port.mjs';

const binding=(hostIp='127.0.0.1',hostPort='49173')=>({labels:{'hadiryu.task':'face-local'},
  ports:{'9443/tcp':[{HostIp:hostIp,HostPort:hostPort}]}});
test('uses the actual Docker host port rather than the Windows-reserved container port',async()=>{
  const server=createServer();
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const port=server.address().port;
    assert.equal(privateInferenceOrigin(binding('127.0.0.1',String(port))),`https://127.0.0.1:${port}`);
    assert.equal(privateInferenceOrigin(binding()),'https://127.0.0.1:49173');
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('rejects public bindings, multiple bindings, invalid ports and containers belonging to another task',()=>{
  for(const value of [binding('0.0.0.0'),binding('::'),binding('192.168.1.7'),binding('127.0.0.1','0'),
    binding('127.0.0.1','65536'),binding('127.0.0.1','9443/path'),
    {...binding(),labels:{'hadiryu.task':'other'}},
    {...binding(),ports:{'9443/tcp':null}},
    {...binding(),ports:{'9443/tcp':[...binding().ports['9443/tcp'],...binding().ports['9443/tcp']]}}]){
    assert.throws(()=>privateInferenceOrigin(value),/Private inference binding/);
  }
});
