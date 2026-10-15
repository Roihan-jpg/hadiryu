import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { hashPassword, validateNip, validateFullName, validatePassword } from './setup/core.mjs';

// Local operator bootstrap only; never copies hosted accounts or prints passwords.
if(!process.stdin.isTTY) throw new Error('Jalankan face:account dari terminal interaktif Anda.');
const root=resolve(import.meta.dirname,'..');
const result=spawnSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],
  {cwd:root,encoding:'utf8',windowsHide:true});
if(result.status!==0) throw new Error('Supabase lokal belum siap.');
const status=JSON.parse(result.stdout);
if(!['127.0.0.1','localhost'].includes(new URL(status.DB_URL).hostname)) throw new Error('Hanya database lokal diizinkan.');
class SecretOutput extends Writable {
  muted=false;
  _write(chunk,encoding,callback) { if(!this.muted) process.stdout.write(chunk,encoding);callback(); }
}
const output=new SecretOutput();
const prompt=createInterface({input:process.stdin,output,terminal:true});
const client=new pg.Client({connectionString:status.DB_URL});
try {
  const role=(await prompt.question('Jenis akun lokal (USER/SUPER_ADMIN) [USER]: ')).trim().toUpperCase() || 'USER';
  if(!['USER','SUPER_ADMIN'].includes(role)) throw new Error('Pilih USER atau SUPER_ADMIN yang sudah tersedia.');
  const nip=validateNip(await prompt.question('NIP/username baru: ')).toLowerCase();
  const fullName=validateFullName(await prompt.question('Nama: '));
  process.stdout.write('Password (8 karakter; huruf besar, kecil, angka; tersembunyi): ');
  output.muted=true;
  let password;
  try { password=validatePassword(await prompt.question('')); }
  finally { output.muted=false;process.stdout.write('\n'); }
  const passwordHash=await hashPassword(password);password='';
  const id=randomUUID();
  await client.connect();await client.query('begin');
  try {
    await client.query(`insert into public.profiles(id,nip,full_name,role,is_active,must_change_password)
      values($1,$2,$3,$4,true,false)`,[id,nip,fullName,role]);
    await client.query('insert into public.app_accounts(profile_id,password_hash) values($1,$2)',[id,passwordHash]);
    await client.query(`insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_data)
      values($1,'LOCAL_EVALUATION_ACCOUNT_CREATED','profiles',$1,jsonb_build_object('role',$2::text))`,[id,role]);
    await client.query('commit');
  } catch {
    await client.query('rollback');
    throw new Error('Akun tidak dibuat. Periksa NIP yang sudah dipakai; akun existing tidak diubah.');
  }
  process.stdout.write(`Akun ${role} lokal ${nip} siap. Login dengan password yang Anda masukkan.\n`);
} finally { prompt.close();await client.end(); }
