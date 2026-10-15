import { describe, expect, it } from 'vitest';
import { FaceTemplateCipher } from './face-template.js';

describe('encrypted face template', () => {
  const context = { userId: 'user-a', templateId: 'template-a', modelVersion: 'v1' };
  const embedding = Array.from({ length: 128 }, () => 1 / Math.sqrt(128));
  it('encrypts with a fresh nonce and authenticates ownership and version', () => {
    const cipher = new FaceTemplateCipher('local-v1', Buffer.alloc(32, 7));
    const envelope = cipher.encrypt(context, embedding);
    expect(envelope.ciphertext).not.toContain(String(embedding[0]));
    expect(cipher.decrypt(context, envelope)).toEqual(embedding);
    expect(cipher.encrypt(context, embedding).nonce).not.toBe(envelope.nonce);
    for (const badContext of [{ ...context, userId: 'user-b' }, { ...context, modelVersion: 'v2' }]) {
      expect(() => cipher.decrypt(badContext, envelope)).toThrow();
    }
    expect(() => cipher.decrypt(context, { ...envelope, auth_tag: '\\x' + '00'.repeat(16) })).toThrow();
  });
  it('fails closed for missing keys or invalid embedding', () => {
    expect(() => new FaceTemplateCipher('v1', Buffer.alloc(12))).toThrow();
    const cipher = new FaceTemplateCipher('v1', Buffer.alloc(32));
    expect(() => cipher.encrypt(context, [NaN])).toThrow();
  });
});
