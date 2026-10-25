import type { Env } from '../env';
import { KV_DELETE_PARALLEL } from './config';

export interface StoredMeta { size: number; at: number }
export interface StoredObject { body: ReadableStream<Uint8Array>; meta: StoredMeta | null }
export interface ListedKey { name: string; meta: StoredMeta | null }
export interface Storage {
  putStream(key: string, body: ReadableStream<Uint8Array>, length: number, meta: StoredMeta): Promise<void>;
  putBytes(key: string, bytes: ArrayBuffer, meta: StoredMeta): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  deleteMany(keys: string[]): Promise<{ failed: number; quotaExceeded: boolean }>;
  list(cursor: string | null, limit: number): Promise<{ keys: ListedKey[]; cursor: string | null }>;
}
export class StorageQuotaError extends Error {}
export class StorageLengthError extends Error {}
export const isStorageQuotaMessage = (message: string): boolean => /limit exceeded/i.test(message);
const quotaError = (error: unknown): boolean => isStorageQuotaMessage(error instanceof Error ? error.message : String(error));
function metadata(value: unknown): StoredMeta | null {
  if (!value || typeof value !== 'object') return null;
  const { size, at } = value as Record<string, unknown>;
  return typeof size === 'number' && Number.isFinite(size) && typeof at === 'number' && Number.isFinite(at) ? { size, at } : null;
}
export function createStorage(kv: KVNamespace): Storage {
  return {
    async putStream(key, body, length, meta) {
      const fixed = new FixedLengthStream(length);
      const abort = new AbortController();
      let lengthFailed = false;
      const piped = body.pipeTo(fixed.writable, { signal: abort.signal }).catch(() => { if (!abort.signal.aborted) lengthFailed = true; });
      try {
        await kv.put(key, fixed.readable, { metadata: meta });
        await piped;
        if (lengthFailed) throw new StorageLengthError();
      } catch (error) {
        abort.abort();
        await fixed.readable.cancel().catch(() => {});
        await piped;
        if (quotaError(error)) throw new StorageQuotaError();
        if (lengthFailed || (error instanceof TypeError && /FixedLengthStream/.test(error.message))) throw new StorageLengthError();
        throw error;
      }
    },
    async putBytes(key, bytes, meta) {
      try { await kv.put(key, bytes, { metadata: meta }); }
      catch (error) { if (quotaError(error)) throw new StorageQuotaError(); throw error; }
    },
    async get(key) {
      const result = await kv.getWithMetadata<StoredMeta>(key, { type: 'stream' });
      return result.value === null ? null : { body: result.value, meta: metadata(result.metadata) };
    },
    async deleteMany(keys) {
      let failed = 0;
      let quotaExceeded = false;
      for (let offset = 0; offset < keys.length; offset += KV_DELETE_PARALLEL) {
        if (quotaExceeded) { failed += keys.length - offset; break; }
        await Promise.all(keys.slice(offset, offset + KV_DELETE_PARALLEL).map(async (key) => {
          try { await kv.delete(key); }
          catch (error) { failed += 1; if (quotaError(error)) quotaExceeded = true; }
        }));
      }
      if (failed) console.log(JSON.stringify({ evt: 'kv_delete_fail' }));
      return { failed, quotaExceeded };
    },
    async list(cursor, limit) {
      try {
        const result = await kv.list<StoredMeta>({ cursor, limit: Math.max(1, Math.min(1000, limit)) });
        return { keys: result.keys.map((key) => ({ name: key.name, meta: metadata(key.metadata) })), cursor: result.list_complete ? null : result.cursor };
      } catch (error) { if (quotaError(error)) throw new StorageQuotaError(); throw error; }
    },
  };
}
export const storageFor = (env: Pick<Env, 'FILES'>): Storage => createStorage(env.FILES);
