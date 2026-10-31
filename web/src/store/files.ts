import { batch, computed, effect, signal, untracked } from '@preact/signals';
import type { FileDTO, SettingsDTO } from '../../../shared/types';
import { authState } from '../auth';
import { api } from '../lib/api';
import { filters, gridMetrics, online, pendingNew, resetUI, showToast } from './ui';
import { matchesFileType } from '../lib/file-type';

interface Page { files: FileDTO[]; nextCursor: string | null }
export const items = signal<FileDTO[]>([]);
export const trashMode = signal(false);
export const fileUpdates = signal<Record<string, FileDTO>>({});
export let dataVersion = 0;
export const nextCursor = signal<string | null>(null);
export const status = signal<'idle' | 'loading' | 'loadingMore' | 'error'>('idle');
export const errorMessage = signal('');
export const loadMoreError = signal('');
export const tags = signal<{ tag: string; count: number }[]>([]);
export const settings = signal<SettingsDTO | null>(null);
export const firstPageLoaded = signal(false);
export type UploadStatus = 'queued' | 'hashing' | 'checking' | 'preparing' | 'uploading' | 'waiting' | 'failed' | 'done' | 'duplicate' | 'cancelled';
export interface LocalFile extends FileDTO { localId: string; status: UploadStatus; progress: number; previewUrl: string; message: string }
export const localItems = signal<LocalFile[]>([]);
export const galleryItems = computed<(FileDTO | LocalFile)[]>(() => [...(trashMode.value ? [] : localItems.value.filter(file=>matchesFileType(file.mime,filters.value.type))), ...items.value]);
export const previewById = signal<Record<string, string>>({});
export function clearPreviews(): void {
  for (const url of Object.values(previewById.peek())) URL.revokeObjectURL(url);
  previewById.value = {};
}
export function acceptUpload(file: FileDTO, preview = ''): void {
  if (preview) {
    const previous = previewById.peek()[file.id];
    if (previous && previous !== preview) URL.revokeObjectURL(previous);
    previewById.value = { ...previewById.peek(), [file.id]: preview };
  }
  if (trashMode.peek() || !matchesFileType(file.mime,filters.peek().type)) return;
  items.value = [file, ...items.peek().filter((item) => item.id !== file.id)].sort((a, b) => b.id.localeCompare(a.id));
  if (pending) {
    pending.files = [file, ...pending.files.filter((item) => item.id !== file.id)].sort((a, b) => b.id.localeCompare(a.id));
    pendingNew.value = pending.files.filter((item) => !items.peek().some((known) => known.id === item.id)).length;
  }
}
export function updateThumbnail(id: string, thumbSize: number, width: number, height: number): void {
  const update = (file: FileDTO) => file.id === id ? { ...file, thumbSize, width, height } : file;
  items.value = items.peek().map(update);
  if (pending) pending.files = pending.files.map(update);
}
let controller: AbortController | undefined;
let token = 0;
let authVersion = 0;
let lastRefresh = -Infinity;
let pending: Page | null = null;

