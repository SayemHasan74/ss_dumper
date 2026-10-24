import type { FileDTO } from '../../../shared/types';
import { originalBlob } from './clipboard';
import { showToast } from '../store/ui';

export async function shareableFiles(files: FileDTO[]): Promise<File[] | null> {
  if (!navigator.canShare || !navigator.share || !files.length || files.length > 10) return null;
  try { const actual: File[] = []; for (const file of files) actual.push(new File([await originalBlob(file)], file.name, { type: file.mime })); return navigator.canShare({ files: actual }) ? actual : null; } catch { return null; }
}
export function shareFiles(files: File[]): void { void navigator.share({ files }).catch((error: unknown) => { if (!(error instanceof DOMException && error.name === 'AbortError')) showToast("Couldn't share. Try again.", undefined, true); }); }
