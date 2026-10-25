import { expect, it, vi } from 'vitest';
import { createRepo } from '../src/files/repo';

it('counts all saved images beyond the first gallery page, excluding PDFs and Trash', async () => {
  const { DatabaseSync } = await vi.importActual<{
    DatabaseSync: new (path: string) => {
      exec(sql: string): void;
      prepare(sql: string): { all(): unknown[] };
      close(): void;
    };
  }>('node:sqlite');
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('CREATE TABLE files (mime TEXT, deleted_at INTEGER, size INTEGER, thumb_size INTEGER)');
    const db = {
      prepare: (sql: string) => ({ sql }),
      batch: async (statements: { sql: string }[]) => statements.map(({ sql }) => ({ results: sqlite.prepare(sql).all() })),
    } as unknown as D1Database;
    expect((await createRepo(db).stats()).photoCount).toBe(0);
    for (let i = 0; i < 70; i++) sqlite.exec("INSERT INTO files VALUES ('image/jpeg', NULL, 100, 10)");
    sqlite.exec("INSERT INTO files VALUES ('application/pdf', NULL, 200, 0), ('image/png', 1, 100, 10)");
    expect(await createRepo(db).stats()).toMatchObject({ photoCount: 70, count: 71, trashCount: 1 });
    sqlite.exec("UPDATE files SET deleted_at = 1 WHERE mime = 'image/jpeg'");
    expect((await createRepo(db).stats()).photoCount).toBe(0);
    sqlite.exec("UPDATE files SET deleted_at = NULL WHERE mime = 'image/jpeg'");
    expect((await createRepo(db).stats()).photoCount).toBe(70);
  } finally { sqlite.close(); }
});