export function listQuery(limit: number, cursor?: string): string {
  const f = filters.peek();
  const search = new URLSearchParams({ limit: String(limit) });
  if (trashMode.peek()) { search.set('trash', '1'); if (cursor) search.set('cursor', cursor); return `/api/files?${search}`; }
  if (cursor) search.set('cursor', cursor);
  if (f.type !== 'all') search.set('type', f.type);
  if (f.pinned) search.set('pinned', '1');
  if (f.tag) search.set('tag', f.tag);
  if (f.q) search.set('q', f.q);
  if (f.time !== 'all') {
    const since = new Date();
    if (f.time === 'today') since.setHours(0, 0, 0, 0);
    else since.setTime(since.getTime() - 7 * 86400000);
    search.set('since', String(since.getTime()));
  }
  return `/api/files?${search}`;
}
function message(): string { return online.peek() ? "Couldn't load files." : "You're offline"; }
export async function loadFirstPage(): Promise<void> {
  controller?.abort();
  controller = new AbortController();
  const request = ++token;
  pending = null;
  batch(() => { items.value = []; nextCursor.value = null; pendingNew.value = 0; status.value = 'loading'; errorMessage.value = ''; loadMoreError.value = ''; firstPageLoaded.value = false; });
  try {
    const page = await api<Page>(listQuery(48), { signal: controller.signal });
    if (request !== token) return;
    const fetched = new Set(page.files.map((file) => file.id));
    const acceptedWhileLoading = items.peek().filter((file) => !fetched.has(file.id));
    batch(() => { items.value = [...acceptedWhileLoading, ...page.files].sort((a, b) => b.id.localeCompare(a.id)); nextCursor.value = page.nextCursor; status.value = 'idle'; firstPageLoaded.value = true; });
  } catch {
    if (request === token) { errorMessage.value = message(); status.value = 'error'; }
  }
}
export async function loadMore(retry = false): Promise<void> {
  if (!nextCursor.peek() || status.peek() === 'loading' || status.peek() === 'loadingMore' || (loadMoreError.peek() && !retry)) return;
  controller?.abort();
  controller = new AbortController();
  const request = ++token;
  status.value = 'loadingMore';
  loadMoreError.value = '';
  try {
    const page = await api<Page>(listQuery(60, nextCursor.peek()!), { signal: controller.signal });
    if (request !== token) return;
    const known = new Set(items.peek().map((file) => file.id));
    batch(() => { items.value = [...items.peek(), ...page.files.filter((file) => !known.has(file.id))]; nextCursor.value = page.nextCursor; status.value = 'idle'; });
  } catch {
    if (request === token) { loadMoreError.value = "Couldn't load more"; status.value = 'idle'; }
  }
}
function applyMerge(page: Page): void {
  const minimum = page.files.at(-1)?.id;
  const older = minimum ? items.peek().filter((file) => file.id < minimum) : [];
  batch(() => {
    items.value = [...page.files, ...older];
    if (!older.length) nextCursor.value = page.nextCursor;
    pendingNew.value = 0;
  });
  pending = null;
}
export function showPending(): void {
  if (pending) applyMerge(pending);
  window.scrollTo({ top: 0, behavior: 'instant' });
}
export async function loadTags(): Promise<void> {
  const version = authVersion;
  try {
    const result = await api<{ tags: { tag: string; count: number }[] }>('/api/tags');
    if (version === authVersion && authState.peek() === 'in') tags.value = result.tags;
  } catch { if (version === authVersion && authState.peek() === 'in') showToast("Couldn't load tags.", undefined, true); }
}
async function loadSettings(): Promise<void> {
  const version = authVersion;
  try {
    const result = await api<SettingsDTO>('/api/settings');
    if (version === authVersion && authState.peek() === 'in') settings.value = { autoExpireDays: result.autoExpireDays, trashDays: result.trashDays };
  } catch { if (version === authVersion && authState.peek() === 'in') showToast("Couldn't load settings.", undefined, true); }
}
export async function refresh(): Promise<void> {
  if (authState.peek() !== 'in' || Date.now() - lastRefresh < 5000 || status.peek() === 'loading' || status.peek() === 'loadingMore') return;
  lastRefresh = Date.now();
  controller?.abort();
  controller = new AbortController();
  const request = ++token;
  status.value = 'loading';
  void loadTags();
  try {
    const page = await api<Page>(listQuery(48), { signal: controller.signal });
    if (request !== token) return;
    const known = new Set(items.peek().map((file) => file.id));
    const added = page.files.filter((file) => !known.has(file.id)).length;
    const metrics = gridMetrics.peek();
    if (added && scrollY > metrics.gridTop + 2 * metrics.rowHeight) { pending = page; pendingNew.value = added; }
    else applyMerge(page);
    status.value = 'idle';
    firstPageLoaded.value = true;
    loadMoreError.value = '';
  } catch {
    if (request === token) {
      if (!items.peek().length) { errorMessage.value = message(); status.value = 'error'; }
      else { status.value = 'idle'; showToast(message(), undefined, true); }
    }
  }
}
function clear(): void {
  dataVersion++; fileUpdates.value = {};
  controller?.abort(); token += 1; authVersion += 1; pending = null; lastRefresh = -Infinity;
  batch(() => { items.value = []; localItems.value = []; clearPreviews(); nextCursor.value = null; status.value = 'idle'; errorMessage.value = ''; loadMoreError.value = ''; tags.value = []; settings.value = null; firstPageLoaded.value = false; resetUI(); });
}
effect(() => {
  const auth = authState.value;
  untracked(() => {
    if (auth === 'out') clear();
    if (auth === 'in') { void loadFirstPage(); void loadTags(); void loadSettings(); }
  });
});
window.addEventListener('focus', () => { void refresh(); });
window.addEventListener('online', () => { online.value = true; void refresh(); });
window.addEventListener('offline', () => { online.value = false; });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
