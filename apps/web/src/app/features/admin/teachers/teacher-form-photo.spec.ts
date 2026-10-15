import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Teacher } from '@absensi/contracts';
import { TeacherFormDialog } from './teachers-page';
import { TeachersService } from './teachers.service';

const teacher = { id: '50000000-0000-4000-8000-000000000001', fullName: 'Guru Fixture', role: 'USER', nip: 'fixture' } as Teacher;
describe('private enrollment photo in teacher edit', () => {
  afterEach(() => vi.restoreAllMocks());
  function create(photo: () => Promise<Blob>, data: Teacher | null = teacher) {
    TestBed.configureTestingModule({ imports: [TeacherFormDialog], providers: [
      { provide: MAT_DIALOG_DATA, useValue: data }, { provide: MatDialogRef, useValue: { close: vi.fn() } },
      { provide: TeachersService, useValue: { enrollmentPhoto: photo } },
    ] });
    const fixture = TestBed.createComponent(TeacherFormDialog);fixture.detectChanges();return fixture;
  }
  it('loads only the selected teacher photo and revokes its temporary URL on close', async () => {
    const photo = vi.fn(async () => new Blob(['fixture'], { type: 'image/jpeg' }));
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const fixture = create(photo);await fixture.whenStable();fixture.detectChanges();
    expect(photo).toHaveBeenCalledExactlyOnceWith(teacher.id);
    expect(fixture.nativeElement.querySelector('img').getAttribute('src')).toBe('blob:fixture');
    expect(createUrl).toHaveBeenCalledOnce();fixture.destroy();expect(revoke).toHaveBeenCalledWith('blob:fixture');
  });
  it('explains why an older enrollment has no photo', async () => {
    const fixture = create(async () => { throw new HttpErrorResponse({ status: 404 }); });
    await fixture.whenStable();fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Pendaftaran lama hanya menyimpan template wajah.');
    expect(fixture.nativeElement.querySelector('img')).toBeNull();fixture.destroy();
  });
  it('does not fetch a photo for new accounts or Satpam', async () => {
    const photo = vi.fn(async () => new Blob());
    let fixture = create(photo, null);await fixture.whenStable();fixture.destroy();TestBed.resetTestingModule();
    fixture = create(photo, { ...teacher, role: 'SECURITY_GUARD' });await fixture.whenStable();
    expect(photo).not.toHaveBeenCalled();fixture.destroy();
  });
  it('does not create a URL if the edit dialog closes before the photo arrives', async () => {
    let resolve!: (value: Blob) => void;
    const createUrl = vi.spyOn(URL, 'createObjectURL');
    const fixture = create(() => new Promise<Blob>(done => { resolve = done; }));
    fixture.destroy();resolve(new Blob(['fixture'], { type: 'image/jpeg' }));await Promise.resolve();
    expect(createUrl).not.toHaveBeenCalled();
  });
});
