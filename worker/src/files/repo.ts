import type { SettingsDTO, StatsDTO } from '../../../shared/types';
import { STORAGE_CAP_BYTES } from './config';

export interface FileRow {
  id: string; name: string; mime: string; size: number;
  width: number | null; height: number | null; thumb_size: number; note: string; pinned: number;
  created_at: number; deleted_at: number | null; tags: string;
}
export interface ListFilter {
  limit: number; trash: boolean; cursor?: string; since?: string; until?: string;
  type?: 'image' | 'pdf' | 'file'; tag?: string; q?: string; pinned?: boolean;
}
export interface FilePatch { name?: string; note?: string; pinned?: boolean; tags?: string[] }
export type BulkAction = 'trash' | 'restore' | 'pin' | 'unpin' | 'tag_add' | 'tag_remove' | 'purge';
const columns = `f.id, f.name, f.mime, f.size, f.width, f.height, f.thumb_size, f.note, f.pinned, f.created_at, f.deleted_at,
 (SELECT json_group_array(t.tag) FROM file_tags t WHERE t.file_id = f.id) AS tags`;
const byIds = 'id IN (SELECT value FROM json_each(?1))';

export function createRepo(db: D1Database) {
  const rowsByIds = async (ids: string[]): Promise<FileRow[]> => {
    const result = await db.prepare(`SELECT ${columns} FROM files f WHERE f.${byIds} LIMIT 200`).bind(JSON.stringify(ids)).all<FileRow>();
    return result.results;
  };
  return {
    async get(id: string): Promise<FileRow | null> {
      return db.prepare(`SELECT ${columns} FROM files f WHERE f.id = ?1 LIMIT 1`).bind(id).first<FileRow>();
    },
    async bySha(sha: string): Promise<FileRow | null> {
      return db.prepare(`SELECT ${columns} FROM files f WHERE f.deleted_at IS NULL AND f.sha256 = ?1 LIMIT 1`).bind(sha).first<FileRow>();
    },
    async check(hashes: string[]): Promise<Record<string, string>> {
      const result = await db.prepare('SELECT sha256, id FROM files WHERE deleted_at IS NULL AND sha256 IN (SELECT value FROM json_each(?1)) LIMIT 50').bind(JSON.stringify(hashes)).all<{ sha256: string; id: string }>();
      return Object.fromEntries(result.results.map((row) => [row.sha256, row.id]));
    },
    async insert(row: FileRow, sha: string | null): Promise<void> {
      await db.prepare('INSERT INTO files (id, name, mime, size, sha256, width, height, thumb_size, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)')
        .bind(row.id, row.name, row.mime, row.size, sha, row.width, row.height, row.created_at).run();
    },
    async list(filter: ListFilter): Promise<FileRow[]> {
      const where = [filter.trash ? 'f.deleted_at IS NOT NULL' : 'f.deleted_at IS NULL'];
      const values: (string | number)[] = [];
      if (filter.cursor !== undefined) { where.push('f.id < ?'); values.push(filter.cursor); }
      if (filter.since !== undefined) { where.push('f.id >= ?'); values.push(filter.since); }
      if (filter.until !== undefined) { where.push('f.id <= ?'); values.push(filter.until); }
      if (filter.type === 'image') where.push("f.mime LIKE 'image/%'");
      if (filter.type === 'pdf') where.push("f.mime = 'application/pdf'");
      if (filter.type === 'file') where.push("f.mime NOT LIKE 'image/%' AND f.mime != 'application/pdf'");
      if (filter.pinned) where.push('f.pinned = 1');
      if (filter.tag !== undefined) { where.push('f.id IN (SELECT file_id FROM file_tags WHERE tag = ?)'); values.push(filter.tag); }
      if (filter.q !== undefined) { where.push("f.name LIKE ? ESCAPE '\\'"); values.push(filter.q); }
      const result = await db.prepare(`SELECT ${columns} FROM files f WHERE ${where.join(' AND ')} ORDER BY f.id DESC LIMIT ?`).bind(...values, filter.limit + 1).all<FileRow>();
      return result.results;
    },
    async patch(id: string, patch: FilePatch): Promise<void> {
      const statements: D1PreparedStatement[] = [];
      const set: string[] = [];
      const values: (string | number)[] = [];
      if (patch.name !== undefined) { set.push('name = ?'); values.push(patch.name); }
      if (patch.note !== undefined) { set.push('note = ?'); values.push(patch.note); }
      if (patch.pinned !== undefined) { set.push('pinned = ?'); values.push(patch.pinned ? 1 : 0); }
      if (set.length) statements.push(db.prepare(`UPDATE files SET ${set.join(', ')} WHERE id = ? AND deleted_at IS NULL`).bind(...values, id));
      if (patch.tags !== undefined) {
        statements.push(db.prepare('DELETE FROM file_tags WHERE file_id = ?1 AND EXISTS (SELECT 1 FROM files WHERE id = ?1 AND deleted_at IS NULL)').bind(id));
        statements.push(db.prepare('INSERT INTO file_tags (file_id, tag) SELECT ?1, value FROM json_each(?2) WHERE EXISTS (SELECT 1 FROM files WHERE id = ?1 AND deleted_at IS NULL)').bind(id, JSON.stringify(patch.tags)));
      }
      await db.batch(statements);
    },
    async setThumb(id: string, size: number, width: number | null, height: number | null): Promise<void> {
      await db.prepare('UPDATE files SET thumb_size = ?1, width = COALESCE(width, ?2), height = COALESCE(height, ?3) WHERE id = ?4 AND deleted_at IS NULL').bind(size, width, height, id).run();
    },
    rowsByIds,
    async bulk(action: Exclude<BulkAction, 'purge'>, ids: string[], now: number, tag?: string): Promise<number> {
      let statement: D1PreparedStatement;
      const json = JSON.stringify(ids);
      switch (action) {
        case 'trash': statement = db.prepare('UPDATE files SET deleted_at = ?1 WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?2))').bind(now, json); break;
        case 'restore': statement = db.prepare('UPDATE OR IGNORE files SET deleted_at = NULL WHERE deleted_at IS NOT NULL AND id IN (SELECT value FROM json_each(?1))').bind(json); break;
        case 'pin': case 'unpin': statement = db.prepare('UPDATE files SET pinned = ?1 WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?2))').bind(action === 'pin' ? 1 : 0, json); break;
        case 'tag_add': statement = db.prepare(`INSERT OR IGNORE INTO file_tags (file_id, tag) SELECT f.id, ?1 FROM files f WHERE f.deleted_at IS NULL AND f.id IN (SELECT value FROM json_each(?2)) AND (SELECT COUNT(*) FROM file_tags t WHERE t.file_id = f.id) < 5`).bind(tag, json); break;
        case 'tag_remove': statement = db.prepare('DELETE FROM file_tags WHERE tag = ?1 AND file_id IN (SELECT value FROM json_each(?2))').bind(tag, json); break;
      }
      return (await statement.run()).meta.changes;
    },
    async purge(ids: string[]): Promise<FileRow[]> {
      const json = JSON.stringify(ids);
      const results = await db.batch<FileRow>([
        db.prepare(`DELETE FROM file_tags WHERE file_id IN (SELECT id FROM files WHERE deleted_at IS NOT NULL AND ${byIds})`).bind(json),
        db.prepare(`DELETE FROM files WHERE deleted_at IS NOT NULL AND ${byIds} RETURNING id, name, mime, size, width, height, thumb_size, note, pinned, created_at, deleted_at, '[]' AS tags`).bind(json),
      ]);
      return results[1].results;
    },
    async oldestTrash(limit: number): Promise<FileRow[]> {
      return (await db.prepare(`SELECT ${columns} FROM files f WHERE f.deleted_at IS NOT NULL ORDER BY f.deleted_at, f.id LIMIT ?1`).bind(limit).all<FileRow>()).results;
    },
    async trashCount(): Promise<number> {
      return (await db.prepare('SELECT COUNT(*) AS count FROM files WHERE deleted_at IS NOT NULL').first<{ count: number }>())!.count;
    },
    async tags(): Promise<{ tag: string; count: number }[]> {
      return (await db.prepare('SELECT t.tag, COUNT(*) AS count FROM file_tags t JOIN files f ON f.id = t.file_id WHERE f.deleted_at IS NULL GROUP BY t.tag ORDER BY count DESC, t.tag LIMIT 100').all<{ tag: string; count: number }>()).results;
    },
    async getSettings(): Promise<SettingsDTO> {
      const rows = (await db.prepare("SELECT key, value FROM settings WHERE key IN ('auto_expire_days', 'trash_days') LIMIT 2").all<{ key: string; value: string }>()).results;
      const values = Object.fromEntries(rows.map((row) => [row.key, Number(row.value)]));
      return { autoExpireDays: values.auto_expire_days, trashDays: values.trash_days };
    },
    async setSettings(value: SettingsDTO): Promise<void> {
      await db.batch([
        db.prepare("UPDATE settings SET value = ?1 WHERE key = 'auto_expire_days'").bind(String(value.autoExpireDays)),
        db.prepare("UPDATE settings SET value = ?1 WHERE key = 'trash_days'").bind(String(value.trashDays)),
      ]);
    },
    async stats(): Promise<StatsDTO> {
      const result = await db.batch<{ count: number; photoCount: number; bytes: number }>([
        db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN mime LIKE 'image/%' THEN 1 ELSE 0 END), 0) AS photoCount, COALESCE(SUM(size + thumb_size), 0) AS bytes FROM files WHERE deleted_at IS NULL"),
        db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size + thumb_size), 0) AS bytes FROM files WHERE deleted_at IS NOT NULL'),
      ]);
      const active = result[0].results[0];
      const trash = result[1].results[0];
      return { count: active.count, photoCount: active.photoCount, bytes: active.bytes, trashCount: trash.count, trashBytes: trash.bytes, capBytes: STORAGE_CAP_BYTES };
    },
  };
}
export type FileRepo = ReturnType<typeof createRepo>;
