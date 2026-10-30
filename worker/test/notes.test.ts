import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fixture, silenceEvents } from './helpers';
import { splitNote, NOTE_CHUNK_CHARS } from '../../shared/notes';

interface SQLite {
  exec(sql: string): void;
  prepare(sql: string): { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown; run(...args: unknown[]): { changes: number } };
  close(): void;
}
let sqlite: SQLite | undefined;
beforeEach(silenceEvents);
afterEach(() => { sqlite?.close(); sqlite = undefined; vi.restoreAllMocks(); });
async function setup() {
  const { DatabaseSync } = await vi.importActual<{ DatabaseSync: new (file: string) => SQLite }>('node:sqlite');
  const { readFileSync } = await vi.importActual<{ readFileSync(file: string, encoding: string): string }>('node:fs');
  sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync('migrations/0002_notes.sql', 'utf8'));
  const f = await fixture();
  const database = sqlite;
  function prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind: (...args: unknown[]) => { values = args; return statement; },
      first: async () => database.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: database.prepare(sql).all(...values) }),
      run: async () => ({ meta: { changes: Number(database.prepare(sql).run(...values).changes) } }),
    };
    return statement;
  }
  f.env.DB = { prepare, batch: async (statements: { run(): Promise<unknown> }[]) => {
    database.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); database.exec('COMMIT'); return results; } catch (error) { database.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  const cookie = await f.getCookie();
  const request = (path: string, method = 'GET', json?: unknown) => f.request(path, { method, headers: { Cookie: cookie, 'x-dump-client': '1', 'Content-Type': 'application/json' }, ...(json === undefined ? {} : { body: JSON.stringify(json) }) });
  const id = crypto.randomUUID();
  const create = () => request('/api/notes', 'POST', { id });
  const put = (base: string, version: string, position: number, text: string) => request(`/api/notes/${id}/chunks/${version}/${position}`, 'PUT', { baseVersion: base, text });
  const commit = (base: string, version: string, chunks: number) => request(`/api/notes/${id}/commit`, 'POST', { baseVersion: base, version, chunks });
  return { ...f, id, request, create, put, commit, database };
}
it('stores large Unicode text without a block character cap or splitting surrogate pairs', () => {
  const text = 'x'.repeat(NOTE_CHUNK_CHARS - 1) + '😀বাংলা\n'.repeat(300000);
  const chunks = splitNote(text);
  expect(chunks.join('')).toBe(text);
  expect(chunks.every(chunk => chunk.length <= NOTE_CHUNK_CHARS && !/[\ud800-\udbff]$/.test(chunk))).toBe(true);
  expect(splitNote('')).toEqual([]);
});
it('publishes complete revisions atomically, supports empty cut text, and deletes all chunks', async () => {
  const f = await setup(), next = crypto.randomUUID();
  expect((await f.create()).status).toBe(200);
  const first = await (await f.request('/api/notes')).json() as { revision: number };
  expect(await (await f.request(`/api/notes?since=${first.revision}`)).json()).toMatchObject({ unchanged: true });
  await f.put('0', next, 0, '<script>alert("not executed")</script>\nবাংলা😀');
  expect(await (await f.request(`/api/notes/${f.id}?version=0`)).json()).toMatchObject({ text: '' });
  expect((await f.commit('0', next, 2)).status).toBe(409);
  expect((await f.commit('0', next, 1)).status).toBe(200);
  const read = await f.request(`/api/notes/${f.id}?version=${next}`);
  expect(read.headers.get('Cache-Control')).toBe('no-store');
  expect(await read.json()).toMatchObject({ text: expect.stringContaining('বাংলা😀') });
  const empty = crypto.randomUUID();
  expect((await f.commit(next, empty, 0)).status).toBe(200);
  expect(await (await f.request(`/api/notes/${f.id}?version=${empty}`)).json()).toMatchObject({ text: '' });
  expect((await f.request(`/api/notes/${f.id}`, 'DELETE', { version: empty })).status).toBe(200);
  expect(f.database.prepare('SELECT COUNT(*) AS count FROM note_chunks').get()).toEqual({ count: 0 });
});
it('rejects stale writes and deletes, and retries a committed version without deleting a newer draft', async () => {
  const f = await setup(), a = crypto.randomUUID(), b = crypto.randomUUID();
  await f.create(); await f.put('0', a, 0, 'device A'); await f.put('0', b, 0, 'device B');
  await f.commit('0', a, 1);
  expect((await f.commit('0', b, 1)).status).toBe(409);
  expect((await f.put('0', b, 1, 'stale')).status).toBe(409);
  expect((await f.request(`/api/notes/${f.id}`, 'DELETE', { version: '0' })).status).toBe(409);
  const c = crypto.randomUUID(); await f.put(a, c, 0, 'newer draft');
  expect((await f.commit('0', a, 1)).status).toBe(200);
  expect((await f.commit(a, c, 1)).status).toBe(200);
  expect(await (await f.request(`/api/notes/${f.id}?version=${c}`)).json()).toMatchObject({ text: 'newer draft' });
});
it('round-trips a block larger than the D1 row limit through bounded chunks and read pages', async () => {
  const f = await setup(), next = crypto.randomUUID();
  const text = 'z'.repeat(2100000) + '\nবাংলা😀';
  await f.create();
  const parts = splitNote(text);
  for (let i = 0; i < parts.length; i++) expect((await f.put('0', next, i, parts[i])).status).toBe(200);
  expect((await f.commit('0', next, parts.length)).status).toBe(200);
  let cursor: number | null = 0, restored = '';
  do {
    const response = await f.request(`/api/notes/${f.id}?version=${next}&cursor=${cursor}`);
    expect(response.status).toBe(200);
    const page = await response.json() as { text: string; nextCursor: number | null };
    expect(page.text.length).toBeLessThanOrEqual(NOTE_CHUNK_CHARS * 4);
    restored += page.text; cursor = page.nextCursor;
  } while (cursor !== null);
  expect(restored).toBe(text);
});
it('enforces explicit byte/chunk limits and CSRF without logging note text', async () => {
  const f = await setup(); await f.create();
  expect((await f.put('0', crypto.randomUUID(), 0, 'x'.repeat(NOTE_CHUNK_CHARS + 1))).status).toBe(400);
  expect((await f.request('/api/notes', 'POST', { id: f.id, padding: 'x'.repeat(1024) })).status).toBe(413);
  const cookie = await f.getCookie();
  expect((await f.request(`/api/notes/${f.id}`, 'DELETE', { version: '0' })).status).toBe(200);
  expect((await f.app.request('https://dump.test/api/notes', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID() }) }, f.env)).status).toBe(403);
});
