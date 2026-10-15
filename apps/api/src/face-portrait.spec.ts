import {describe,expect,it} from 'vitest';
import {FaceTemplateCipher} from './face-template.js';
describe('encrypted enrollment reference photo',()=>{
  it('binds a photo to owner, template, model, MIME and a distinct purpose',()=>{
    const cipher=new FaceTemplateCipher('test',Buffer.alloc(32,7));
    const context={userId:'a',templateId:'one',modelVersion:'v1'};
    const bytes=Buffer.from([255,216,255,217]);
    const envelope=cipher.encryptPortrait(context,'image/jpeg',bytes);
    expect(cipher.decryptPortrait(context,'image/jpeg',envelope)).toEqual(bytes);
    expect(()=>cipher.decryptPortrait({...context,userId:'b'},'image/jpeg',envelope)).toThrow();
    expect(()=>cipher.decryptPortrait({...context,templateId:'two'},'image/jpeg',envelope)).toThrow();
    expect(()=>cipher.decryptPortrait({...context,modelVersion:'v2'},'image/jpeg',envelope)).toThrow();
    expect(()=>cipher.decryptPortrait(context,'image/png',envelope)).toThrow();
    expect(()=>cipher.decrypt(context,envelope)).toThrow();
    expect(()=>cipher.decryptPortrait(context,'image/jpeg',{...envelope,auth_tag:'\\x'+'00'.repeat(16)})).toThrow();
  });
});
