import { signal } from '@preact/signals';
import type { FileDTO } from '../../../shared/types';
import { authState } from '../auth';
import { api, ApiError } from '../lib/api';
import { dataVersion, fileUpdates, items, loadFirstPage, loadTags, settings, trashMode } from './files';
import { clearSelection, updateSelectionFiles } from './selection';
import { showToast } from './ui';

export const actionBusy = signal(false);
export const quotaNotice = 'Daily limit reached. The rest will be cleaned up automatically tomorrow.';
type Action = 'trash' | 'restore' | 'purge' | 'pin' | 'unpin' | 'tag_add' | 'tag_remove';
export function normalizeTag(value: string): string { return value.trim().toLowerCase().replace(/[ _]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); }
export async function bulkAction(action: Action, files: FileDTO[], tag?: string): Promise<boolean> {
  if (actionBusy.peek() || !files.length) return false;
  actionBusy.value = true;
  const mode = trashMode.peek(), backups = new Map(files.map((file) => [file.id, file]));
  const version = dataVersion;
  const loadedIds = new Set(items.peek().map((file) => file.id));
  const destructive = ['trash', 'restore', 'purge'].includes(action);
  const ids = new Set(backups.keys()), completed = new Set<string>();
  const optimistic = (file: FileDTO): FileDTO => {
    if (!ids.has(file.id)) return file;
    if (action === 'pin' || action === 'unpin') return { ...file, pinned: action === 'pin', expiresAt: action === 'pin' || !settings.peek()?.autoExpireDays ? null : file.createdAt + settings.peek()!.autoExpireDays * 86400000 };
    return { ...file, tags: action === 'tag_add' ? [...new Set([...file.tags, tag!])].slice(0, 5).sort() : file.tags.filter((value) => value !== tag) };
  };
  items.value = action === 'restore' && !mode ? [...items.peek().filter((file) => !ids.has(file.id)), ...files.map((file) => ({ ...file, deletedAt: null, expiresAt: file.pinned || !settings.peek()?.autoExpireDays ? null : file.createdAt + settings.peek()!.autoExpireDays * 86400000 }))].sort((a, b) => b.id.localeCompare(a.id)) : destructive ? items.peek().filter((file) => !ids.has(file.id)) : items.peek().map(optimistic);
  if (!destructive) updateSelectionFiles(files.map(optimistic));
  if (!destructive) fileUpdates.value = { ...fileUpdates.peek(), ...Object.fromEntries(files.filter((file) => !loadedIds.has(file.id)).map((file) => [file.id, optimistic(file)])) };
  let affected = 0;
  const chunks = [...ids], size = action === 'purge' ? 100 : 200;
  try {
    for (let start = 0; start < chunks.length; start += size) {
      const part = chunks.slice(start, start + size);
      try {
        const result = await api<{ affected: number }>('/api/files/bulk', { method: 'POST', json: { action, ids: part, ...(tag ? { tag } : {}) } });
        if (version !== dataVersion || authState.peek() !== 'in') return false;
        affected += result.affected; part.forEach((id) => completed.add(id));
      } catch (error) {
        if (action === 'purge' && error instanceof ApiError && error.code === 'DAILY_LIMIT') part.forEach((id) => completed.add(id));
        throw error;
      }
    }
    if (destructive) clearSelection();
    const skipped = files.length - affected;
    if (action === 'trash') showToast(`Moved ${affected} to Trash${skipped ? ` · ${skipped} skipped` : ''}`, { label: 'Undo', run: () => { void bulkAction('restore', files); } }, false, 6000);
    else if (action === 'restore') showToast(`${affected} restored${skipped ? ` · ${skipped} skipped (already exists)` : ''}`);
    else if (skipped) showToast(`${skipped} skipped${action === 'tag_add' ? ' (5-tag limit)' : ''}`);
    if (destructive && mode === trashMode.peek() && authState.peek() === 'in') void loadFirstPage();
    void loadTags();
    return true;
  } catch (error) {
    if (version !== dataVersion || authState.peek() !== 'in') return false;
    if (version === dataVersion && authState.peek() === 'in' && mode === trashMode.peek()) {
      const restore = [...backups.values()].filter((file) => !completed.has(file.id));
      const rollbackIds = new Set(restore.map((file) => file.id));
      items.value = [...items.peek().filter((file) => !rollbackIds.has(file.id)), ...restore.filter((file) => loadedIds.has(file.id))].sort((a, b) => b.id.localeCompare(a.id));
      updateSelectionFiles(restore);
      fileUpdates.value = { ...fileUpdates.peek(), ...Object.fromEntries(restore.filter((file) => !loadedIds.has(file.id)).map((file) => [file.id, file])) };
    }
    if (error instanceof ApiError && error.code === 'DAILY_LIMIT') { clearSelection(); showToast(quotaNotice, undefined, true); }
    else showToast(`Couldn't ${action.replace('_', ' ')}. Try again.`, undefined, true);
    return false;
  } finally { actionBusy.value = false; }
}
export async function editFile(file: FileDTO, changes: { name: string; note: string; tags: string[] }): Promise<boolean> {
  const version = dataVersion, mode = trashMode.peek();
  const old = items.peek().find((item) => item.id === file.id);
  fileUpdates.value = { ...fileUpdates.peek(), [file.id]: { ...file, ...changes } };
  items.value = items.peek().map((item) => item.id === file.id ? { ...item, ...changes } : item);
  try {
    const result = await api<{ file: FileDTO }>(`/api/files/${file.id}`, { method: 'PATCH', json: changes });
    if (version !== dataVersion || authState.peek() !== 'in') return false;
    fileUpdates.value = { ...fileUpdates.peek(), [file.id]: result.file };
    if (mode !== trashMode.peek()) return true;
    items.value = items.peek().map((item) => item.id === file.id ? result.file : item); void loadTags(); return true;
  } catch { if (version === dataVersion && authState.peek() === 'in') { fileUpdates.value = { ...fileUpdates.peek(), [file.id]: file }; if (old && mode === trashMode.peek()) items.value = items.peek().map((item) => item.id === file.id ? old : item); } showToast("Couldn't edit. Try again.", undefined, true); return false; }
}
export async function emptyTrash(): Promise<void> {
  if (actionBusy.peek()) return;
  actionBusy.value = true; let total = 0;
  const version = dataVersion, mode = trashMode.peek();
  const previous = items.peek(); items.value = [];
  try {
    let remaining: number;
    do { const result = await api<{ purged: number; remaining: number }>('/api/trash/empty', { method: 'POST' }); if (version !== dataVersion || authState.peek() !== 'in') return; total += result.purged; remaining = result.remaining; showToast(`Deleted ${total} forever`); } while (remaining > 0);
    clearSelection();
  } catch (error) {
    if (version !== dataVersion || authState.peek() !== 'in') return;
    if (error instanceof ApiError && error.code === 'DAILY_LIMIT') { clearSelection(); if (mode === trashMode.peek()) await loadFirstPage(); showToast(quotaNotice, undefined, true); }
    else { if (mode === trashMode.peek()) { if (!total) items.value = previous; else await loadFirstPage(); } showToast("Couldn't empty Trash. Try again.", undefined, true); }
  } finally { actionBusy.value = false; }
}
