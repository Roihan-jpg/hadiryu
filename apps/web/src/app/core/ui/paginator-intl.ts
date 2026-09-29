import { MatPaginatorIntl } from '@angular/material/paginator';

export function createIndonesianPaginatorIntl(): MatPaginatorIntl {
  const paginator = new MatPaginatorIntl();
  paginator.itemsPerPageLabel = 'Baris per halaman:';
  paginator.nextPageLabel = 'Halaman berikutnya';
  paginator.previousPageLabel = 'Halaman sebelumnya';
  paginator.firstPageLabel = 'Halaman pertama';
  paginator.lastPageLabel = 'Halaman terakhir';
  paginator.getRangeLabel = (page, pageSize, length) => {
    if (length === 0 || pageSize === 0) return '0 dari 0';
    const start = page * pageSize + 1;
    const end = Math.min(start + pageSize - 1, length);
    return `${start}–${end} dari ${length}`;
  };
  return paginator;
}
