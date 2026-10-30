import { effect, untracked } from '@preact/signals';
import { authState } from '../auth';
import { showToast } from '../store/ui';
import { navigate } from '../lib/router';
import { records, uploads, busy, queueMessage, foreground, pendingCount, reviewCount, queueReady, enabled, otherRunner, storageStatus, storageEstimate, thumbnailOwners, progress } from './state';
import { finished } from './model';
import { xhr } from './xhr';
export { records, uploads, busy, queueMessage, foreground, pendingCount, reviewCount, queueReady, enabled, otherRunner, storageStatus, storageEstimate, thumbnailOwners, progress };
export { prepare } from './work';
export type { UploadJob } from './model';
let module: Promise<typeof import('./runner')> | undefined;
const intake: { files: File[]; pasted: boolean }[] = [];
export function engine() { return module ??= import('./runner').catch(error => { module = undefined; throw error; }); }
async function flush(): Promise<void> {
  try {
    const runner = await engine(); await runner.initialize();
    while (intake.length && authState.peek() === 'in') { const selection = intake.shift()!; await runner.enqueue(selection.files, selection.pasted); }
  } catch { queueMessage.value = 'Could not open upload recovery. Keep this page open and retry Uploads.'; }
}
export function enqueue(files: File[], pasted = false): void {
  if (!files.length || authState.peek() !== 'in') return;
  intake.push({ files, pasted });
  // Warm recovery controls while selected files are being retained, before a drop in connectivity.
  void import('../views/Uploads').catch(()=>{});
  void requestPersistence();
  if (files.length > 100) navigate('/uploads');
  void flush();
}
export const pauseUpload = (id?: string) => engine().then(runner => runner.pause(id));
export const retryUpload = (id?: string) => engine().then(runner => runner.resume(id, true));
export const resumeUpload = (id?: string) => engine().then(runner => runner.resume(id));
export const cancelUpload = (id?: string) => engine().then(runner => runner.cancel(id));
export const clearFinished = () => engine().then(runner => runner.clearCompleted());
export const backgroundUpload = (work: (verify:()=>Promise<void>) => Promise<void>) => engine().then(runner => runner.background(work));
export async function beforeSignOut(): Promise<boolean> {
  if (intake.length) { showToast('Some selected files are still opening. Keep this page open until retention is checked.', undefined, true); return false; }
  const runner = await engine(); await runner.initialize();
  if (records.peek().some(job => job.retention === 'saving')) { showToast('Files are still saving on this device. Wait for retention to finish before signing out.', undefined, true); return false; }
  if (!records.peek().some(job => !finished(job))) return true;
  const choice = await import('./signout').then(module => module.chooseLocalSignOut());
  if (choice === 'cancel') return false;
  if (choice === 'delete') await runner.removePending();
  return true;
}
let asked = false;
export async function inspectStorage(): Promise<void> {
  try {
    storageStatus.value = navigator.storage?.persisted ? await navigator.storage.persisted() ? 'granted' : 'denied' : 'unavailable';
    storageEstimate.value = await navigator.storage?.estimate?.() ?? {};
  } catch { storageStatus.value = 'unavailable'; }
}
export async function requestPersistence(manual = false): Promise<void> {
  if (asked && !manual) return;
  asked = true;
  try { storageStatus.value = navigator.storage?.persist ? await navigator.storage.persist() ? 'granted' : 'denied' : 'unavailable'; }
  catch { storageStatus.value = 'unavailable'; }
  void inspectStorage();
}
// Backfill retains its bounded retry API; original uploads use reconciliation in runner.ts.
export async function uploadRequest<T>(path: string, blob: Blob, signal: AbortSignal, headers: Record<string, string>, progress?: (value: number) => void): Promise<T> {
  return xhr<T>(path, blob, { signal, headers, progress });
}
effect(() => { const auth = authState.value; untracked(() => {
  if (auth === 'in') { void flush(); void inspectStorage(); }
  if (auth === 'out') { intake.length = 0; void module?.then(runner => runner.signedOut()); }
}); });
window.addEventListener('beforeunload', event => {
  if (intake.length || records.peek().some(job => !finished(job) && job.retention !== 'retained' && !job.originalConfirmed)) { event.preventDefault(); event.returnValue = ''; }
});
