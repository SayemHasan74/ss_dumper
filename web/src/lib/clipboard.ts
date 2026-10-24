import { signal, effect } from '@preact/signals';
import type { FileDTO } from '../../../shared/types';
import { authState } from '../auth';
import { showToast } from '../store/ui';
import { chronological, planSheets, renderSheet, sheetWidth, type Sheet } from './stitch';

export const eligible = (file: FileDTO): boolean => /^image\/(png|jpeg|gif|webp)$/.test(file.mime);
export async function originalBlob(file: FileDTO, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(`/api/files/${file.id}/original`, { credentials: 'same-origin', signal });
  if (response.status === 401) authState.value = 'out';
  if (!response.ok) { await response.body?.cancel(); throw new Error('File unavailable'); }
  return response.blob();
}
export async function pngBlob(file: FileDTO, signal?: AbortSignal): Promise<Blob> {
  const blob = await originalBlob(file, signal);
  if (file.mime === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try { return await renderSheet({ width: bitmap.width, height: bitmap.height, indices: [0], placements: [{ index: 0, x: 0, y: 0, w: bitmap.width, h: bitmap.height }] }, async () => bitmap); }
  finally { bitmap.close(); }
}
export function copyImage(source: FileDTO | Promise<Blob>): Promise<boolean> {
  const png = source instanceof Promise ? source : pngBlob(source);
  void png.catch(() => {});
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) { showToast("Copy isn't available here. Use Download.", undefined, true); return Promise.resolve(false); }
  try { return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(() => true).catch(() => { showToast("Copy isn't available here. Use Download.", undefined, true); return false; }); }
  catch { showToast("Copy isn't available here. Use Download.", undefined, true); return Promise.resolve(false); }
}
export type CopyMode = 'one' | 'sheet';
interface CopyState { files: FileDTO[]; mode: CopyMode; index: number; copied: number; entries: number; imagesInSheet: number[]; busy: boolean; skippedPdfs: boolean }
export const copyQueue = signal<CopyState | null>(null);
let controller: AbortController | undefined, generation = 0;
let entries: Promise<Sheet[] | null> = Promise.resolve(null);
const cache = new Map<number, Promise<Blob>>();
export function closeCopy(): void { generation++; controller?.abort(); cache.clear(); copyQueue.value = null; }
function rememberedMode(): CopyMode { try { return localStorage.getItem('dump.copyMode') === 'sheet' ? 'sheet' : 'one'; } catch { return 'one'; } }
function entryBlob(index: number, state: CopyState): Promise<Blob> {
  const found = cache.get(index); if (found) return found;
  const signal = controller!.signal;
  const prepared = state.mode === 'one' ? pngBlob(state.files[index], signal) : entries.then(async (sheets) => {
    const sheet = sheets![index];
    return renderSheet(sheet, async (i) => createImageBitmap(await originalBlob(state.files[i], signal)));
  });
  const promise = prepared.then((blob) => { if (signal.aborted) throw new DOMException('Copy cancelled', 'AbortError'); return blob; });
  cache.set(index, promise); while (cache.size > 2) cache.delete(cache.keys().next().value!);
  void promise.catch(() => { if (cache.get(index) === promise) cache.delete(index); });
  return promise;
}
export function nextCopy(skip = false): void {
  const state = copyQueue.peek(); if (!state || state.busy) return;
  const token = generation;
  if (skip) { cache.delete(state.index); advance(state, false); return; }
  copyQueue.value = { ...state, busy: true };
  const promise = entryBlob(state.index, state); cache.delete(state.index);
  void copyImage(promise).then((success) => { if (token !== generation) return; if (success) advance(state, true); else copyQueue.value = { ...state, busy: false }; });
}
function advance(state: CopyState, copied: boolean): void {
  const next = { ...copyQueue.peek()!, index: state.index + 1, copied: state.copied + Number(copied), busy: false };
  if (next.index >= next.entries) { showToast(next.skippedPdfs ? `Copied ${state.files.length} images (PDFs skipped)` : 'All copied. Paste it into your chat.'); closeCopy(); return; }
  copyQueue.value = next;
  void entryBlob(next.index, next).catch(() => {});
}
export function startCopy(files: FileDTO[], mode = rememberedMode()): void {
  const images = chronological(files.filter(eligible));
  if (!images.length) { showToast("PDFs can't be copied. Use Download."); return; }
  if (images.length === 1) { void copyImage(pngBlob(images[0])).then((ok) => { if (ok) showToast(files.length > 1 ? 'Copied 1 images (PDFs skipped)' : 'Copied. Paste it into your chat.'); }); return; }
  closeCopy(); controller = new AbortController(); const token = generation, signal = controller.signal;
  const state: CopyState = { files: images, mode, index: 0, copied: 0, entries: mode === 'one' ? images.length : 1, imagesInSheet: [], busy: false, skippedPdfs: images.length !== files.length };
  copyQueue.value = state;
  entries = mode === 'one' ? Promise.resolve(null) : (async () => {
    const dims = [];
    for (const file of images) {
      if (file.width && file.height) dims.push({ w: file.width, h: file.height });
      else { const bitmap = await createImageBitmap(await originalBlob(file, signal)); try { dims.push({ w: bitmap.width, h: bitmap.height }); } finally { bitmap.close(); } }
    }
    const sheets = planSheets(dims, sheetWidth(images.map((file) => file.width)));
    if (token === generation && copyQueue.peek()) copyQueue.value = { ...copyQueue.peek()!, entries: sheets.length, imagesInSheet: sheets.map((sheet) => sheet.indices.length) };
    return sheets;
  })();
  void entries.catch(() => {});
  nextCopy();
}
export function switchCopyMode(mode: CopyMode): void { const state = copyQueue.peek(); if (!state) return; try { localStorage.setItem('dump.copyMode', mode); } catch {} startCopy(state.files, mode); if (copyQueue.peek()) copyQueue.value = { ...copyQueue.peek()!, skippedPdfs: state.skippedPdfs }; }
effect(() => { if (authState.value === 'out') closeCopy(); });
