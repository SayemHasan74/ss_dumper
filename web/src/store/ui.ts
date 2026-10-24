import { computed, signal } from '@preact/signals';

export interface Filters { type: 'all' | 'image' | 'pdf'; time: 'all' | 'today' | 'week'; pinned: boolean; tag: string; q: string }
const defaults: Filters = { type: 'all', time: 'all', pinned: false, tag: '', q: '' };
export const filters = signal<Filters>({ ...defaults });
export const hasFilters = computed(() => filters.value.type !== 'all' || filters.value.time !== 'all' || filters.value.pinned || !!filters.value.tag || !!filters.value.q);
export const gridMetrics = signal({ cols: 2, cell: 104, rowHeight: 107, gridTop: 0 });
export const pendingNew = signal(0);
export const online = signal(navigator.onLine);
export interface ToastMessage { id: number; message: string; action?: { label: string; run: () => void }; error: boolean }
export const toast = signal<ToastMessage | null>(null);
let toastId = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(message: string, action?: ToastMessage['action'], error = false): void {
  clearTimeout(toastTimer);
  toast.value = { id: ++toastId, message, action, error };
  toastTimer = setTimeout(() => { toast.value = null; }, 5000);
}
export function resetUI(): void {
  filters.value = { ...defaults };
  pendingNew.value = 0;
  gridMetrics.value = { cols: 2, cell: 104, rowHeight: 107, gridTop: 0 };
  clearTimeout(toastTimer);
  toast.value = null;
}
export function updateFilters(value: Partial<Filters>): void { filters.value = { ...filters.peek(), ...value }; }
export function clearFilters(): void { filters.value = { ...defaults }; }
