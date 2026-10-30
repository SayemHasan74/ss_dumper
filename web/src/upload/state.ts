import { computed, signal } from '@preact/signals';
import type { LocalFile } from '../store/files';
import { finished, type UploadJob } from './model';

export const records = signal<UploadJob[]>([]);
export const uploads = signal<LocalFile[]>([]);
export const busy = signal(false);
export const foreground = signal(!document.hidden);
export const queueMessage = signal('');
export const queueReady = signal(false), otherRunner = signal(false), enabled = signal(false);
export const progress = signal<Record<string, number>>({});
export const pendingCount = computed(() => records.value.filter(job => !finished(job)).length);
export const storageStatus = signal<'unknown' | 'granted' | 'denied' | 'unavailable'>('unknown');
export const storageEstimate = signal<{ usage?: number; quota?: number }>({});
export const reviewCount = computed(() => records.value.filter(job => !job.submitted && !finished(job)).length);
export const thumbnailOwners = computed(() => new Set(records.value.filter(job => !finished(job) && job.originalConfirmed && job.thumbnail !== 'confirmed').map(job => job.server?.id).filter((id): id is string => !!id)));
