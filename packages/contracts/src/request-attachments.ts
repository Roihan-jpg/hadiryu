import { z } from 'zod';

export const RequestAttachmentMimeTypeSchema = z.enum([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);
export type RequestAttachmentMimeType = z.infer<
  typeof RequestAttachmentMimeTypeSchema
>;

export const RequestAttachmentMetadataSchema = z.strictObject({
  originalName: z.string().trim().min(1).max(255),
  mimeType: RequestAttachmentMimeTypeSchema,
  sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024),
});
export type RequestAttachmentMetadata = z.infer<
  typeof RequestAttachmentMetadataSchema
>;
