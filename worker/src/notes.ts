import type { Context, Hono } from 'hono';
import type { AppEnv } from './env';
import { HttpError, ok, parseJsonBody } from './http';
import { JSON_LIMITS } from './limits';
import { NOTE_CHUNK_CHARS, NOTE_ID, NOTE_PAGE_CHUNKS, type NoteMeta } from '../../shared/notes';

interface NoteRow { id: string; version: string; chunks: number; created_at: number; updated_at: number }
const dto = (row: NoteRow): NoteMeta => ({ id: row.id, version: row.version, chunks: row.chunks, createdAt: row.created_at, updatedAt: row.updated_at });
function bad(): never { throw new HttpError(400, 'BAD_REQUEST', 'Invalid note request.'); }
function conflict(): never { throw new HttpError(409, 'NOTE_CONFLICT', 'This block changed on another device. Review the newer version before saving.'); }
function missing(): never { throw new HttpError(404, 'NOT_FOUND', 'Note block not found.'); }
function id(value: unknown): string { if (typeof value !== 'string' || !NOTE_ID.test(value)) bad(); return value; }
function version(value: unknown): string { if (value === '0') return value; return id(value); }
function integer(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) bad(); return value; }
const note = (context: Context<AppEnv>, noteId: string) => context.env.DB.prepare('SELECT id, version, chunks, created_at, updated_at FROM notes WHERE id = ?1').bind(noteId).first<NoteRow>();

export function noteRoutes(app: Hono<AppEnv>): void {
  app.get('/api/notes', async (context) => {
    const revision = (await context.env.DB.prepare('SELECT revision FROM notes_state WHERE id = 1').first<{ revision: number }>())!.revision;
    const since = context.req.query('since'), cursor = context.req.query('cursor');
    if (since !== undefined && !/^\d{1,16}$/.test(since)) bad();
    if (cursor !== undefined) id(cursor);
    if (!cursor && since === String(revision)) return ok(context, { revision, unchanged: true });
    const rows = (await context.env.DB.prepare('SELECT id, version, chunks, created_at, updated_at FROM notes WHERE id > ?1 ORDER BY id LIMIT 51').bind(cursor ?? '').all<NoteRow>()).results;
    const more = rows.length > 50;
    if (more) rows.pop();
    return ok(context, { revision, notes: rows.map(dto), nextCursor: more ? rows.at(-1)!.id : null });
  });
  app.post('/api/notes', async (context) => {
    const body = await parseJsonBody(context, JSON_LIMITS.noteMeta);
    const noteId = id(body.id), now = context.get('now')();
    await context.env.DB.prepare('INSERT OR IGNORE INTO notes (id, created_at, updated_at) VALUES (?1, ?2, ?2)').bind(noteId, now).run();
    const row = await note(context, noteId);
    if (!row) missing();
    return ok(context, { note: dto(row) });
  });
  app.get('/api/notes/:id', async (context) => {
    const noteId = id(context.req.param('id'));
    const expected = context.req.query('version') === undefined ? null : version(context.req.query('version'));
    const position = context.req.query('cursor') ?? '0';
    if (!/^\d{1,16}$/.test(position)) bad();
    const start = integer(Number(position));
    const row = await note(context, noteId);
    if (!row) missing();
    if (expected === null) return ok(context, { note: dto(row) });
    if (row.version !== expected) conflict();
    const chunks = (await context.env.DB.prepare('SELECT c.position, c.text FROM note_chunks c JOIN notes n ON n.id = c.note_id AND n.version = c.version WHERE c.note_id = ?1 AND c.version = ?2 AND c.position >= ?3 ORDER BY c.position LIMIT ?4').bind(noteId, expected, start, NOTE_PAGE_CHUNKS).all<{ position: number; text: string }>()).results;
    const count = Math.min(NOTE_PAGE_CHUNKS, Math.max(0, row.chunks - start));
    if (chunks.length !== count || chunks.some((chunk, index) => chunk.position !== start + index)) conflict();
    return ok(context, { note: dto(row), text: chunks.map(chunk => chunk.text).join(''), nextCursor: start + count < row.chunks ? start + count : null });
  });
  app.put('/api/notes/:id/chunks/:version/:position', async (context) => {
    const noteId = id(context.req.param('id')), next = id(context.req.param('version'));
    const position = context.req.param('position');
    if (!/^\d{1,16}$/.test(position)) bad();
    const part = integer(Number(position));
    const body = await parseJsonBody(context, JSON_LIMITS.noteChunk);
    const base = version(body.baseVersion);
    if (typeof body.text !== 'string' || body.text.length > NOTE_CHUNK_CHARS || next === base) bad();
    const result = await context.env.DB.prepare('INSERT OR REPLACE INTO note_chunks (note_id, version, position, text, staged_at) SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM notes WHERE id = ?1 AND version = ?6)').bind(noteId, next, part, body.text, context.get('now')(), base).run();
    if (!result.meta.changes) { if (!await note(context, noteId)) missing(); conflict(); }
    return ok(context);
  });
  app.post('/api/notes/:id/commit', async (context) => {
    const noteId = id(context.req.param('id'));
    const body = await parseJsonBody(context, JSON_LIMITS.noteMeta);
    const base = version(body.baseVersion), next = id(body.version), count = integer(body.chunks);
    if (next === base) bad();
    // Readers only see a complete immutable version after this compare-and-swap.
    await context.env.DB.batch([
      context.env.DB.prepare('UPDATE notes SET version = ?1, chunks = ?2, updated_at = ?3 WHERE id = ?4 AND version = ?5 AND (SELECT COUNT(*) FROM note_chunks WHERE note_id = ?4 AND version = ?1) = ?2 AND (?2 = 0 OR ((SELECT MIN(position) FROM note_chunks WHERE note_id = ?4 AND version = ?1) = 0 AND (SELECT MAX(position) FROM note_chunks WHERE note_id = ?4 AND version = ?1) = ?2 - 1))').bind(next, count, context.get('now')(), noteId, base),
      context.env.DB.prepare('DELETE FROM note_chunks WHERE note_id = ?1 AND version = ?3 AND EXISTS (SELECT 1 FROM notes WHERE id = ?1 AND version = ?2)').bind(noteId, next, base),
    ]);
    const row = await note(context, noteId);
    if (!row) missing();
    if (row.version !== next) conflict();
    return ok(context, { note: dto(row) });
  });
  app.delete('/api/notes/:id', async (context) => {
    const noteId = id(context.req.param('id'));
    const body = await parseJsonBody(context, JSON_LIMITS.noteMeta);
    const expected = version(body.version);
    const result = await context.env.DB.prepare('DELETE FROM notes WHERE id = ?1 AND version = ?2').bind(noteId, expected).run();
    if (!result.meta.changes && await note(context, noteId)) conflict();
    return ok(context);
  });
}
