import { computed, effect, signal, untracked } from '@preact/signals';
import type { FileDTO } from '../../../shared/types';
import { authState } from '../auth';
import { acceptUpload, localItems, type LocalFile, type UploadStatus } from '../store/files';
import { showToast } from '../store/ui';
import { sha256Hex } from './hash';
import { fileMime, uploadName } from './names';
import { createThumbnail, type Thumbnail } from './thumb';
import { recoverRequests, UploadError, xhr } from './xhr';

interface Job { item: LocalFile; file: File; hash: string; valid: boolean; controller?: AbortController }
interface Batch { jobs: Job[]; ready: boolean; running: boolean; controller?: AbortController }
const jobs: Job[] = [], batches: Batch[] = [];
const terminal = (status: UploadStatus) => ['done', 'duplicate', 'failed', 'cancelled'].includes(status);
export const uploads = signal<LocalFile[]>([]);
export const busy = computed(() => uploads.value.some((item) => !terminal(item.status)));
export const queueMessage = signal('');
export const foreground = signal(!document.hidden);
let halted = false, running = 0, nextId = 0, workCount = 0;
let dismiss: ReturnType<typeof setTimeout> | undefined;
const workWaiters: (() => void)[] = [];
export async function prepare<T>(work: () => Promise<T>): Promise<T> {
  if (workCount < 2) workCount++; else await new Promise<void>((resolve) => workWaiters.push(resolve));
  try { return await work(); }
  finally { const next = workWaiters.shift(); if (next) next(); else workCount--; }
}
const permitted = () => authState.peek() === 'in' && navigator.onLine && !halted;
function publish(): void {
  uploads.value = jobs.map((job) => ({ ...job.item }));
  localItems.value = authState.peek() === 'in' ? uploads.peek().filter((item) => !['done', 'duplicate', 'cancelled'].includes(item.status) && jobs.find((job) => job.item.localId === item.localId)?.valid) : [];
  clearTimeout(dismiss);
  if (jobs.length && jobs.every((job) => terminal(job.item.status)) && !jobs.some((job) => job.item.status === 'failed')) dismiss = setTimeout(clearFinished, 3000);
}
function update(job: Job, changes: Partial<LocalFile>): void { Object.assign(job.item, changes); publish(); }
function release(job: Job): void { if (job.item.previewUrl) URL.revokeObjectURL(job.item.previewUrl); job.item.previewUrl = ''; }
function ensurePreview(job: Job): void {
  if (!job.item.previewUrl && job.valid && job.item.mime.startsWith('image/')) job.item.previewUrl = URL.createObjectURL(job.file);
}
function paused(): void {
  for (const batch of batches) batch.controller?.abort();
  for (const job of jobs) if (!terminal(job.item.status)) {
    job.item.status = 'waiting'; job.item.message = navigator.onLine ? 'Sign in to resume' : 'Waiting for connection'; job.controller?.abort();
  }
  publish();
}
function stop(code: string): void {
  halted = true;
  queueMessage.value = code === 'DAILY_LIMIT' ? 'Daily upload limit reached. Try again after 06:00 Dhaka time.' : 'Storage is nearly full. Empty the Trash or delete files.';
  for (const batch of batches) batch.controller?.abort();
  for (const job of jobs) if (!terminal(job.item.status)) { job.item.status = 'failed'; job.item.message = queueMessage.peek(); job.controller?.abort(); }
  publish();
}
function errorMessage(error: unknown): string {
  if (error instanceof UploadError) {
    if (error.code === 'PAYLOAD_TOO_LARGE') return 'Too large (max 25 MB)';
    if (error.code === 'UNSUPPORTED_TYPE') return 'Unsupported file type';
  }
  return 'Upload failed';
}
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new UploadError(0, 'ABORT')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}
export async function uploadRequest<T>(path: string, blob: Blob, signal: AbortSignal, headers: Record<string, string>, progress?: (value: number) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await xhr<T>(path, blob, { signal, headers, progress }); }
    catch (error) {
      if (!(error instanceof UploadError)) throw error;
      if (error.status === 401) { authState.value = 'out'; throw error; }
      if (!navigator.onLine) { paused(); throw error; }
      if (error.code === 'DAILY_LIMIT' || error.code === 'STORAGE_FULL') { stop(error.code); throw error; }
      const retry = !error.status || error.status === 408 || error.status === 429 || error.status >= 500 || ['CHECKSUM_MISMATCH', 'SIZE_MISMATCH'].includes(error.code);
      if (signal.aborted || error.code === 'ABORT' || !retry || attempt >= 3) throw error;
      await sleep(Math.max([1000, 3000, 8000][attempt] + Math.random() * 500, error.status === 429 ? error.retryAfter : 0), signal);
    }
  }
}
async function checkBatch(batch: Batch): Promise<void> {
  batch.running = true; batch.controller = new AbortController();
  const signal = batch.controller.signal;
  try {
    await Promise.all(batch.jobs.filter((job) => job.valid && !terminal(job.item.status)).map((job) => prepare(async () => {
      if (signal.aborted || terminal(job.item.status)) return;
      if (!job.hash) {
        update(job, { status: 'hashing', message: 'Preparing' });
        try { job.hash = await sha256Hex(job.file); }
        catch { if (!signal.aborted) update(job, { status: 'failed', message: 'Upload failed' }); }
      }
    })));
    if (signal.aborted || !permitted()) return;
    const seen = new Set<string>();
    for (const job of batch.jobs) {
      if (!job.hash) continue;
      if (!terminal(job.item.status)) {
        if (seen.has(job.hash)) { release(job); update(job, { status: 'duplicate', progress: 1, message: 'Already in this batch' }); }
        else update(job, { status: 'checking', message: 'Checking duplicates' });
      }
      seen.add(job.hash);
    }
    const candidates = batch.jobs.filter((job) => job.item.status === 'checking');
    for (let offset = 0; offset < candidates.length; offset += 50) {
      const part = candidates.slice(offset, offset + 50);
      const result = await uploadRequest<{ existing: Record<string, string> }>('/api/upload/check', new Blob([JSON.stringify({ hashes: part.map((job) => job.hash) })]), signal, { 'Content-Type': 'application/json' });
      if (signal.aborted) return;
      for (const job of part) if (result.existing[job.hash] && !terminal(job.item.status)) { release(job); update(job, { status: 'duplicate', progress: 1, message: 'Already in Dump' }); }
    }
    batch.ready = true;
    for (const job of candidates) if (!terminal(job.item.status)) update(job, { status: 'queued', message: 'Queued' });
  } catch (error) {
    if (permitted() && !signal.aborted) for (const job of batch.jobs) if (!terminal(job.item.status)) update(job, { status: 'failed', message: errorMessage(error) });
  } finally { batch.running = false; batch.controller = undefined; pump(); }
}
async function run(job: Job): Promise<void> {
  running++; job.controller = new AbortController();
  const signal = job.controller.signal;
  try {
    update(job, { status: 'preparing', message: 'Preparing image' });
    const thumb: Thumbnail | null = job.item.mime.startsWith('image/') ? await prepare(() => createThumbnail(job.file)) : null;
    if (signal.aborted || !permitted()) return;
    if (thumb) { release(job); job.item.previewUrl = URL.createObjectURL(thumb.blob); job.item.width = thumb.width; job.item.height = thumb.height; }
    update(job, { status: 'uploading', progress: 0, message: 'Uploading' });
    const dimensions: Record<string, string> = thumb ? { 'X-Width': String(thumb.width), 'X-Height': String(thumb.height) } : {};
    const response = await uploadRequest<{ file: FileDTO; duplicate: boolean }>('/api/upload', job.file, signal, { 'Content-Type': job.file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(job.item.name), 'X-Content-Sha256': job.hash, ...dimensions }, (progress) => update(job, { progress }));
    if (response.duplicate) { release(job); update(job, { status: 'duplicate', progress: 1, message: 'Already in Dump' }); return; }
    if (thumb && !signal.aborted && permitted()) {
      update(job, { message: 'Finishing thumbnail', progress: 1 });
      try {
        const result = await uploadRequest<{ thumbSize: number }>(`/api/thumb?id=${response.file.id}`, thumb.blob, signal, { 'Content-Type': 'image/jpeg', ...dimensions });
        response.file.thumbSize = result.thumbSize;
      } catch { /* An accepted original remains successful; backfill handles a missing thumbnail. */ }
    }
    if (authState.peek() === 'in') { acceptUpload(response.file, job.item.previewUrl); job.item.previewUrl = ''; }
    else release(job);
    update(job, { status: 'done', progress: 1, message: 'Added' });
  } catch (error) {
    if (job.item.status === 'cancelled' || job.item.status === 'failed') return;
    if (!permitted() || signal.aborted) update(job, { status: 'waiting', message: navigator.onLine ? 'Sign in to resume' : 'Waiting for connection' });
    else update(job, { status: 'failed', message: errorMessage(error) });
  } finally { job.controller = undefined; running--; pump(); }
}
function pump(): void {
  if (!permitted()) return;
  for (const job of jobs) if (!terminal(job.item.status) && !job.controller) { ensurePreview(job); if (job.item.status === 'waiting') job.item.status = 'queued'; }
  for (const batch of batches) if (!batch.ready && !batch.running && batch.jobs.some((job) => !terminal(job.item.status))) void checkBatch(batch);
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
  const limit = connection?.saveData || ['2g', 'slow-2g'].includes(connection?.effectiveType ?? '') ? 2 : 3;
  for (const batch of batches) if (batch.ready) for (const job of batch.jobs) {
    if (running >= limit) break;
    if (job.item.status === 'queued' && !job.controller) void run(job);
  }
  publish();
}
export function enqueue(files: File[], pasted = false): void {
  if (files.length > 100) { showToast('Select up to 100 files at once.', undefined, true); return; }
  if (!files.length || authState.peek() !== 'in') return;
  clearTimeout(dismiss);
  const batch: Batch = { jobs: [], ready: false, running: false };
  for (const [index, file] of files.entries()) {
    const mime = fileMime(file), message = file.size > 25 * 1024 * 1024 ? 'Too large (max 25 MB)' : !mime ? 'Unsupported type' : '';
    const localId = `local-${++nextId}`;
    const item: LocalFile = { id: localId, localId, name: uploadName(file, index, pasted), mime: mime ?? file.type, size: file.size, width: null, height: null, thumbSize: 0, note: '', pinned: false, tags: [], createdAt: file.lastModified || Date.now(), deletedAt: null, expiresAt: null, status: message ? 'failed' : halted ? 'failed' : 'queued', progress: 0, previewUrl: '', message: message || (halted ? queueMessage.peek() : 'Queued') };
    const job: Job = { item, file, hash: '', valid: !message };
    ensurePreview(job); jobs.push(job); batch.jobs.push(job);
  }
  batches.push(batch); publish();
  if (!navigator.onLine) paused(); else pump();
}
export function retryUpload(localId?: string): void {
  halted = false; queueMessage.value = '';
  for (const batch of batches) for (const job of batch.jobs) if (job.item.status === 'failed' && (!localId || job.item.localId === localId) && job.valid) {
    job.item.status = 'queued'; job.item.progress = 0; job.item.message = 'Queued'; batch.ready = false;
  }
  if (!navigator.onLine) paused(); else pump();
}
export function cancelUpload(localId?: string): void {
  for (const job of jobs) if (!terminal(job.item.status) && (!localId || job.item.localId === localId)) { job.item.status = 'cancelled'; job.item.message = 'Cancelled'; job.controller?.abort(); release(job); }
  if (!localId) for (const batch of batches) batch.controller?.abort();
  publish();
}
export function clearFinished(): void {
  for (let i = jobs.length - 1; i >= 0; i--) if (terminal(jobs[i].item.status)) { release(jobs[i]); jobs.splice(i, 1); }
  for (let i = batches.length - 1; i >= 0; i--) { batches[i].jobs = batches[i].jobs.filter((job) => jobs.includes(job)); if (!batches[i].jobs.length) batches.splice(i, 1); }
  if (!jobs.length) queueMessage.value = '';
  publish();
}
effect(() => { const auth = authState.value; untracked(() => {
  if (auth === 'out') { paused(); for (const job of jobs) release(job); publish(); }
  if (auth === 'in') pump();
}); });
window.addEventListener('offline', paused);
window.addEventListener('online', pump);
window.addEventListener('beforeunload', (event) => { if (busy.peek()) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { foreground.value = !document.hidden; if (!document.hidden) { recoverRequests(); pump(); } });
let wake: WakeLockSentinel | undefined, wakePending = false;
effect(() => {
  const needed = busy.value && foreground.value && authState.value === 'in';
  if (!needed) { void wake?.release(); wake = undefined; }
  else if ('wakeLock' in navigator && !wake && !wakePending) {
    wakePending = true;
    void navigator.wakeLock.request('screen').then((lock) => {
      if (!busy.peek() || document.hidden || authState.peek() !== 'in') void lock.release();
      else { wake = lock; lock.addEventListener('release', () => { if (wake === lock) wake = undefined; }); }
    }).catch(() => {}).finally(() => { wakePending = false; });
  }
});
