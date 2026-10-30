import type { Fence, UploadJob } from './model';

const stores = ['jobs', 'originals', 'thumbnails', 'settings'] as const;
type Store = typeof stores[number];
export class LocalStoreError extends Error {
  constructor(public readonly kind: 'unavailable' | 'quota' | 'blocked' | 'changed' | 'ownership' | 'missing', message: string) { super(message); }
}
function failure(error: unknown): LocalStoreError {
  if (error instanceof LocalStoreError) return error;
  return new LocalStoreError(error instanceof DOMException && error.name === 'QuotaExceededError' ? 'quota' : 'unavailable', 'Local upload storage could not complete. Keep this page open.');
}
let opening: Promise<IDBDatabase> | undefined;
export function openUploads(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new LocalStoreError('unavailable', 'Local storage is unavailable.')); return; }
    const request = indexedDB.open('dump-uploads', 1);
    let rejected = false;
    const timer = setTimeout(() => { rejected = true; reject(new LocalStoreError('blocked', 'Close other Dump tabs to open local upload storage.')); }, 8000);
    request.onupgradeneeded = () => {
      const db = request.result;
      const jobs = db.createObjectStore('jobs', { keyPath: 'id' }); jobs.createIndex('order', 'order');
      db.createObjectStore('originals'); db.createObjectStore('thumbnails'); db.createObjectStore('settings');
    };
    request.onblocked = () => { rejected = true; clearTimeout(timer); reject(new LocalStoreError('blocked', 'Close other Dump tabs to upgrade local upload storage.')); };
    request.onerror = () => { clearTimeout(timer); reject(failure(request.error)); };
    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      if (rejected) { db.close(); return; }
      db.onversionchange = () => { db.close(); opening = undefined; };
      db.onclose = () => { opening = undefined; };
      resolve(db);
    };
  }).catch(error => { opening = undefined; throw failure(error); });
  return opening;
}
function transaction(db: IDBDatabase, names: Store[], mode: IDBTransactionMode): IDBTransaction {
  if (mode === 'readwrite') { try { return db.transaction(names, mode, { durability: 'strict' }); } catch { /* Older WebKit has no durability option. */ } }
  return db.transaction(names, mode);
}
function result<T>(request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(failure(request.error)); }); }
async function run<T>(names: Store[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const tx = transaction(await openUploads(), names, mode);
  const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(failure(tx.error)); });
  // Observe aborts immediately, including an abort after individual requests succeeded.
  void done.catch(() => {});
  try { const value = await work(tx); await done; return value; }
  catch (error) { try { tx.abort(); } catch { /* It may have already aborted. */ } await done.catch(() => {}); throw failure(error); }
}
export async function pageJobs(after?: number, limit = 200): Promise<UploadJob[]> {
  return run(['jobs'], 'readonly', tx => result(tx.objectStore('jobs').index('order').getAll(after === undefined ? undefined : IDBKeyRange.lowerBound(after, true), limit)));
}
export async function getJob(id: string): Promise<UploadJob | undefined> { return run(['jobs'], 'readonly', tx => result(tx.objectStore('jobs').get(id))); }
export async function getBlob(id: string, thumbnail = false): Promise<Blob | undefined> { return run([thumbnail ? 'thumbnails' : 'originals'], 'readonly', tx => result(tx.objectStore(thumbnail ? 'thumbnails' : 'originals').get(id))); }
export async function getSetting<T>(key: string): Promise<T | undefined> { return run(['settings'], 'readonly', tx => result(tx.objectStore('settings').get(key))); }
export async function setSetting(key: string, value: unknown): Promise<void> { await run(['settings'], 'readwrite', async tx => { await result(tx.objectStore('settings').put(value, key)); }); }
export async function reserveOrder(): Promise<number> { return run(['settings'], 'readwrite', async tx => { const store=tx.objectStore('settings'), value=Math.max(Date.now()*1000,Number(await result(store.get('next-order'))??0));await result(store.put(value+1,'next-order'));return value; }); }
export async function verifyFence(tx: IDBTransaction, fence?: Fence): Promise<void> {
  if (!fence) return;
  const current = await result<Fence | undefined>(tx.objectStore('settings').get('lease'));
  if (!ownsLease(current, fence, Date.now())) throw new LocalStoreError('ownership', 'Uploads are running in another tab.');
}
export function ownsLease(current: Fence | undefined, fence: Fence, now: number): boolean { return !!current && current.owner === fence.owner && current.generation === fence.generation && current.expires > now; }
export async function checkOwnership(fence: Fence): Promise<void> { await run(['settings'], 'readonly', tx => verifyFence(tx, fence)); }
export async function saveJob(job: UploadJob, options: { original?: Blob; thumbnail?: Blob; dropOriginal?: boolean; dropThumbnail?: boolean; remove?: boolean; fence?: Fence; create?: boolean } = {}): Promise<UploadJob> {
  return run([...stores], 'readwrite', async tx => {
    await verifyFence(tx, options.fence);
    const current = await result<UploadJob | undefined>(tx.objectStore('jobs').get(job.id));
    if (options.create ? !!current : !current || current.rev !== job.rev) throw new LocalStoreError('changed', 'Upload state changed in another tab.');
    const next = { ...job, rev: job.rev + 1, updated: Date.now() };
    if (options.remove) await result(tx.objectStore('jobs').delete(job.id)); else await result(tx.objectStore('jobs').put(next));
    if (options.original) await result(tx.objectStore('originals').put(options.original, job.id));
    if (options.thumbnail) await result(tx.objectStore('thumbnails').put(options.thumbnail, job.id));
    if (options.dropOriginal || options.remove) await result(tx.objectStore('originals').delete(job.id));
    if (options.dropThumbnail || options.remove) await result(tx.objectStore('thumbnails').delete(job.id));
    return next;
  });
}
export async function changeJobs(ids: string[], change: (job: UploadJob, index: number) => UploadJob): Promise<UploadJob[]> {
  return run(['jobs'], 'readwrite', async tx => {
    const store=tx.objectStore('jobs'), rows:UploadJob[]=[];
    for (const [index,id] of ids.entries()) {
      const current=await result<UploadJob|undefined>(store.get(id));
      if (!current) continue;
      const next={...change(current,index),rev:current.rev+1,updated:Date.now()};
      await result(store.put(next)); rows.push(next);
    }
    return rows;
  });
}
export async function retain(job: UploadJob, blob: Blob): Promise<UploadJob> {
  const saved = await saveJob({ ...job, retention: 'saving' }, { original: blob });
  const check = await getBlob(job.id);
  if (!(check instanceof Blob) || check.size !== job.size) throw new LocalStoreError('missing', 'Original file needed. Local write could not be verified.');
  // The label changes only after the blob transaction committed AND read-back passed.
  return saveJob({ ...saved, retention: 'retained', blocker: saved.blocker === 'local' ? '' : saved.blocker });
}
export async function acquireLease(owner: string): Promise<Fence | undefined> {
  return run(['settings'], 'readwrite', async tx => {
    const store = tx.objectStore('settings'), current = await result<Fence | undefined>(store.get('lease'));
    const now = Date.now();
    if (current && current.expires > now && current.owner !== owner) return;
    const generation = current?.owner === owner && current.expires > now ? current.generation : Number(await result(store.get('fence')) ?? 0) + 1;
    const next = { owner, generation, expires: now + 30000 };
    await result(store.put(generation, 'fence')); await result(store.put(next, 'lease'));
    return next;
  });
}
export async function releaseLease(fence: Fence): Promise<void> {
  await run(['settings'], 'readwrite', async tx => { const store = tx.objectStore('settings'), current = await result<Fence | undefined>(store.get('lease')); if (current?.owner === fence.owner && current.generation === fence.generation) await result(store.delete('lease')); });
}
