import type { Context, Hono } from 'hono';
import type { SettingsDTO, StatsDTO } from '../../../shared/types';
import type { AppEnv } from '../env';
import { HttpError, ok, parseJsonBody } from '../http';
import { JSON_LIMITS } from '../limits';
import { isUlid, ulid, ulidCeil, ulidFloor, ulidTime } from '../ids';
import { AUTO_EXPIRE_DAYS, BULK_MAX_IDS, CHECK_MAX_HASHES, EMPTY_TRASH_MAX_PER_CALL, MAX_THUMB_BYTES, MAX_UPLOAD_BYTES, NOTE_MAX, PURGE_MAX_PER_CALL, SEARCH_MAX, SNIFF_BYTES, STORAGE_CAP_BYTES, TRASH_DAYS } from './config';
import { fileDTO } from './dto';
import { createRepo, type BulkAction, type FilePatch, type FileRepo, type FileRow, type ListFilter } from './repo';
import { serveFile } from './serve';
import { jpegMagicOk, sniffMime } from './sniff';
import { storageFor, StorageLengthError, StorageQuotaError, type Storage } from './storage';
import { peekPrefix } from './stream';
import { badRequest, escapeLike, normalizeTag, parseDim, parseLimit, parseSha, parseTags, sanitizeName } from './validate';

export interface FileCaches {
  getSettings(db: D1Database): Promise<SettingsDTO>;
  setSettings(settings: SettingsDTO): void;
  getStats(db: D1Database): Promise<StatsDTO>;
  adjustStats(before: FileRow[], after: FileRow[]): void;
}
function missing(): never { throw new HttpError(404, 'NOT_FOUND', 'File not found.'); }
const dailyLimit = (): never => { throw new HttpError(429, 'DAILY_LIMIT', 'Daily storage limit reached. Try again after 06:00 Dhaka time (00:00 UTC).'); };
function putError(error: unknown): never {
  if (error instanceof StorageQuotaError) dailyLimit();
  if (error instanceof StorageLengthError) throw new HttpError(400, 'SIZE_MISMATCH', 'Body length does not match Content-Length.');
  console.log(JSON.stringify({ evt: 'kv_put_fail' }));
  throw new HttpError(500, 'INTERNAL', 'An internal error occurred.');
}
function length(context: Context<AppEnv>, maximum: number): number {
  const value = context.req.header('Content-Length');
  if (value === undefined || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new HttpError(411, 'LENGTH_REQUIRED', 'A valid Content-Length is required.');
  const size = Number(value);
  if (size === 0) throw new HttpError(400, 'EMPTY_FILE', 'File is empty.');
  if (size > maximum) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'File is too large.');
  return size;
}
function dimensions(context: Context<AppEnv>): { width: number | null; height: number | null } {
  const width = context.req.header('X-Width');
  const height = context.req.header('X-Height');
  if ((width === undefined) !== (height === undefined)) badRequest('dimensions');
  return { width: width === undefined ? null : parseDim(width), height: height === undefined ? null : parseDim(height) };
}
function paramId(context: Context<AppEnv>): string {
  const id = context.req.param('id');
  if (!id || !isUlid(id)) missing();
  return id;
}
function listFilter(context: Context<AppEnv>): ListFilter {
  const query = context.req.query();
  const filter: ListFilter = { limit: parseLimit(query.limit), trash: query.trash === '1' };
  if (query.trash !== undefined && query.trash !== '1') badRequest('trash');
  if (query.pinned !== undefined && query.pinned !== '1') badRequest('pinned');
  if (query.pinned === '1') filter.pinned = true;
  if (query.cursor !== undefined) { if (!isUlid(query.cursor)) badRequest('cursor'); filter.cursor = query.cursor; }
  if (query.type !== undefined) {
    if (query.type !== 'image' && query.type !== 'pdf' && query.type !== 'file') badRequest('type');
    filter.type = query.type;
  }
  if (query.tag !== undefined) filter.tag = normalizeTag(query.tag);
  if (query.q !== undefined) {
    const q = query.q.trim();
    if (Array.from(q).length > SEARCH_MAX) badRequest('q');
    filter.q = `%${escapeLike(q)}%`;
  }
  for (const field of ['since', 'until'] as const) {
    const value = query[field];
    if (value !== undefined) {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 0xffffffffffff) badRequest(field);
      filter[field] = field === 'since' ? ulidFloor(Number(value)) : ulidCeil(Number(value));
    }
  }
  return filter;
}

