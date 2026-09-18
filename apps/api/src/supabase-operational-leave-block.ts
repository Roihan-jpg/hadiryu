import { type LeaveStatus, type LeaveType } from '@absensi/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { AppError } from './auth.js';
import {
  resolveOperationalLeaveBlock,
  type OperationalLeaveBlock,
} from './operational-leave-block.js';

const LeaveRowSchema = z.strictObject({
  leave_date: z.string(),
  leave_type: z.enum(['SICK', 'OFFICIAL_DUTY', 'FAMILY', 'OTHER', 'LATE_ARRIVAL', 'MATERNITY_LEAVE']),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']),
  full_leave_end_date: z.string().nullable(),
  early_departure_start_date: z.string().nullable(),
  early_departure_end_date: z.string().nullable(),
});

export async function findSupabaseOperationalLeaveBlock(
  client: SupabaseClient,
  teacherId: string,
  workDate: string,
): Promise<OperationalLeaveBlock | null> {
  const { data, error } = await client
    .from('leave_requests')
    .select('leave_date,leave_type,status,full_leave_end_date,early_departure_start_date,early_departure_end_date')
    .eq('teacher_id', teacherId)
    .in('status', ['PENDING', 'APPROVED'])
    .lte('leave_date', workDate)
    .or(`leave_date.eq.${workDate},early_departure_end_date.gte.${workDate}`)
    .limit(20);
  if (error) throw new AppError(500, 'LEAVE_LOOKUP_FAILED', 'Status blokir izin tidak dapat dimuat');
  return resolveOperationalLeaveBlock((data ?? []).map((value) => {
    const row = LeaveRowSchema.parse(value);
    return {
      leaveDate: row.leave_date,
      leaveType: row.leave_type as LeaveType,
      status: row.status as LeaveStatus,
      fullLeaveEndDate: row.full_leave_end_date,
      earlyDepartureStartDate: row.early_departure_start_date,
      earlyDepartureEndDate: row.early_departure_end_date,
    };
  }), workDate);
}
