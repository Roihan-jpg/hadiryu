import { describe, expect, it } from 'vitest';

import { validateProfilePhoto } from './profile.js';

function file(buffer: Buffer, mimetype: string): Express.Multer.File {
  return {
    fieldname: 'photo', originalname: 'avatar', encoding: '7bit', mimetype,
    size: buffer.length, buffer, destination: '', filename: '', path: '', stream: undefined as never,
  };
}

describe('profile photo validation', () => {
  it('accepts actual JPEG, PNG, and WebP signatures', () => {
    expect(validateProfilePhoto(file(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')).mimeType).toBe('image/jpeg');
    expect(validateProfilePhoto(file(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png')).mimeType).toBe('image/png');
    expect(validateProfilePhoto(file(Buffer.from('RIFF0000WEBP'), 'image/webp')).mimeType).toBe('image/webp');
  });

  it('rejects a declared MIME type whose magic bytes do not match', () => {
    expect(() => validateProfilePhoto(file(Buffer.from('not-an-image'), 'image/png')))
      .toThrowError(expect.objectContaining({ code: 'PHOTO_TYPE_INVALID' }));
  });
});
