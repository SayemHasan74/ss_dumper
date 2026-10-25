import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { chunk, expireCutoffId, OpBudget, planOrphanActions, purgeBatchSize, purgeCutoff, runMaintenance } from '../src/maintenance';
import * as storageModule from '../src/files/storage';
import type { Storage } from '../src/files/storage';
import { ulidFloor } from '../src/ids';
import { fixture, silenceEvents } from './helpers';

const now = 1792843200000, id = ulidFloor(now - 7200000), other = ulidFloor(now - 8000000);
beforeEach(silenceEvents);
afterEach(() => vi.restoreAllMocks());
it('computes indexed cutoffs, bounded batches and chunks', () => {
  expect(expireCutoffId(now, 30)).toBe(ulidFloor(now - 30 * 86400000));
  expect(purgeCutoff(now, 7)).toBe(now - 7 * 86400000);
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  expect(() => chunk([], 0)).toThrow(RangeError);
  expect(purgeBatchSize(101, 50)).toBe(50);
  expect(purgeBatchSize(3, 50)).toBe(1);
  expect(purgeBatchSize(1, 50)).toBe(0);
});
it('refuses operations beyond either budget without increasing its counters', () => {
  const total = new OpBudget();
  expect(total.take(399)).toBe(true);
  expect(total.takeKv(1)).toBe(true);
  expect(total.take(1)).toBe(false);
  expect(total.ops).toBe(400);
  const kv = new OpBudget();
  expect(kv.takeKv(250)).toBe(true);
  expect(kv.takeKv(1)).toBe(false);
  expect(kv.kvMutations).toBe(250);
  expect(kv.take(1)).toBe(true);
  expect(kv.budgetExhausted).toBe(true);
});
it('deletes only old or metadata-less orphan objects and ignores foreign keys', () => {
  const result = planOrphanActions([
    { key: `f/${id}`, size: 20, at: now - 7200000 },
    { key: `t/${id}`, size: 20, at: null },
    { key: `f/${other}`, size: 20, at: now - 1000 },
    { key: 'x/abc', size: null, at: null },
  ], new Map(), now);
  expect(result.deleteKeys).toEqual([`f/${id}`, `t/${id}`]);
  expect(result.repairThumbs).toEqual([]);
});
it('keeps originals with active or trashed rows and repairs only known, valid thumbnails', () => {
  const objects = [{ key: `f/${id}`, size: 20, at: null }, { key: `t/${id}`, size: 20, at: null }];
  expect(planOrphanActions(objects, new Map([[id, { thumbSize: 0 }]]), now)).toEqual({ deleteKeys: [], repairThumbs: [{ id, size: 20 }] });
  expect(planOrphanActions(objects, new Map([[id, { thumbSize: 20 }]]), now)).toEqual({ deleteKeys: [], repairThumbs: [] });
  expect(planOrphanActions([{ key: `t/${id}`, size: null, at: null }], new Map([[id, { thumbSize: 0 }]]), now).repairThumbs).toEqual([]);
});
it('uses the injected clock for the manual isolate cooldown', async () => {
  const f = await fixture(), cookie = await f.getCookie();
  const request = () => f.request('/api/maintenance/run', { method: 'POST', headers: { Cookie: cookie, 'x-dump-client': '1' } });
  expect((await request()).status).toBe(200);
  expect((await request()).status).toBe(429);
  f.advance(60000);
  expect((await request()).status).toBe(200);
});
it('stops purge and orphan calls on a non-throwing delete quota result, but still cleans login counters', async () => {
  const f = await fixture();
  const calls: string[] = [];
  const prepare = (sql: string) => {
    const statement = {
      bind: (..._values: unknown[]) => statement,
      all: async () => { calls.push(sql); return { results: sql.includes('FROM settings') ? [{ key: 'auto_expire_days', value: '0' }, { key: 'trash_days', value: '7' }] : [{ id, thumb_size: 12 }] }; },
      run: async () => { calls.push(sql); return { meta: { changes: 0 } }; },
    };
    return statement;
  };
  const batch = vi.fn(async () => [{ results: [] }, { results: [{ id, thumb_size: 12 }] }]);
  f.env.DB = { prepare, batch } as unknown as D1Database;
  const remove = vi.fn(async () => ({ failed: 2, quotaExceeded: true })), list = vi.fn();
  vi.spyOn(storageModule, 'storageFor').mockReturnValue({ deleteMany: remove, list } as unknown as Storage);
  const result = await runMaintenance(f.env, now);
  expect(batch).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledExactlyOnceWith([`f/${id}`, `t/${id}`]);
  expect(list).not.toHaveBeenCalled();
  expect(calls.at(-1)).toContain('DELETE FROM login_attempts');
  expect(console.log).toHaveBeenCalledWith('{"evt":"maintenance_quota"}');
  expect(result.ops).toBeLessThanOrEqual(400);
  expect(result.kvMutations).toBe(2);
});
it('keeps an unfinished orphan cursor and never exceeds the mutation cap', async () => {
  const f = await fixture();
  const persisted: string[] = [];
  const prepare = (sql: string) => {
    const statement = {
      bind: (..._values: unknown[]) => statement,
      all: async () => ({ results: sql.includes('FROM settings') ? [{ key: 'auto_expire_days', value: '0' }, { key: 'trash_days', value: '7' }, { key: 'orphan_cursor', value: 'resume' }] : [] }),
      run: async () => { persisted.push(sql); return { meta: { changes: 0 } }; },
    };
    return statement;
  };
  f.env.DB = { prepare } as unknown as D1Database;
  const keys = Array.from({ length: 500 }, (_, i) => ({ name: `f/${ulidFloor(now - 7200000 - i)}`, meta: { size: 20, at: now - 7200000 } }));
  const list = vi.fn(async () => ({ keys, cursor: 'next' }));
  const remove = vi.fn(async () => ({ failed: 0, quotaExceeded: false }));
  vi.spyOn(storageModule, 'storageFor').mockReturnValue({ list, deleteMany: remove } as unknown as Storage);
  const result = await runMaintenance(f.env, now);
  expect(result.kvMutations).toBe(250);
  expect(result.orphans).toBe(249);
  expect(result.budgetExhausted).toBe(true);
  expect(list).toHaveBeenCalledExactlyOnceWith('resume', 1000);
  expect(persisted.every(sql => !sql.includes('orphan_cursor'))).toBe(true);
  expect(persisted.at(-1)).toContain('DELETE FROM login_attempts');
});
