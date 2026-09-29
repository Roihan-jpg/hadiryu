import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { AppError } from './auth.js';
import type {
  ExcelExportAudit,
  ExcelExportAuditRepository,
} from './excel-export.js';
import type { SupabaseAuthConfig } from './supabase-auth.js';

export class SupabaseExcelExportAuditRepository
  implements ExcelExportAuditRepository
{
  private readonly client: SupabaseClient;

  constructor(config: SupabaseAuthConfig) {
    this.client = createClient(config.url, config.secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  async recordExport(audit: ExcelExportAudit): Promise<void> {
    const { error } = await this.client.from('audit_logs').insert({
      actor_id: audit.actorId,
      action: 'MONTHLY_REPORT_EXPORTED',
      entity_type: 'monthly_report_exports',
      entity_id: null,
      before_data: null,
      after_data: {
        generator: audit.generator,
        period: audit.period,
        teacherCount: audit.teacherCount,
        documentStatus: audit.documentStatus,
        issueCount: audit.issueCount,
        templateChecksum: audit.templateChecksum,
        exportedAt: audit.exportedAt,
      },
    });
    if (error) {
      throw new AppError(
        500,
        'EXCEL_EXPORT_AUDIT_FAILED',
        'Audit ekspor laporan tidak dapat dicatat',
      );
    }
  }
}
