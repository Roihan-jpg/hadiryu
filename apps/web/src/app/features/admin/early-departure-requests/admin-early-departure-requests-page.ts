import type { AdminEarlyDepartureRequest, EarlyDepartureStatus } from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';

import { EarlyDepartureRequestsService } from '../../early-departure-requests/early-departure-requests.service';

type StatusFilter = EarlyDepartureStatus | 'ALL';

@Component({
  imports: [MatButtonModule, MatPaginatorModule, MatProgressSpinnerModule, MatSelectModule, ReactiveFormsModule, RouterLink], selector: 'app-admin-early-departure-requests-page',
  template: `
    <section class="page-shell"><header><p>ANTREAN KEPUTUSAN</p><h1>Approval Pulang Awal</h1><span>Keputusan dilakukan setelah meninjau timeline dan lokasi pada halaman detail.</span></header>
      <form class="admin-panel filters" (ngSubmit)="applyFilters()"><div class="filter-control"><span>Status</span><mat-select aria-label="Status" [formControl]="statusControl"><mat-option value="PENDING">Pending</mat-option><mat-option value="APPROVED">Disetujui</mat-option><mat-option value="REJECTED">Ditolak</mat-option><mat-option value="ALL">Semua</mat-option></mat-select></div><label for="early-date">Tanggal</label><input id="early-date" type="date" [formControl]="dateControl" /><label for="early-search">Cari Guru</label><input id="early-search" type="search" placeholder="Nama atau NIP" [formControl]="searchControl" /><button mat-flat-button type="submit">Terapkan</button></form>
      @if(errorMessage()){<p class="feedback error" role="alert">{{errorMessage()}}</p>}
      @if(loading()){<div class="state"><mat-spinner diameter="28"/>Memuat permohonan…</div>}@else{<div class="admin-panel table-wrap"><table><thead><tr><th>Guru</th><th>Waktu pengajuan</th><th>Alasan</th><th>Lokasi</th><th>Status</th><th></th></tr></thead><tbody>@for(item of requests();track item.id){<tr><td><strong>{{item.teacherFullName}}</strong><small>{{item.teacherNip}}</small></td><td>{{dateTimeLabel(item.requestedAt)}}</td><td class="reason">{{item.reason}}</td><td>{{distanceLabel(item)}}</td><td><span [class]="'status-pill '+item.status.toLowerCase()">{{statusLabel(item.status)}}</span></td><td><a mat-button [routerLink]="['/admin/early-departure-requests',item.id]">Lihat detail</a></td></tr>}</tbody></table>@if(requests().length===0){<div class="state">Tidak ada permohonan pada filter ini.</div>}</div><mat-paginator [length]="pagination().totalItems" [pageIndex]="pagination().page-1" [pageSize]="pagination().pageSize" [pageSizeOptions]="[10,20,50]" (page)="pageChanged($event)"/>}
    </section>
  `,
  styles: `
    header{margin-bottom:22px}header p{margin:0;color:#477f79;font-size:9px;font-weight:800;letter-spacing:.14em}header h1{margin:5px 0}header span{color:#74817d;font-size:13px}.filters{display:grid;grid-template-columns:160px 180px 1fr auto;gap:5px 10px;align-items:end;padding:14px}.filter-control{display:grid;grid-row:1/3;gap:5px}.filters label,.filter-control span{color:#74817d;font-size:10px;font-weight:700}.filters label{grid-row:1}.filters input{grid-row:2}.filters input,.filters mat-select{height:40px;padding:0 10px;color:#34413e;background:#fffdf9;border:1px solid #d9d0c5;border-radius:5px;font:inherit}.filters mat-select{padding-top:9px}.filters button{grid-row:2}.table-wrap{margin-top:16px;overflow-x:auto}table{width:100%;min-width:820px;border-collapse:collapse}th,td{padding:11px 14px;border-bottom:1px solid #e8e0d6;text-align:left;font-size:11px}th{color:#74817d;background:#f7f2eb;font-size:9px;letter-spacing:.07em;text-transform:uppercase}td small{display:block;color:#74817d}.reason{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.state{display:flex;justify-content:center;gap:10px;padding:38px;color:#74817d;font-size:12px}mat-paginator{background:transparent}@media(max-width:760px){.filters{grid-template-columns:1fr}.filter-control,.filters label,.filters input,.filters button{grid-row:auto}}
  `,
})
export class AdminEarlyDepartureRequestsPage implements OnInit {
  private readonly service=inject(EarlyDepartureRequestsService);readonly statusControl=new FormControl<StatusFilter>('PENDING',{nonNullable:true});readonly dateControl=new FormControl('',{nonNullable:true});readonly searchControl=new FormControl('',{nonNullable:true});readonly requests=signal<AdminEarlyDepartureRequest[]>([]);readonly loading=signal(true);readonly errorMessage=signal('');readonly pagination=signal({page:1,pageSize:20,totalItems:0,totalPages:0});
  ngOnInit():void{void this.load()} async load():Promise<void>{this.loading.set(true);this.errorMessage.set('');const page=this.pagination();try{const result=await this.service.listAdmin({page:page.page,pageSize:page.pageSize,...(this.statusControl.value==='ALL'?{}:{status:this.statusControl.value}),...(this.dateControl.value?{workDate:this.dateControl.value}:{}),...(this.searchControl.value.trim()?{search:this.searchControl.value.trim()}:{})});this.requests.set(result.data);this.pagination.set(result.pagination)}catch(error){this.errorMessage.set(await this.errorText(error))}finally{this.loading.set(false)}} async applyFilters():Promise<void>{this.pagination.update(v=>({...v,page:1}));await this.load()}async pageChanged(event:PageEvent):Promise<void>{this.pagination.update(v=>({...v,page:event.pageIndex+1,pageSize:event.pageSize}));await this.load()}
  statusLabel(status:EarlyDepartureStatus):string{return({PENDING:'Pending',APPROVED:'Disetujui',REJECTED:'Ditolak'})[status]}dateTimeLabel(value:string):string{return new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(value))}distanceLabel(item:AdminEarlyDepartureRequest):string{return item.boundaryClearanceMeters===null||item.boundaryClearanceMeters===undefined?`${item.distanceMeters.toFixed(1)} m`:`${item.boundaryClearanceMeters.toFixed(1)} m aman`}
  private async errorText(error:unknown):Promise<string>{if(error instanceof HttpErrorResponse){const{ApiErrorSchema}=await import('@absensi/contracts');const parsed=ApiErrorSchema.safeParse(error.error);if(parsed.success)return parsed.data.error.message}return'Daftar pulang awal tidak dapat dimuat.'}
}
