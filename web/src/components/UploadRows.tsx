import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { queueReady, progress } from '../upload/queue';
import * as runner from '../upload/runner';
import { finished, jobLabel, retentionLabel, type UploadJob } from '../upload/model';
import { getBlob } from '../upload/persistence';
import { bytes } from '../lib/format';
import { navigate } from '../lib/router';
import { Icon } from './Icon';
import { confirmAction } from './Dialog';
import { showToast } from '../store/ui';

export const safe = async (work:()=>Promise<unknown>) => { try { await work(); } catch(error) { showToast(error instanceof Error ? error.message : 'This action could not be saved. Keep the page open.',undefined,true); } };
function Thumbnail({ job }: { job:UploadJob }) {
  const [url,setUrl]=useState('');
  useEffect(()=>{let active=true,url='';setUrl('');if(job.thumbBytes)void getBlob(job.id,true).then(blob=>{if(active&&blob&&blob.type==='image/jpeg'){url=URL.createObjectURL(blob);setUrl(url);}}).catch(()=>{});return()=>{active=false;if(url)URL.revokeObjectURL(url);};},[job.id,job.thumbBytes]);
  return url ? <img class="upload-row-preview" src={url} alt="" /> : <span class="upload-row-preview"><Icon name={job.mime==='application/pdf'?'file-pdf':job.mime.startsWith('image/')?'image':'file'} /></span>;
}
export function Rows({ jobs, render, compact = false }: { jobs:UploadJob[]; compact?:boolean; render:(job:UploadJob)=>ComponentChildren }) {
  const root=useRef<HTMLDivElement>(null),[top,setTop]=useState(0),[height,setHeight]=useState(560);
  const rowHeight=compact?280:310,first=Math.max(0,Math.floor(top/rowHeight)-2),last=Math.min(jobs.length,Math.ceil((top+height)/rowHeight)+2);
  useEffect(()=>{if(!root.current)return;const observer=new ResizeObserver(([entry])=>setHeight(entry.contentRect.height));observer.observe(root.current);return()=>observer.disconnect();},[]);
  return <div ref={root} class={compact?"upload-list dock-list":"upload-list"} style={compact?{height:`${Math.min(jobs.length*rowHeight,560)}px`}:undefined} onScroll={event=>setTop(event.currentTarget.scrollTop)} tabIndex={0} aria-label="Upload list"><div class="upload-list-spacer" style={{height:`${jobs.length*rowHeight}px`}}><div class="upload-list-window" style={{transform:`translateY(${first*rowHeight}px)`}}>{jobs.slice(first,last).map(job=><div class="upload-list-slot" style={{height:`${rowHeight}px`}} key={job.id}>{render(job)}</div>)}</div></div></div>;
}
export function Row({ job, review, compact = false, checked = false, select = ()=>{} }: {job:UploadJob;review?:boolean;compact?:boolean;checked?:boolean;select?:(checked:boolean)=>void}) {
  const value=progress.value[job.id]??0;
  async function cancel():Promise<void>{if(await confirmAction('Cancel this upload and delete its local copy? A request already accepted by the server may still appear in your gallery.'))await safe(()=>runner.cancel(job.id));}
  async function remove():Promise<void>{if(finished(job)||await confirmAction('Remove this pending upload and its local copy? Uploaded server files will remain.'))await safe(()=>runner.remove(job.id));}
  return <article class="upload-row"><div class="upload-row-heading">{!compact&&<label class="upload-select"><input type="checkbox" checked={checked} disabled={!queueReady.value} onChange={event=>select(event.currentTarget.checked)} aria-label={`Select ${job.name}`} /></label>}<Thumbnail job={job}/><div class="upload-row-title"><strong title={job.name}>{job.name}</strong><span>{bytes(job.size)} · {jobLabel(job)}</span></div></div><p class={job.retention==='unretained'||job.retention==='missing'?'upload-retention danger-text':'upload-retention'}>{retentionLabel(job)}</p><p class="upload-row-error">{job.error || (job.sessionOnly?'Session-only upload: not recoverable after closing this page.':job.originalConfirmed&&job.thumbnail!=='confirmed'&&job.thumbnail!=='none'?'Original confirmed. Only thumbnail work remains.':job.uncertain?'Previous request may have succeeded; it will be checked before retrying.':'Whole-file restart when interrupted; uploaded originals are not sent again.')}</p>{job.phase==='original'&&!job.originalConfirmed&&<div class="upload-transfer"><progress max={1} value={value} aria-label={`Current transfer for ${job.name}`}/><span>{Math.round(value*100)}% transferred — awaiting server confirmation</span></div>}
    <div class="upload-row-actions">
      {compact&&(job.retention==='unretained'&&!job.sessionOnly||job.blocker==='missing'||!job.submitted||job.blocker==='unsupported')?<button class="text-button" onClick={()=>navigate('/uploads')}>Details — action needed</button>:job.retention==='unretained'&&!job.sessionOnly&&!finished(job)?<><button class="text-button" onClick={()=>void safe(()=>runner.retryRetention(job.id))}>Retry saving locally</button><button class="text-button" onClick={async()=>{if(await confirmAction('Upload without local recovery? Keep this page open. This file may be lost from the queue if the page closes.'))await safe(()=>runner.sessionOnly(job.id));}}>Upload this time without local recovery</button></>:job.blocker==='missing'?<label class="text-button reselect-file">Choose file again<input type="file" aria-label={`Choose original again for ${job.name}`} onChange={async event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(!file)return;const confirmed=!!job.hash||await confirmAction(`No saved hash exists, so identity cannot be proven. Replace ${job.originalName} (${bytes(job.size)}, ${new Date(job.modified).toLocaleString()}) with ${file.name}?`);if(confirmed)await safe(()=>runner.reselect(job.id,file,true));}}/></label>:!finished(job)&&job.submitted?<>{job.intent==='pause'||job.blocker==='restored'?<button class="text-button" onClick={()=>void safe(()=>runner.resume(job.id))}>Resume</button>:job.blocker==='retry'||job.blocker==='local'?<button class="text-button" onClick={()=>void safe(()=>runner.resume(job.id,true))}>Retry</button>:<button class="text-button" onClick={()=>void safe(()=>runner.pause(job.id))}>Pause</button>}</>:null}
      {!finished(job)&&job.submitted&&<button class="text-button" onClick={()=>void cancel()}>Cancel</button>}
      {!compact&&job.originalConfirmed&&!finished(job)&&<button class="text-button" onClick={async()=>{if(await confirmAction('Discard this local copy? The uploaded original remains in Dump. Thumbnail recovery may wait until the app backfills it.'))await safe(()=>runner.discardLocal(job.id));}}>Discard local copy</button>}
      {!compact&&(review||finished(job)||job.blocker==='local'||job.blocker==='missing'||job.blocker==='unsupported')&&<button class="text-button danger-text" onClick={()=>void remove()}>Remove</button>}
    </div>
  </article>;
}
export function DockRows({ jobs }: {jobs:UploadJob[]}) { return <Rows compact jobs={jobs} render={job=><Row compact job={job}/>}/>; }
