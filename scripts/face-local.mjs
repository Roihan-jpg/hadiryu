import { spawn, spawnSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { createClient } from '@supabase/supabase-js';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { readPrivateInferenceOrigin } from './face-local-port.mjs';

const root=resolve(import.meta.dirname,'..');
const cache=join(root,'.cache','face');
const source=join(root,'services','face-inference');
const manifest=JSON.parse(await readFile(join(source,'simple-model-manifest.json'),'utf8'));
const pipelineHash=createHash('sha256');
for(const file of ['simple-model-manifest.json','simple_pipeline.py','policy.py','identity.py','requirements.lock']) {
  pipelineHash.update(await readFile(join(source,file)));pipelineHash.update('\0');
}
const pipelineSha256=pipelineHash.digest('hex');
manifest.modelVersion += '-'+pipelineSha256.slice(0,16);
const mode=process.argv[2]??'start';
const allowed=['prepare','start','serve','stop','test','benchmark'];
if(!allowed.includes(mode))throw new Error('Use prepare, start, serve, stop, test or benchmark');
function run(command,args,capture=false){
  const result=spawnSync(command,args,{cwd:root,encoding:'utf8',stdio:capture?'pipe':'inherit',windowsHide:true});
  if(result.status!==0)throw new Error('Local face command failed: '+command);
  return result.stdout;
}
function status(){
  const value=JSON.parse(run(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],true));
  if(!['127.0.0.1','localhost'].includes(new URL(value.API_URL).hostname))throw new Error('Local Supabase required');
  return value;
}
if(mode==='prepare'){
  await mkdir(cache,{recursive:true});
  const ips=Object.values(networkInterfaces()).flat().filter(value=>value && value.family==='IPv4' && !value.internal)
    .map(value=>value.address);
  const lanIp=process.argv[3]??ips.find(value=>value.startsWith('192.168.'))??'127.0.0.1';
  run('docker',['build','-t','hadiryu-face:local',source]);
  run('docker',['run','--rm','--user','0','--env','FACE_PIPELINE_MODE=SIMPLE_LOCAL','--mount',`type=bind,source=${cache},target=/output`,'hadiryu-face:local',
    'python','prepare_local.py','--lan-ip',lanIp]);
  if(process.platform==='win32') {
    const owner=run('whoami',[],true).trim();
    run('icacls',[cache,'/inheritance:r','/grant:r',`${owner}:(OI)(CI)F`,'SYSTEM:(OI)(CI)F','/Q'],true);
    // Children inherit from the protected root. Removing inheritance recursively
    // would leave existing files with empty ACLs, including public model weights.
    run('icacls',[join(cache,'*'),'/reset','/T','/Q'],true);
  }
  console.log(`Persiapan selesai. CA kamera lokal: ${join(cache,'browser','hadiryu-local-ca.crt')}. LAN IP: ${lanIp}`);
  process.exit(0);
}
if(mode==='test' || mode==='benchmark'){
  run('docker',['run','--rm','--cpus','2','--memory','2g','--mount',`type=bind,source=${source},target=/app,readonly`,
    '--mount',`type=bind,source=${join(cache,'models')},target=/models,readonly`,
    'hadiryu-face:local','python',...(mode==='test'?['-m','unittest','-v','test_policy','test_pipeline','test_supervisor','test_simple_pipeline']:['simple_benchmark.py'])]);
  process.exit(0);
}
// Build before replacing the running service so source/manifest changes cannot use a stale image.
if(mode==='start' || mode==='serve') run('docker',['build','-t','hadiryu-face:local',source]);
const existing=spawnSync('docker',['inspect','--format','{{index .Config.Labels "hadiryu.task"}}','hadiryu-face-local'],{encoding:'utf8',windowsHide:true});
if(existing.status===0){
  if(existing.stdout.trim()!=='face-local')throw new Error('Container name belongs to another task');
  run('docker',['stop','-t','5','hadiryu-face-local']);
  run('docker',['rm','hadiryu-face-local']);
}
if(mode==='stop')process.exit(0);
const local=status();
run(process.execPath,['node_modules/supabase/dist/supabase.js','migration','up','--local']);
const client=createClient(local.API_URL,local.SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const recognition=manifest.models.recognition;
const registration={id:manifest.modelVersion,recognition_name:recognition.name,recognition_version:recognition.version,
  recognition_weights_version:recognition.weightsVersion,recognition_weights_sha256:recognition.sha256,pad_name:null,
  pad_version:null,pad_weights_version:null,pad_weights_sha256:null,verification_mode:'SIMPLE_LOCAL',
  runtime_name:'opencv-dnn',runtime_version:JSON.stringify(manifest.runtimes),
  embedding_dimensions:manifest.embeddingDimensions,preprocessing_version:manifest.preprocessingVersion,status:'EVALUATION',
  full_manifest:manifest,pipeline_sha256:pipelineSha256};
const loaded=await client.from('face_model_versions').select('*').eq('id',manifest.modelVersion).maybeSingle();
if(loaded.error)throw new Error('Model registry lookup failed');
if(loaded.data){
  if(Object.entries(registration).some(([key,value])=>key!=='full_manifest' && loaded.data[key]!==value))throw new Error('Model registration differs; use a new model version');
}else if((await client.from('face_model_versions').insert(registration)).error)throw new Error('Model registration failed');
// Docker Desktop does not publish ports on an --internal network. The dedicated
// bridge remains separate from Supabase; loopback publishing + mTLS restrict inbound access.
run('docker',['run','--detach','--name','hadiryu-face-local','--label','hadiryu.task=face-local','--network','bridge',
  '--cpus','2','--memory','2g','--pids-limit','64','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
  '--env','FACE_PIPELINE_MODE=SIMPLE_LOCAL',
  '--tmpfs','/tmp:rw,noexec,nosuid,size=32m','--publish','127.0.0.1::9443',
  '--mount',`type=bind,source=${join(cache,'models')},target=/models,readonly`,
  '--mount',`type=bind,source=${join(cache,'server')},target=/certs,readonly`,'hadiryu-face:local']);
const inferenceOrigin=readPrivateInferenceOrigin();
if(mode==='serve') { console.log('Private inference started on loopback for local transport tests.');process.exit(0); }
const environment={...process.env,SUPABASE_URL:local.API_URL,SUPABASE_PUBLISHABLE_KEY:local.PUBLISHABLE_KEY,SUPABASE_SECRET_KEY:local.SECRET_KEY,
  FACE_ENROLLMENT_LOCAL:'true',FACE_MODEL_VERSION:manifest.modelVersion,FACE_TEMPLATE_KEY_FILE:join(cache,'template.key'),
  FACE_VERIFICATION_MODE:'SIMPLE_LOCAL',
  FACE_INFERENCE_ORIGIN:inferenceOrigin,
  FACE_TLS_CA:join(cache,'private','ca.pem'),FACE_TLS_CERT:join(cache,'private','client.pem'),FACE_TLS_KEY:join(cache,'private','client.key'),
  SESSION_COOKIE_SECURE:'true',NODE_ENV:'development',CORS_ALLOWED_ORIGINS:''};
run(process.execPath,['node_modules/typescript/bin/tsc','-p','packages/contracts/tsconfig.build.json']);
const children=[
  spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','apps/api/src/server.ts'],{cwd:root,env:environment,stdio:'inherit',windowsHide:true}),
  spawn(process.execPath,[join(root,'node_modules/@angular/cli/bin/ng.js'),'serve','--host','0.0.0.0','--port','4200','--ssl',
    '--ssl-cert',join(cache,'browser','browser.pem'),'--ssl-key',join(cache,'browser','browser.key'),
    '--proxy-config','proxy.conf.json'],{cwd:join(root,'apps','web'),env:environment,stdio:'inherit',windowsHide:true}),
];
let ending=false;
function stop(){if(ending)return;ending=true;for(const child of children)child.kill();
  spawnSync('docker',['stop','-t','5','hadiryu-face-local'],{stdio:'ignore',windowsHide:true});}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
for(const child of children)child.on('exit',stop);
console.log('Wajah sederhana lokal aktif: https://localhost:4200/guru/absen. Daftar wajah di Profil Saya. Inference tetap pada loopback.');
