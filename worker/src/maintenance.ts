import type { Env } from './env';
import { ulidFloor } from './ids';
import { storageFor, StorageQuotaError } from './files/storage';

const DAY = 86400000;
const HOUR = 3600000;
const objectKey = /^(f|t)\/([0-9A-HJKMNP-TV-Z]{26})$/;
export const MAINT_MAX_OPS = 400;
export const MAINT_MAX_KV_MUTATIONS = 250;
export const expireCutoffId = (now: number, days: number): string => ulidFloor(Math.max(0, now - days * DAY));
export const purgeCutoff = (now: number, trashDays: number): number => now - trashDays * DAY;
export function chunk<T>(array: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('Invalid chunk size.');
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size));
  return result;
}
export class OpBudget {
  ops = 0;
  kvMutations = 0;
  budgetExhausted = false;
  get remainingKvMutations(): number { return Math.min(MAINT_MAX_KV_MUTATIONS - this.kvMutations, MAINT_MAX_OPS - this.ops); }
  take(n: number): boolean { return this.reserve(n, false); }
  takeKv(n: number): boolean { return this.reserve(n, true); }
  private reserve(n: number, kv: boolean): boolean {
    if (!Number.isInteger(n) || n < 0) throw new RangeError('Invalid operation count.');
    if (this.ops + n > MAINT_MAX_OPS || (kv && this.kvMutations + n > MAINT_MAX_KV_MUTATIONS)) { this.budgetExhausted = true; return false; }
    this.ops += n;
    if (kv) this.kvMutations += n;
    return true;
  }
}
export const purgeBatchSize = (remaining: number, max: number): number => Math.max(0, Math.min(max, Math.floor(remaining / 2)));
interface OrphanObject { key: string; size: number | null; at: number | null }
function oldObject(object: OrphanObject, now: number): boolean {
  return object.at === null || !Number.isFinite(object.at) || object.at < 0 || object.at <= now - HOUR;
}
export function planOrphanActions(objects: OrphanObject[], rows: Map<string, { thumbSize: number }>, now: number): { deleteKeys: string[]; repairThumbs: { id: string; size: number }[] } {
  const deleteKeys: string[] = [], repairThumbs: { id: string; size: number }[] = [];
  for (const object of objects) {
    const match = objectKey.exec(object.key);
    if (!match || !oldObject(object, now)) continue;
    const row = rows.get(match[2]);
    if (!row) deleteKeys.push(object.key);
    else if (match[1] === 't' && row.thumbSize === 0 && object.size !== null && Number.isSafeInteger(object.size) && object.size > 0 && object.size <= 153600) repairThumbs.push({ id: match[2], size: object.size });
  }
  return { deleteKeys, repairThumbs };
}
export interface MaintenanceResult { expired: number; purged: number; orphans: number; ops: number; kvMutations: number; budgetExhausted: boolean }
export async function runMaintenance(env: Env, now: number): Promise<MaintenanceResult> {
  const budget = new OpBudget(), storage = storageFor(env);
  let expired = 0, purged = 0, orphans = 0, kvStopped = false;
  const quota = () => { if (!kvStopped) console.log(JSON.stringify({ evt: 'maintenance_quota' })); kvStopped = true; };
  const step = async (name: string, work: () => Promise<void>) => {
    try { await work(); }
    catch (error) { if (error instanceof StorageQuotaError) quota(); else console.log(JSON.stringify({ evt: 'maintenance_fail', step: name })); }
  };
  let autoDays = 0, trashDays = 7, cursor: string | null = null;
  let settingsRead = false;
  await step('settings', async () => {
    if (!budget.take(1)) return;
    const result = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('auto_expire_days', 'trash_days', 'orphan_cursor') LIMIT 3").all<{ key: string; value: string }>();
    const values = new Map(result.results.map(row => [row.key, row.value]));
    autoDays = Number(values.get('auto_expire_days') ?? 0);
    trashDays = Number(values.get('trash_days') ?? 7);
    cursor = values.get('orphan_cursor') || null;
    settingsRead = true;
  });
  await step('expire', async () => {
    if (!settingsRead || !(autoDays > 0) || !budget.take(1)) return;
    expired = (await env.DB.prepare('UPDATE files SET deleted_at = ?1 WHERE deleted_at IS NULL AND pinned = 0 AND id < ?2').bind(now, expireCutoffId(now, autoDays)).run()).meta.changes;
  });
  await step('purge', async () => {
    if (!settingsRead || !Number.isFinite(trashDays) || trashDays < 1) return;
    const cutoff = purgeCutoff(now, trashDays);
    for (let loop = 0; loop < 5 && !kvStopped; loop++) {
      const count = purgeBatchSize(budget.remainingKvMutations, 50);
      if (!count) { budget.budgetExhausted = true; break; }
      if (!budget.take(1)) break;
      const rows = (await env.DB.prepare('SELECT id, thumb_size FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ?1 ORDER BY deleted_at, id LIMIT ?2').bind(cutoff, count).all<{ id: string; thumb_size: number }>()).results;
      if (!rows.length) break;
      // Reserve both D1 statements and every possible delete before changing rows.
      if (!budget.take(2)) break;
      if (!budget.takeKv(rows.reduce((n, row) => n + (row.thumb_size > 0 ? 2 : 1), 0))) break;
      const ids = JSON.stringify(rows.map(row => row.id));
      const deleted = (await env.DB.batch<{ id: string; thumb_size: number }>([
        env.DB.prepare('DELETE FROM file_tags WHERE file_id IN (SELECT id FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ?1 AND id IN (SELECT value FROM json_each(?2)))').bind(cutoff, ids),
        env.DB.prepare('DELETE FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ?1 AND id IN (SELECT value FROM json_each(?2)) RETURNING id, thumb_size').bind(cutoff, ids),
      ]))[1].results;
      purged += deleted.length;
      const result = await storage.deleteMany(deleted.flatMap(row => row.thumb_size > 0 ? [`f/${row.id}`, `t/${row.id}`] : [`f/${row.id}`]));
      if (result.quotaExceeded) quota();
    }
  });
  await step('orphans', async () => {
    if (!settingsRead || kvStopped) return;
    for (let page = 0; page < 4 && !kvStopped; page++) {
      if (!budget.takeKv(1)) break;
      const listing = await storage.list(cursor, 1000);
      const objects = listing.keys.map(key => ({ key: key.name, size: key.meta?.size ?? null, at: key.meta?.at ?? null })).filter(object => objectKey.test(object.key) && oldObject(object, now));
      let complete = true;
      for (const group of chunk(objects, 500)) {
        if (!budget.take(1)) { complete = false; break; }
        const ids = [...new Set(group.map(object => object.key.slice(2)))];
        const rows = (await env.DB.prepare('SELECT id, thumb_size FROM files WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(ids)).all<{ id: string; thumb_size: number }>()).results;
        const plan = planOrphanActions(group, new Map(rows.map(row => [row.id, { thumbSize: row.thumb_size }])), now);
        if (plan.repairThumbs.length) {
          if (!budget.take(1)) { complete = false; break; }
          await env.DB.prepare("UPDATE files SET thumb_size = (SELECT json_extract(value, '$.size') FROM json_each(?1) WHERE json_extract(value, '$.id') = files.id) WHERE thumb_size = 0 AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))").bind(JSON.stringify(plan.repairThumbs)).run();
        }
        const keys = plan.deleteKeys.slice(0, budget.remainingKvMutations);
        if (keys.length < plan.deleteKeys.length) { complete = false; budget.budgetExhausted = true; }
        if (keys.length && budget.takeKv(keys.length)) {
          const result = await storage.deleteMany(keys);
          orphans += keys.length - result.failed;
          if (result.quotaExceeded) { quota(); complete = false; }
          else if (result.failed) complete = false;
        }
        if (!complete) break;
      }
      // Never advance past an unfinished page; replaying it is idempotent.
      if (!complete || !budget.take(1)) break;
      cursor = listing.cursor;
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('orphan_cursor', ?1)").bind(cursor ?? '').run();
      if (!cursor) break;
    }
  });
  await step('login_cleanup', async () => {
    if (budget.take(1)) await env.DB.prepare('DELETE FROM login_attempts WHERE window_start < ?1').bind(now - DAY).run();
  });
  const result = { expired, purged, orphans, ops: budget.ops, kvMutations: budget.kvMutations, budgetExhausted: budget.budgetExhausted };
  console.log(JSON.stringify({ evt: 'maintenance', ...result }));
  return result;
}
