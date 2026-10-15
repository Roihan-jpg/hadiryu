import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

const EmbeddingSchema = z.array(z.number().finite().min(-1).max(1)).length(128);
export interface TemplateContext { userId: string; templateId: string; modelVersion: string }
export interface TemplateEnvelope {
  ciphertext: string; nonce: string; auth_tag: string; key_id: string; encryption_version: string;
}
const VERSION = 'aes-256-gcm-v1';
function aad(context: TemplateContext): Buffer {
  return Buffer.from(JSON.stringify([VERSION, context.userId, context.templateId, context.modelVersion]));
}
function bytea(buffer: Buffer): string { return '\\x' + buffer.toString('hex'); }

export class FaceTemplateCipher {
  constructor(private readonly keyId: string, private readonly key: Buffer) {
    if (key.length !== 32 || !/^[a-zA-Z0-9_-]{1,100}$/.test(keyId)) throw new Error('Invalid template key configuration');
  }
  encrypt(context: TemplateContext, value: number[]): TemplateEnvelope {
    const plaintext = Buffer.from(JSON.stringify(EmbeddingSchema.parse(value)));
    try {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
      cipher.setAAD(aad(context));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return { ciphertext: bytea(ciphertext), nonce: bytea(nonce), auth_tag: bytea(cipher.getAuthTag()),
        key_id: this.keyId, encryption_version: VERSION };
    } finally { plaintext.fill(0); }
  }
  decrypt(context: TemplateContext, envelope: TemplateEnvelope): number[] {
    if (envelope.key_id !== this.keyId || envelope.encryption_version !== VERSION) throw new Error('Template key unavailable');
    const decode = (value: string) => {
      if (!/^\\x(?:[a-f0-9]{2})+$/.test(value)) throw new Error('Invalid template envelope');
      return Buffer.from(value.slice(2), 'hex');
    };
    const decipher = createDecipheriv('aes-256-gcm', this.key, decode(envelope.nonce));
    decipher.setAAD(aad(context));
    decipher.setAuthTag(decode(envelope.auth_tag));
    const plaintext = Buffer.concat([decipher.update(decode(envelope.ciphertext)), decipher.final()]);
    try { return EmbeddingSchema.parse(JSON.parse(plaintext.toString())); }
    finally { plaintext.fill(0); }
  }
  encryptPortrait(context:TemplateContext,mimeType:'image/jpeg'|'image/png',bytes:Buffer):TemplateEnvelope {
    if(!bytes.length||bytes.length>262144)throw new Error('Invalid portrait size');
    const nonce=randomBytes(12),version='aes-256-gcm-portrait-v1';
    const cipher=createCipheriv('aes-256-gcm',this.key,nonce);
    cipher.setAAD(Buffer.from(JSON.stringify([version,context.userId,context.templateId,context.modelVersion,mimeType])));
    return {ciphertext:bytea(Buffer.concat([cipher.update(bytes),cipher.final()])),nonce:bytea(nonce),auth_tag:bytea(cipher.getAuthTag()),key_id:this.keyId,encryption_version:version};
  }
  decryptPortrait(context:TemplateContext,mimeType:'image/jpeg'|'image/png',envelope:TemplateEnvelope):Buffer {
    const version='aes-256-gcm-portrait-v1';
    if(envelope.key_id!==this.keyId||envelope.encryption_version!==version)throw new Error('Portrait key unavailable');
    const decode=(value:string)=>{
      if(!/^\\x(?:[a-f0-9]{2})+$/.test(value))throw new Error('Invalid portrait envelope');
      return Buffer.from(value.slice(2),'hex');
    };
    const decipher=createDecipheriv('aes-256-gcm',this.key,decode(envelope.nonce));
    decipher.setAAD(Buffer.from(JSON.stringify([version,context.userId,context.templateId,context.modelVersion,mimeType])));
    decipher.setAuthTag(decode(envelope.auth_tag));
    const pending=decipher.update(decode(envelope.ciphertext));
    try{
      const bytes=Buffer.concat([pending,decipher.final()]);
      if(!bytes.length||bytes.length>262144){bytes.fill(0);throw new Error('Invalid portrait size');}
      return bytes;
    }finally{pending.fill(0);}
  }
}
