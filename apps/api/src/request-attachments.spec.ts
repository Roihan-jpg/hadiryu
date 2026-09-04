import type { Express } from 'express';
import { describe, expect, it } from 'vitest';

import { validateUploadedAttachment } from './request-attachments.js';

function file(mimetype: string, bytes: number[]): Express.Multer.File {
  const buffer = Buffer.from(bytes);
  return { fieldname: 'attachment', originalname: 'bukti.pdf', encoding: '7bit', mimetype, size: buffer.length, buffer, destination: '', filename: '', path: '', stream: undefined as never };
}

describe('request attachment validation', () => {
  it('checks magic bytes instead of trusting the declared MIME type', () => {
    expect(validateUploadedAttachment(file('application/pdf', [...Buffer.from('%PDF-1.7')]))).toMatchObject({ mimeType: 'application/pdf' });
    expect(() => validateUploadedAttachment(file('application/pdf', [...Buffer.from('not-a-pdf')]))).toThrowError(/PDF, JPEG, atau PNG/);
  });

  it('accepts PNG and JPEG signatures', () => {
    expect(validateUploadedAttachment(file('image/png', [137, 80, 78, 71, 13, 10, 26, 10]))?.mimeType).toBe('image/png');
    expect(validateUploadedAttachment(file('image/jpeg', [255, 216, 255, 224]))?.mimeType).toBe('image/jpeg');
  });
});
