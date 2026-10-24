import { computed, effect, signal } from '@preact/signals';
import type { FileDTO } from '../../../shared/types';
import { authState } from '../auth';
import { api } from '../lib/api';
import { items, listQuery, nextCursor } from './files';
import { filters, showToast } from './ui';

export const selectedIds = signal<Set<string>>(new Set());
export const selectMode = signal(false);
export const selecting = signal('');
const snapshots = signal<Map<string, FileDTO>>(new Map());
let anchor = '', generation = 0;
export const selectedFiles = computed(() => [...selectedIds.value].map((id) => items.value.find((file) => file.id === id) ?? snapshots.value.get(id)).filter((file): file is FileDTO => !!file));
export function clearSelection(): void { generation++; selectedIds.value = new Set(); snapshots.value = new Map(); selectMode.value = false; selecting.value = ''; anchor = ''; }
export function setSelection(files: FileDTO[]): void { snapshots.value = new Map(files.map((file) => [file.id, file])); selectedIds.value = new Set(files.map((file) => file.id)); selectMode.value = true; }
export function updateSelectionFiles(files: FileDTO[]): void { const next = new Map(snapshots.peek()); for (const file of files) if (next.has(file.id)) next.set(file.id, file); snapshots.value = next; }
export function toggleSelection(file: FileDTO, range = false): void {
  const selected = new Set(selectedIds.peek());
  const list = items.peek(), start = list.findIndex((item) => item.id === anchor), end = list.findIndex((item) => item.id === file.id);
  const touched = range && start >= 0 && end >= 0 ? list.slice(Math.min(start, end), Math.max(start, end) + 1) : [file];
  for (const item of touched) { if (range || !selected.has(item.id)) selected.add(item.id); else selected.delete(item.id); }
  snapshots.value = new Map([...snapshots.peek(), ...touched.map((item): [string, FileDTO] => [item.id, item])]);
  anchor = file.id; selectedIds.value = selected; selectMode.value = true;
}
export async function selectMatching(option: string): Promise<void> {
  if (option !== 'matching') {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    setSelection(items.peek().filter((file) => option === 'loaded' || option === 'today' && file.createdAt >= midnight.getTime() || option === 'week' && file.createdAt >= Date.now() - 7 * 86400000 || option === 'images' && file.mime.startsWith('image/')));
    if (nextCursor.peek()) showToast('Selected from loaded files only.');
    return;
  }
  const token = ++generation;
  const files: FileDTO[] = []; let cursor: string | null = null;
  try {
    do {
      const page: { files: FileDTO[]; nextCursor: string | null } = await api(listQuery(200, cursor ?? undefined));
      if (token !== generation) return;
      files.push(...page.files); cursor = page.nextCursor; selecting.value = `Selecting… ${Math.min(files.length, 2000)}`;
    } while (cursor && files.length < 2000);
    setSelection(files.slice(0, 2000)); selecting.value = '';
    if (cursor) showToast('Selection capped at 2,000 files.');
  } catch { if (token === generation) { selecting.value = ''; showToast("Couldn't select files. Try again.", undefined, true); } }
}
effect(() => { void filters.value; clearSelection(); });
effect(() => { if (authState.value === 'out') clearSelection(); });
