import { z } from 'zod';
import { FaceEnrollmentFrameSchema } from './face-enrollment.js';
import { LocationInputSchema, AttendanceRecordSchema } from './attendance.js';

export const SimpleFaceModeSchema = z.literal('SIMPLE_LOCAL');
export const SimpleFaceActionSchema = z.enum(['CHECK_IN', 'CHECKOUT']);
export type SimpleFaceAction = z.infer<typeof SimpleFaceActionSchema>;
export const SimpleFaceSessionSchema = z.strictObject({
  sessionId: z.uuid(), expiresAt: z.iso.datetime({ offset: true }), modelVersion: z.string().min(1).max(200),
  mode: SimpleFaceModeSchema,
});
export type SimpleFaceSession = z.infer<typeof SimpleFaceSessionSchema>;
export const FacePortraitMimeSchema = z.enum(['image/jpeg','image/png']);
export const SimpleFaceEnrollmentSubmissionSchema = z.strictObject({
  sessionId: z.uuid(), frames: z.array(FaceEnrollmentFrameSchema).length(3),
});
export const SimpleFaceAttendanceSessionRequestSchema = z.strictObject({ action: SimpleFaceActionSchema });
export const SimpleFaceAttendanceSubmissionSchema = z.strictObject({
  sessionId: z.uuid(), frame: FaceEnrollmentFrameSchema, location: LocationInputSchema,
});
export type SimpleFaceAttendanceSubmission = z.infer<typeof SimpleFaceAttendanceSubmissionSchema>;
export const SimpleFaceInferenceRequestSchema = z.strictObject({
  sessionId: z.uuid(), modelVersion: z.string().min(1).max(200),
  operation: z.enum(['ENROLLMENT', 'VERIFICATION']), frames: z.array(FaceEnrollmentFrameSchema).min(1).max(3),
}).refine(value => value.frames.length === (value.operation === 'ENROLLMENT' ? 3 : 1), 'Jumlah frame tidak sesuai');
export type SimpleFaceInferenceRequest = z.infer<typeof SimpleFaceInferenceRequestSchema>;
export const SimpleFaceAttendanceResultSchema = AttendanceRecordSchema;
