import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { StaffDashboardService } from './staff-dashboard.service';

describe('StaffDashboardService', () => {
  it('sends month, pagination, and activity type to the dashboard API', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const service = TestBed.inject(StaffDashboardService);
    const http = TestBed.inject(HttpTestingController);
    const pending = service.fetch({ month: '2026-09', page: 2, pageSize: 8, type: 'LEAVE' });
    const request = http.expectOne((candidate) => candidate.url === '/api/dashboard');
    expect(request.request.params.get('month')).toBe('2026-09');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('type')).toBe('LEAVE');
    request.flush({});
    await expect(pending).rejects.toBeTruthy();
  });

  it('loads private attachments as blobs', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const service = TestBed.inject(StaffDashboardService);
    const http = TestBed.inject(HttpTestingController);
    const pending = service.fetchAttachment('EARLY_DEPARTURE', 'abc');
    const request = http.expectOne('/api/early-departure-requests/abc/attachment');
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['surat'], { type: 'application/pdf' }));
    expect((await pending).type).toBe('application/pdf');
  });
});
