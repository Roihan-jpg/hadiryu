import type { AdminEarlyDepartureRequest, AttendanceTimelineEvent } from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { EarlyDepartureRequestsService } from '../../early-departure-requests/early-departure-requests.service';

@Component({
  selector: 'app-admin-early-departure-request-detail-page', imports: [MatButtonModule, ReactiveFormsModule, RouterLink],
  template: `
    <section class="page-shell detail-shell"><a class="back" routerLink="/admin/early-departure-requests">← Kembali ke antrean pulang awal</a>
      @if (errorMessage()) { <p class="feedback error" role="alert">{{ errorMessage() }}</p> }
      @if (loading()) { <div class="skeleton admin-panel"></div> }
      @else if (request(); as item) {
        <header><div><p>DETAIL PERMOHONAN</p><h1>Pulang Awal</h1><span>{{ date(item.workDate) }}</span></div><span [class]="'status-pill ' + item.status.toLowerCase()">{{ statusLabel(item.status) }}</span></header>
        <div class="detail-grid"><main class="admin-panel">
          <section><h2>Informasi Guru</h2><dl><div><dt>Nama</dt><dd>{{ item.teacherFullName }}</dd></div><div><dt>NIP</dt><dd>{{ item.teacherNip }}</dd></div><div><dt>Jarak dari batas</dt><dd>{{ clearance(item) }}</dd></div></dl>@if(item.teacherWhatsappNumber){<a class="wa" [href]="whatsappLink(item.teacherWhatsappNumber)" target="_blank" rel="noopener">Hubungi via WhatsApp</a>}</section>
          <section><h2>Alasan</h2><p>{{ item.reason }}</p></section>
          <section><h2>Lampiran</h2>@if(item.attachment){<a class="attachment" [href]="'/api/early-departure-requests/' + item.id + '/attachment'">Unduh {{ item.attachment.originalName }}</a>}@else{<p class="muted">Tidak ada lampiran.</p>}</section>
          <section><h2>Timeline absensi</h2><ol class="timeline">@for(event of timeline();track event.type + event.timestamp){<li><span></span><div><strong>{{ event.label }}</strong><small>{{ dateTime(event.timestamp) }}</small></div></li>}</ol></section>
          @if(item.decisionNote){<section><h2>Catatan keputusan</h2><p>{{ item.decisionNote }}</p></section>}
        </main><aside class="admin-panel decision"><h2>Keputusan</h2><p>Persetujuan memberi kredit target penuh dan kekurangan nol.</p>@if(item.status==='PENDING'){<label>Catatan (opsional)<textarea [formControl]="decisionNote" maxlength="1000" rows="5"></textarea></label><button mat-flat-button type="button" (click)="decide('APPROVED')" [disabled]="saving()">Setujui</button><button mat-stroked-button type="button" (click)="decide('REJECTED')" [disabled]="saving()">Tolak</button>}@else{<p class="muted">Diputuskan {{ item.decidedAt ? dateTime(item.decidedAt) : '-' }}</p>}</aside></div>
      }
    </section>
  `,
  styles: `
    .detail-shell{max-width:1050px}.back{display:inline-block;margin-bottom:24px;color:#477f79;font-size:12px;font-weight:700;text-decoration:none}header{display:flex;align-items:start;justify-content:space-between;gap:20px;margin-bottom:20px}header p{margin:0;color:#477f79;font-size:9px;font-weight:800;letter-spacing:.14em}header h1{margin:5px 0}header span{color:#74817d;font-size:12px}.detail-grid{display:grid;grid-template-columns:1fr 300px;gap:16px;align-items:start}.detail-grid main,.decision{padding:22px}.detail-grid main section+section{margin-top:22px;padding-top:20px;border-top:1px solid #e8e0d6}h2{margin:0 0 10px;font-size:14px}p{font-size:13px;line-height:1.65}dl{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:0}dt{color:#74817d;font-size:10px}dd{margin:3px 0 0;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}.wa,.attachment{display:inline-flex;margin-top:14px;color:#477f79;font-size:12px;font-weight:700}.muted{color:#74817d}.decision{display:grid;gap:10px}.decision p{margin:0 0 5px;color:#74817d;font-size:11px}.decision label{display:grid;gap:6px;color:#74817d;font-size:10px;font-weight:700}.decision textarea{resize:vertical;padding:10px;color:#34413e;background:#fffdf9;border:1px solid #d9d0c5;border-radius:5px;font:inherit}.timeline{display:grid;gap:0;margin:0;padding:0;list-style:none}.timeline li{display:grid;grid-template-columns:16px 1fr;gap:10px;min-height:52px}.timeline li>span{position:relative;width:8px;height:8px;margin-top:5px;background:#477f79;border-radius:50%}.timeline li>span:after{position:absolute;top:10px;bottom:-38px;left:3px;width:1px;background:#d4dfda;content:''}.timeline li:last-child>span:after{display:none}.timeline strong,.timeline small{display:block;font-size:11px}.timeline small{margin-top:3px;color:#74817d}.skeleton{height:420px;background:#f4eee6}@media(max-width:780px){.detail-grid{grid-template-columns:1fr}dl{grid-template-columns:1fr}}
  `,
})
export class AdminEarlyDepartureRequestDetailPage implements OnInit {
  private readonly route=inject(ActivatedRoute);private readonly service=inject(EarlyDepartureRequestsService);readonly request=signal<AdminEarlyDepartureRequest|null>(null);readonly timeline=signal<AttendanceTimelineEvent[]>([]);readonly loading=signal(true);readonly saving=signal(false);readonly errorMessage=signal('');readonly decisionNote=new FormControl('',{nonNullable:true,validators:[Validators.maxLength(1000)]});
  ngOnInit():void{void this.load()} async load():Promise<void>{this.loading.set(true);try{const result=await this.service.getAdmin(this.route.snapshot.paramMap.get('id')??'');this.request.set(result.earlyDepartureRequest);this.timeline.set(result.attendanceTimeline)}catch(error){this.errorMessage.set(await this.errorText(error))}finally{this.loading.set(false)}}
  async decide(action:'APPROVED'|'REJECTED'):Promise<void>{if(this.decisionNote.invalid||this.saving())return;this.saving.set(true);this.errorMessage.set('');const note=this.decisionNote.value.trim();try{await this.service.decide(this.request()!.id,action,note?{decisionNote:note}:{});await this.load()}catch(error){this.errorMessage.set(await this.errorText(error))}finally{this.saving.set(false)}}
  statusLabel(value:AdminEarlyDepartureRequest['status']):string{return({PENDING:'Pending',APPROVED:'Disetujui',REJECTED:'Ditolak'})[value]} date(value:string):string{return new Intl.DateTimeFormat('id-ID',{dateStyle:'long',timeZone:'UTC'}).format(new Date(`${value}T00:00:00Z`))} dateTime(value:string):string{return new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(value))} whatsappLink(value:string):string{return`https://wa.me/${value.replace('+','')}`} clearance(item:AdminEarlyDepartureRequest):string{return item.boundaryClearanceMeters===null||item.boundaryClearanceMeters===undefined?`${item.distanceMeters.toFixed(1)} m dari pusat`:`${item.boundaryClearanceMeters.toFixed(1)} m di dalam batas`}
  private async errorText(error:unknown):Promise<string>{if(error instanceof HttpErrorResponse){const{ApiErrorSchema}=await import('@absensi/contracts');const parsed=ApiErrorSchema.safeParse(error.error);if(parsed.success)return parsed.data.error.message}return'Detail pulang awal tidak dapat dimuat.'}
}
