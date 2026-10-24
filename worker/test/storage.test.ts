import { afterEach, expect, it, vi } from 'vitest';
import { createStorage, isStorageQuotaMessage, StorageQuotaError } from '../src/files/storage';
import { KV_DELETE_PARALLEL } from '../src/files/config';

afterEach(() => vi.restoreAllMocks());
it('matches quota messages without matching unrelated failures', () => {
  expect(isStorageQuotaMessage('KV put() LIMIT EXCEEDED for the day.')).toBe(true);
  expect(isStorageQuotaMessage('Connection unavailable')).toBe(false);
});
it('deletes empty lists for free and bounds parallelism while counting errors', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  let active = 0;
  let maximum = 0;
  const remove = vi.fn(async (key: string) => {
    active += 1; maximum = Math.max(maximum, active);
    await Promise.resolve(); active -= 1;
    if (key === '3') throw new Error('offline');
  });
  const storage = createStorage({ delete: remove } as unknown as KVNamespace);
  expect(await storage.deleteMany([])).toEqual({ failed: 0, quotaExceeded: false });
  expect(remove).not.toHaveBeenCalled();
  expect(await storage.deleteMany(Array.from({ length: 25 }, (_, index) => String(index)))).toEqual({ failed: 1, quotaExceeded: false });
  expect(remove).toHaveBeenCalledTimes(25);
  expect(maximum).toBeLessThanOrEqual(KV_DELETE_PARALLEL);
  expect(console.log).toHaveBeenCalledExactlyOnceWith('{"evt":"kv_delete_fail"}');
});
it('reports quota without throwing and starts no groups after the quota failure', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const remove = vi.fn(async (key: string) => { if (key === '0') throw new Error('KV delete() limit exceeded for the day.'); });
  const storage = createStorage({ delete: remove } as unknown as KVNamespace);
  expect(await storage.deleteMany(Array.from({ length: 25 }, (_, index) => String(index)))).toEqual({ failed: 16, quotaExceeded: true });
  expect(remove).toHaveBeenCalledTimes(KV_DELETE_PARALLEL);
  expect(remove.mock.calls.every(([key]) => Number(key) < KV_DELETE_PARALLEL)).toBe(true);
  expect(console.log).toHaveBeenCalledExactlyOnceWith('{"evt":"kv_delete_fail"}');
});
it('validates list metadata, bounds page size, and uses one stream read without cacheTtl', async () => {
  const list = vi.fn(async () => ({ keys: [{ name:'good', metadata:{size:12,at:100} },{name:'bad',metadata:{size:'12',at:100}},{name:'missing'}], list_complete:false, cursor:'next' }));
  const getWithMetadata = vi.fn(async () => ({ value: null, metadata: null }));
  const storage = createStorage({ list, getWithMetadata } as unknown as KVNamespace);
  expect(await storage.list(null,5000)).toEqual({ keys:[{name:'good',meta:{size:12,at:100}},{name:'bad',meta:null},{name:'missing',meta:null}],cursor:'next' });
  expect(list).toHaveBeenCalledWith({cursor:null,limit:1000});
  expect(await storage.get('missing')).toBeNull();
  expect(getWithMetadata).toHaveBeenCalledExactlyOnceWith('missing',{type:'stream'});
});
it('maps write-byte quota errors', async () => {
  const storage = createStorage({ put: async () => { throw new Error('limit exceeded'); } } as unknown as KVNamespace);
  await expect(storage.putBytes('test',new ArrayBuffer(1),{size:1,at:1})).rejects.toBeInstanceOf(StorageQuotaError);
});
