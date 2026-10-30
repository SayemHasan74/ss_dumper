import { effect, untracked } from '@preact/signals';
import { authState } from '../auth';
import { firstPageLoaded, items, updateThumbnail, trashMode } from '../store/files';
import { online } from '../store/ui';
import { busy, foreground, prepare, pendingCount, backgroundUpload } from './queue';
import { createThumbnail } from './thumb';
import { UploadError, xhr } from './xhr';
import type { FileDTO } from '../../../shared/types';

const attempts = new Map<string, number>();
let stopped = false, running = false, version = 0;
let controller: AbortController | undefined;
let cancelIdle: (() => void) | undefined;
const allowed = () => authState.peek() === 'in' && !trashMode.peek() && firstPageLoaded.peek() && !pendingCount.peek() && !busy.peek() && !document.hidden && navigator.onLine && !stopped;
function schedule(): void {
  cancelIdle?.(); cancelIdle = undefined;
  if (!allowed()) { controller?.abort(); return; }
  if (running) return;
  const file = items.peek().find((file) => file.mime.startsWith('image/') && !file.thumbSize && file.size <= 15 * 1024 * 1024 && (attempts.get(file.id) ?? 0) < 2);
  if (!file) return;
  const run = async () => {
    cancelIdle = undefined;
    if (!allowed()) return;
    running = true; controller = new AbortController();
    const signal = controller.signal, session = version;
    let attempted = false;
    try { await backgroundUpload(async verify => {
      await verify();attempted = true;attempts.set(file.id, (attempts.get(file.id) ?? 0) + 1);
      const metadata = await xhr<{file:FileDTO}>(`/api/files/${file.id}`,null,{method:'GET',signal,timeout:8000});
      if (metadata.file.thumbSize) { updateThumbnail(file.id,metadata.file.thumbSize,metadata.file.width??0,metadata.file.height??0);return; }
      const response = await fetch(`/api/files/${file.id}/original`, { credentials: 'same-origin', signal });
      if (response.status === 401) { authState.value = 'out'; return; }
      if (!response.ok) { await response.body?.cancel(); return; }
      const blob = await response.blob();
      if (signal.aborted || !allowed()) return;
      const thumb = await prepare(() => createThumbnail(blob));
      if (!thumb || signal.aborted || !allowed()) return;
      await verify();
      const result = await xhr<{ thumbSize: number }>(`/api/thumb?id=${file.id}`, thumb.blob, { signal, headers: { 'Content-Type': 'image/jpeg', 'X-Width': String(thumb.width), 'X-Height': String(thumb.height) } });
      if (!signal.aborted && session === version) updateThumbnail(file.id, result.thumbSize, thumb.width, thumb.height);
    });
    } catch (error) {
      if (session === version && error instanceof UploadError) {
        if (error.status === 401) authState.value = 'out';
        if (error.code === 'DAILY_LIMIT') stopped = true;
      }
    } finally {
      if (attempted && signal.aborted && session === version) attempts.set(file.id, Math.max(0, (attempts.get(file.id) ?? 1) - 1));
      controller = undefined; running = false;
      if (!attempted) { const timer=setTimeout(schedule,3000);cancelIdle=()=>clearTimeout(timer); } else schedule();
    }
  };
  if ('requestIdleCallback' in window) { const id = requestIdleCallback(() => { void run(); }); cancelIdle = () => cancelIdleCallback(id); }
  else { const id = setTimeout(() => { void run(); }, 250); cancelIdle = () => clearTimeout(id); }
}
effect(() => {
  const auth = authState.value;
  void items.value; void busy.value; void pendingCount.value; void online.value; void foreground.value; void firstPageLoaded.value; void trashMode.value;
  untracked(() => { if (auth === 'out') { version++; attempts.clear(); stopped = false; } schedule(); });
});
