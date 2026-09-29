import {
  AdminEarlyDepartureRequestDetailResponseSchema,
  AdminLeaveRequestDetailResponseSchema,
  AuditLogListResponseSchema,
  ListAuditLogsQuerySchema,
  RequestAttachmentMetadataSchema,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

const attachment = { originalName: 'surat.pdf', mimeType: 'application/pdf', sizeBytes: 1024 } as const;

describe('super admin expansion contracts', () => {
  it('accepts safe attachment metadata and rejects storage URLs and extra fields', () => {
    expect(RequestAttachmentMetadataSchema.parse(attachment)).toEqual(attachment);
    expect(RequestAttachmentMetadataSchema.safeParse({ ...attachment, storageUrl: 'https://secret' }).success).toBe(false);
    expect(RequestAttachmentMetadataSchema.safeParse({ ...attachment, sizeBytes: 5 * 1024 * 1024 + 1 }).success).toBe(false);
  });

  it('normalizes audit filters and rejects unknown fields', () => {
    expect(ListAuditLogsQuerySchema.parse({ page: '2', pageSize: '25', action: 'LEAVE_APPROVED' })).toMatchObject({ page: 2, pageSize: 25 });
    expect(ListAuditLogsQuerySchema.safeParse({ page: 1, pageSize: 25, password: 'secret' }).success).toBe(false);
    expect(ListAuditLogsQuerySchema.safeParse({ fromDate: '2026-09-05', toDate: '2026-09-04' }).success).toBe(false);
  });

  it('keeps admin detail responses strict', () => {
    const base = {
      id: '40000000-0000-4000-8000-000000000001', teacherId: '50000000-0000-4000-8000-000000000001',
      reason: 'Berobat', attachment, status: 'PENDING', decisionNote: null, decidedBy: null,
      decidedAt: null, createdAt: '2026-09-04T01:00:00.000Z', updatedAt: '2026-09-04T01:00:00.000Z',
      teacherNip: '1987001', teacherFullName: 'Guru Satu', teacherWhatsappNumber: '+628123456789',
    };
    expect(AdminLeaveRequestDetailResponseSchema.safeParse({ leaveRequest: { ...base, leaveDate: '2026-09-05', leaveType: 'SICK' } }).success).toBe(true);
    expect(AdminEarlyDepartureRequestDetailResponseSchema.safeParse({
      earlyDepartureRequest: { ...base, attendanceId: '40000000-0000-4000-8000-000000000002', workDate: '2026-09-04', requestedAt: base.createdAt, latitude: -8.13, longitude: 113.22, accuracyMeters: 5, distanceMeters: 3 },
      attendanceTimeline: [{ type: 'CHECK_IN', timestamp: base.createdAt, label: 'Check-in' }],
    }).success).toBe(true);
  });

  it('requires actor identity and pagination in audit responses', () => {
    expect(AuditLogListResponseSchema.safeParse({ data: [], pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 } }).success).toBe(true);
  });
});
