import type { FileDTO } from '../../../shared/types';
import { showToast } from '../store/ui';
import { originalBlob } from './clipboard';

export function downloadBlob(blob: Blob, name: string): void { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export async function downloadFiles(files: FileDTO[]): Promise<void> {
  if (!files.length) return;
  if (files.length === 1) { const anchor = document.createElement('a'); anchor.href = `/api/files/${files[0].id}/original?download=1`; anchor.download = files[0].name; anchor.click(); return; }
  if (files.reduce((sum, file) => sum + file.size, 0) > 300 * 1024 * 1024) { showToast('Download is limited to 300 MB.', undefined, true); return; }
  try {
    const { Zip, ZipPassThrough } = await import('fflate');
    const chunks: Uint8Array<ArrayBuffer>[] = [], names = new Set<string>();
    const done = new Promise<Blob>((resolve, reject) => {
      const zip = new Zip((error, chunk, final) => { if (error) reject(error); else { chunks.push(new Uint8Array(chunk)); if (final) resolve(new Blob(chunks, { type: 'application/zip' })); } });
      void (async () => {
        for (const [index, file] of files.entries()) {
          showToast(`Zipping ${index + 1} of ${files.length}`, undefined, false, 0);
          let name = file.name, suffix = 1; const dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
          while (names.has(name)) name = `${base} (${++suffix})${ext}`;
          names.add(name);
          const entry = new ZipPassThrough(name); zip.add(entry); entry.push(new Uint8Array(await (await originalBlob(file)).arrayBuffer()), true);
        }
        zip.end();
      })().catch(reject);
    });
    const date = new Date(), pad = (n: number) => String(n).padStart(2, '0');
    downloadBlob(await done, `dump-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.zip`); showToast('Download ready.');
  } catch { showToast("Couldn't download. Try again.", undefined, true); }
}
