import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { AppError } from './auth.js';
import { countLateArrivalQuotaRows, type RequestQuotaRepository } from './request-quotas.js';
import type { SupabaseAuthConfig } from './supabase-auth.js';

function clientOptions() {
  return {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  };
}

export class SupabaseRequestQuotaRepository implements RequestQuotaRepository {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseAuthConfig) {
    this.client = createClient(config.url, config.secretKey, clientOptions());
  }

  async countActive(teacherId: string, startDate: string, endDate: string) {
    const [lateArrival, earlyDeparture] = await Promise.all([
      this.client
        .from('leave_requests')
        .select('leave_type')
        .eq('teacher_id', teacherId)
        .in('status', ['PENDING', 'APPROVED'])
        .gte('leave_date', startDate)
        .lt('leave_date', endDate),
      this.client
        .from('early_departure_requests')
        .select('id', { count: 'exact', head: true })
        .eq('teacher_id', teacherId)
        .in('status', ['PENDING', 'APPROVED'])
        .gte('work_date', startDate)
        .lt('work_date', endDate),
    ]);

    if (lateArrival.error || earlyDeparture.error) {
      throw new AppError(500, 'REQUEST_QUOTA_LOOKUP_FAILED', 'Sisa kuota tidak dapat dimuat');
    }
    return {
      lateArrival: countLateArrivalQuotaRows(lateArrival.data ?? []),
      earlyDeparture: earlyDeparture.count ?? 0,
    };
  }
}
