import type { FileDTO } from '../../../shared/types';

export type Intent = 'run' | 'pause' | 'cancel';
export type Phase = 'pending' | 'hashing' | 'checking' | 'preparing' | 'original' | 'thumbnail' | 'completed' | 'cancelled';
export type Retention = 'saving' | 'retained' | 'unretained' | 'missing' | 'released';
export type Blocker = '' | 'restored' | 'connection' | 'auth' | 'local' | 'missing' | 'retry' | 'daily' | 'server-full' | 'unsupported';
export interface UploadJob {
  id: string; group: string; order: number; rev: number;
  originalName: string; name: string; mime: string; size: number; modified: number;
  created: number; updated: number; submitted: boolean; selected: boolean;
  intent: Intent; phase: Phase; retention: Retention; blocker: Blocker;
  sessionOnly: boolean; hash: string; originalConfirmed: boolean; server?: FileDTO;
  thumbnail: 'needed' | 'stored' | 'confirmed' | 'none'; thumbBytes: number;
  width: number | null; height: number | null;
  uncertain: boolean; thumbUncertain: boolean; duplicate: boolean; canonical?: string;
  attempt: number; nextRetry: number; error: string; cleanup: boolean;
}
export interface Fence { owner: string; generation: number; expires: number }
export const finished = (job: UploadJob): boolean => job.phase === 'completed' || job.intent === 'cancel';
export const needsOriginal = (job: UploadJob): boolean => !job.originalConfirmed || (job.thumbnail === 'needed');
export function recoverJob(job: UploadJob, originalAvailable: boolean, thumbAvailable: boolean): UploadJob {
  const next = { ...job, selected: job.selected ?? true };
  if (finished(job)) return next;
  next.retention = originalAvailable ? 'retained' : job.originalConfirmed ? 'released' : 'missing';
  if (job.thumbnail === 'stored' && !thumbAvailable) next.thumbnail = 'needed';
  if (needsOriginal(next) && !originalAvailable) { next.blocker = 'missing'; next.error = 'Original file needed'; }
  else if (!['daily', 'server-full', 'retry', 'unsupported', 'local'].includes(next.blocker)) next.blocker = 'restored';
  if (['hashing', 'checking', 'preparing', 'original'].includes(job.phase)) next.phase = job.originalConfirmed ? 'thumbnail' : 'pending';
  return next;
}
export function eligible(job: UploadJob, now: number): boolean {
  return job.submitted && job.intent === 'run' && !finished(job) && !job.blocker && job.nextRetry <= now && (job.retention === 'retained' || job.sessionOnly || job.originalConfirmed);
}
export function canonicalFor(job: UploadJob, jobs: UploadJob[]): UploadJob | undefined {
  if (!job.hash) return;
  return jobs.find(other => other.id !== job.id && other.hash === job.hash && other.intent !== 'cancel' && !['retry', 'missing', 'unsupported', 'local', 'server-full'].includes(other.blocker) && (other.originalConfirmed || (other.submitted && other.intent === 'run' && other.order < job.order)));
}
export const dailyReset = (now: number): number => (Math.floor(now / 86400000) + 1) * 86400000;
export function chainLimit(): number {
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse), (hover: none)').matches;
  return touch || connection?.saveData || ['3g', '2g', 'slow-2g'].includes(connection?.effectiveType ?? '') ? 1 : 3;
}
export function retentionLabel(job: UploadJob): string {
  return job.retention === 'retained' ? 'Saved on this device.' : job.retention === 'saving' ? 'Saving on this device… Keep the app open.' : job.retention === 'released' ? (job.thumbnail === 'stored' ? 'Small thumbnail saved on this device.' : 'Local original released.') : job.retention === 'missing' ? 'Original file needed.' : 'Not saved locally. Keep this page open or select this file again later.';
}
export function jobLabel(job: UploadJob): string {
  if (!job.submitted && !finished(job)) return 'Selection awaiting review';
  if (job.intent === 'cancel') return 'Cancelled';
  if (job.phase === 'completed') return job.error || (job.duplicate ? 'Already in Dump' : 'Completed');
  if (job.blocker === 'missing') return 'Original file needed';
  if (job.blocker === 'connection') return 'Waiting for connection';
  if (job.blocker === 'auth') return 'Sign in to resume';
  if (job.blocker === 'daily') return 'Daily limit reached';
  if (job.intent === 'pause' || job.blocker === 'restored') return job.originalConfirmed ? 'Paused — uploaded; thumbnail pending' : 'Paused';
  if (job.originalConfirmed) return 'Uploaded — thumbnail pending';
  if (job.blocker) return 'Failed';
  return ({ pending: 'Queued', hashing: 'Preparing', checking: 'Checking previous upload', preparing: 'Preparing', original: 'Uploading', thumbnail: 'Uploaded — thumbnail pending', completed: 'Completed', cancelled: 'Cancelled' })[job.phase];
}
