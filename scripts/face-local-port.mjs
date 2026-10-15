import { spawnSync } from 'node:child_process';
import { z } from 'zod';

const bindingSchema=z.strictObject({
  labels:z.object({'hadiryu.task':z.literal('face-local')}),
  ports:z.strictObject({'9443/tcp':z.array(z.strictObject({
    HostIp:z.literal('127.0.0.1'),
    HostPort:z.string().regex(/^[1-9][0-9]{0,4}$/).refine(value=>Number(value)<=65535),
  })).length(1)}),
});

export function privateInferenceOrigin(binding){
  const parsed=bindingSchema.safeParse(binding);
  if(!parsed.success)throw new Error('Private inference binding must belong to this task and use loopback');
  return 'https://127.0.0.1:'+parsed.data.ports['9443/tcp'][0].HostPort;
}

export function readPrivateInferenceOrigin(){
  const result=spawnSync('docker',['inspect','--format',
    '{"labels":{{json .Config.Labels}},"ports":{{json .NetworkSettings.Ports}}}','hadiryu-face-local'],
  {encoding:'utf8',windowsHide:true,maxBuffer:8192});
  if(result.status!==0)throw new Error('Private inference binding is unavailable');
  let binding;
  try{binding=JSON.parse(result.stdout);}catch{throw new Error('Private inference binding is invalid');}
  return privateInferenceOrigin(binding);
}