export function fileRoutes(app: Hono<AppEnv>, cache: FileCaches): void {
  app.post('/api/upload', async (context) => {
    const size = length(context, MAX_UPLOAD_BYTES);
    const shaHeader = context.req.header('X-Content-Sha256');
    const sha = shaHeader === undefined ? null : parseSha(shaHeader);
    const dims = dimensions(context);
    const body = context.req.raw.body;
    if (!body) throw new HttpError(400, 'EMPTY_FILE', 'File is empty.');
    const repo = createRepo(context.env.DB);
    const stats = await cache.getStats(context.env.DB);
    if (stats.bytes + stats.trashBytes + size > STORAGE_CAP_BYTES) throw new HttpError(507, 'STORAGE_FULL', 'Storage is nearly full. Empty the Trash or delete files.');
    const settings = await cache.getSettings(context.env.DB);
    if (sha) {
      const existing = await repo.bySha(sha);
      if (existing) return ok(context, { duplicate: true, file: fileDTO(existing, settings) });
    }
    const { prefix, stream } = await peekPrefix(body, SNIFF_BYTES);
    const mime = sniffMime(prefix) ?? 'application/octet-stream';
    const id = ulid();
    const key = `f/${id}`;
    const storage = storageFor(context.env);
    try { await storage.putStream(key, stream, size, { size, at: ulidTime(id) }); }
    catch (error) { putError(error); }
    let decoded = 'file';
    const name = context.req.header('X-File-Name');
    if (name !== undefined && name.length <= 600) { try { decoded = decodeURIComponent(name); } catch { decoded = 'file'; } }
    const row: FileRow = { id, name: sanitizeName(decoded, mime), mime, size, ...(mime.startsWith('image/') ? dims : {width:null,height:null}), thumb_size: 0, note: '', pinned: 0, created_at: ulidTime(id), deleted_at: null, tags: '[]' };
    try { await repo.insert(row, sha); }
    catch (error) {
      await storage.deleteMany([key]);
      const message = error instanceof Error ? error.message : '';
      if (sha && /unique/i.test(message) && /sha256|idx_files_sha_active/i.test(message)) {
        const existing = await repo.bySha(sha);
        if (existing) return ok(context, { duplicate: true, file: fileDTO(existing, settings) });
      }
      throw new HttpError(500, 'INTERNAL', 'An internal error occurred.');
    }
    cache.adjustStats([], [row]);
    return context.json({ ok: true, duplicate: false, file: fileDTO(row, settings) }, 201);
  });

  app.post('/api/upload/check', async (context) => {
    const body = await parseJsonBody(context, JSON_LIMITS.check);
    if (!Array.isArray(body.hashes) || body.hashes.length < 1 || body.hashes.length > CHECK_MAX_HASHES || !body.hashes.every((value): value is string => typeof value === 'string')) badRequest('hashes');
    const hashes = body.hashes.map(parseSha);
    return ok(context, { existing: await createRepo(context.env.DB).check(hashes) });
  });

  app.post('/api/thumb', async (context) => {
    const id = context.req.query('id');
    if (!id || !isUlid(id)) badRequest('id');
    length(context, MAX_THUMB_BYTES);
    const dims = dimensions(context);
    const repo = createRepo(context.env.DB);
    const row = await repo.get(id);
    if (!row || row.deleted_at !== null) missing();
    if (!row.mime.startsWith('image/')) throw new HttpError(409, 'NOT_IMAGE', 'File is not an image.');
    const bytes = await context.req.arrayBuffer();
    if (bytes.byteLength > MAX_THUMB_BYTES || !jpegMagicOk(new Uint8Array(bytes))) throw new HttpError(415, 'UNSUPPORTED_TYPE', 'Thumbnail must be JPEG.');
    try { await storageFor(context.env).putBytes(`t/${id}`, bytes, { size: bytes.byteLength, at: context.get('now')() }); }
    catch (error) { putError(error); }
    await repo.setThumb(id, bytes.byteLength, dims.width, dims.height);
    const after = await repo.get(id);
    cache.adjustStats([row], after ? [after] : []);
    return ok(context, { thumbSize: bytes.byteLength });
  });

  app.get('/api/files', async (context) => {
    const filter = listFilter(context);
    const rows = await createRepo(context.env.DB).list(filter);
    const more = rows.length > filter.limit;
    if (more) rows.pop();
    const settings = await cache.getSettings(context.env.DB);
    return ok(context, { files: rows.map((row) => fileDTO(row, settings)), nextCursor: more ? rows.at(-1)!.id : null });
  });

  app.post('/api/files/bulk', async (context) => {
    const body = await parseJsonBody(context, JSON_LIMITS.bulk);
    const actions: BulkAction[] = ['trash', 'restore', 'pin', 'unpin', 'tag_add', 'tag_remove', 'purge'];
    if (typeof body.action !== 'string' || !actions.includes(body.action as BulkAction)) badRequest('action');
    const action = body.action as BulkAction;
    const maximum = action === 'purge' ? PURGE_MAX_PER_CALL : BULK_MAX_IDS;
    if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > maximum || !body.ids.every((id): id is string => typeof id === 'string' && isUlid(id)) || new Set(body.ids).size !== body.ids.length) badRequest('ids');
    const ids = body.ids;
    let tag: string | undefined;
    if (action === 'tag_add' || action === 'tag_remove') { if (typeof body.tag !== 'string') badRequest('tag'); tag = normalizeTag(body.tag); }
    const repo = createRepo(context.env.DB);
    const before = await repo.rowsByIds(ids);
    let affected: number;
    if (action === 'purge') {
      affected = await purgeRows(repo, before.filter((row) => row.deleted_at !== null), storageFor(context.env), cache, true);
    } else {
      affected = await repo.bulk(action, ids, context.get('now')(), tag);
      cache.adjustStats(before, await repo.rowsByIds(ids));
    }
    return ok(context, { affected, requested: ids.length });
  });

  app.post('/api/trash/empty', async (context) => {
    const repo = createRepo(context.env.DB);
    const rows = await repo.oldestTrash(EMPTY_TRASH_MAX_PER_CALL);
    const purged = await purgeRows(repo, rows, storageFor(context.env), cache, true);
    return ok(context, { purged, remaining: await repo.trashCount() });
  });

  app.get('/api/files/:id', async (context) => {
    const row = await createRepo(context.env.DB).get(paramId(context));
    if (!row) missing();
    return ok(context, { file: fileDTO(row, await cache.getSettings(context.env.DB)) });
  });
  for (const kind of ['original', 'thumb'] as const) {
    app.get(`/api/files/:id/${kind}`, async (context) => {
      const row = await createRepo(context.env.DB).get(paramId(context));
      if (!row) missing();
      return serveFile(context, row, kind === 'thumb', storageFor(context.env));
    });
  }
  app.patch('/api/files/:id', async (context) => {
    const id = paramId(context);
    const body = await parseJsonBody(context, JSON_LIMITS.patch);
    const repo = createRepo(context.env.DB);
    const row = await repo.get(id);
    if (!row) missing();
    if (row.deleted_at !== null) throw new HttpError(409, 'IN_TRASH', 'Restore this file before editing.');
    const patch: FilePatch = {};
    if (body.name !== undefined) { if (typeof body.name !== 'string') badRequest('name'); patch.name = sanitizeName(body.name, row.mime); }
    if (body.note !== undefined) {
      if (typeof body.note !== 'string' || Array.from(body.note).length > NOTE_MAX) badRequest('note');
      patch.note = body.note.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');
    }
    if (body.pinned !== undefined) { if (typeof body.pinned !== 'boolean') badRequest('pinned'); patch.pinned = body.pinned; }
    if (body.tags !== undefined) patch.tags = parseTags(body.tags);
    if (!Object.keys(patch).length) badRequest('fields');
    await repo.patch(id, patch);
    const after = await repo.get(id);
    if (!after) missing();
    return ok(context, { file: fileDTO(after, await cache.getSettings(context.env.DB)) });
  });
  app.delete('/api/files/:id', async (context) => {
    const id = paramId(context);
    const repo = createRepo(context.env.DB);
    const before = await repo.get(id);
    if (!before) missing();
    await repo.bulk('trash', [id], context.get('now')());
    const after = await repo.get(id);
    cache.adjustStats([before], after ? [after] : []);
    return ok(context);
  });
  app.post('/api/files/:id/restore', async (context) => {
    const id = paramId(context);
    const repo = createRepo(context.env.DB);
    const before = await repo.get(id);
    if (!before) missing();
    await repo.bulk('restore', [id], context.get('now')());
    const after = await repo.get(id);
    if (!after) missing();
    if (after.deleted_at !== null) throw new HttpError(409, 'DUPLICATE_EXISTS', 'An active duplicate already exists.');
    cache.adjustStats([before], [after]);
    return ok(context, { file: fileDTO(after, await cache.getSettings(context.env.DB)) });
  });
  app.delete('/api/files/:id/permanent', async (context) => {
    const repo = createRepo(context.env.DB);
    const row = await repo.get(paramId(context));
    if (!row) missing();
    if (row.deleted_at === null) throw new HttpError(409, 'NOT_IN_TRASH', 'Move this file to Trash first.');
    await purgeRows(repo, [row], storageFor(context.env), cache, false);
    return ok(context);
  });
  app.get('/api/tags', async (context) => ok(context, { tags: await createRepo(context.env.DB).tags() }));
  app.get('/api/stats', async (context) => ok(context, { ...await cache.getStats(context.env.DB) }));
  app.get('/api/settings', async (context) => ok(context, { ...await cache.getSettings(context.env.DB) }));
  app.patch('/api/settings', async (context) => {
    const body = await parseJsonBody(context, JSON_LIMITS.settings);
    const fields = ['autoExpireDays', 'trashDays'] as const;
    if (!fields.some((field) => body[field] !== undefined)) badRequest('settings');
    for (const field of fields) {
      if (body[field] !== undefined && (typeof body[field] !== 'number' || !(field === 'autoExpireDays' ? AUTO_EXPIRE_DAYS : TRASH_DAYS).includes(body[field]))) badRequest(field);
    }
    const previous = await cache.getSettings(context.env.DB);
    const settings: SettingsDTO = { autoExpireDays: body.autoExpireDays as number | undefined ?? previous.autoExpireDays, trashDays: body.trashDays as number | undefined ?? previous.trashDays };
    await createRepo(context.env.DB).setSettings(settings);
    cache.setSettings(settings);
    return ok(context, { ...settings });
  });
}

async function purgeRows(repo: FileRepo, rows: FileRow[], storage: Storage, cache: FileCaches, reportQuota: boolean): Promise<number> {
  if (!rows.length) return 0;
  const deleted = await repo.purge(rows.map((row) => row.id));
  cache.adjustStats(deleted, []);
  const result = await storage.deleteMany(deleted.flatMap((row) => row.thumb_size > 0 ? [`f/${row.id}`, `t/${row.id}`] : [`f/${row.id}`]));
  if (reportQuota && result.quotaExceeded) dailyLimit();
  return deleted.length;
}
