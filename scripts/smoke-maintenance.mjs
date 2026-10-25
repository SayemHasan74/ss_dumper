import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makePng } from './lib/png.mjs';

const base = new URL(process.env.SMOKE_BASE_URL ?? 'http://localhost:8787');
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.protocol !== 'http:') throw new Error('Maintenance smoke test is local-only; it changes retention settings and runs cleanup.');
const key = process.env.SMOKE_ACCESS_KEY;
if (!key) throw new Error('Set SMOKE_ACCESS_KEY for the local server.');
// Windows npx.cmd cannot be executed without a shell. Run the installed Wrangler
// Node entrypoint with the same argument array, never through cmd.exe.
const cli = resolve('node_modules/wrangler/bin/wrangler.js');
const flags = [...(process.env.SMOKE_WRANGLER_CONFIG ? ['--config', process.env.SMOKE_WRANGLER_CONFIG] : []), ...(process.env.SMOKE_PERSIST_TO ? ['--persist-to', process.env.SMOKE_PERSIST_TO] : [])];
const wrangler = (...args) => execFileSync(process.execPath, [cli, ...args, '--local', ...flags], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
const sql = command => JSON.parse(wrangler('d1', 'execute', 'dump-db', '--json', '--command', command))[0].results;
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function idAt(ms) {
  let time = '';
  for (let i = 0; i < 10; i++) { time = alphabet[ms % 32] + time; ms = Math.floor(ms / 32); }
  let bits = 0, buffer = 0, suffix = '';
  for (const byte of randomBytes(10)) { buffer = (buffer << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; suffix += alphabet[(buffer >>> bits) & 31]; } buffer &= (1 << bits) - 1; }
  return time + suffix;
}
function check(condition, label) { console.log(`${condition ? 'PASS' : 'FAIL'} ${label}`); if (!condition) throw new Error(label); }
const now = Date.now(), day = 86400000;
const expired = idAt(now - 60 * day), pinned = idAt(now - 40 * day), trashed = idAt(now - 60 * day), old = idAt(now - 7200000), fresh = idAt(now), repair = idAt(now - 40 * day);
const ids = [expired, pinned, trashed, old, fresh, repair];
const directory = mkdtempSync(join(tmpdir(), 'dump-maintenance-')), path = join(directory, 'tiny.png');
const png = makePng(2, 2, randomBytes(4).readUInt32BE()); writeFileSync(path, png);
let saved;
try {
  saved = sql("SELECT key, value FROM settings WHERE key IN ('auto_expire_days','trash_days','orphan_cursor')");
  sql("UPDATE settings SET value='30' WHERE key='auto_expire_days'; UPDATE settings SET value='7' WHERE key='trash_days'; INSERT OR REPLACE INTO settings(key,value) VALUES('orphan_cursor','')");
  for (const [id, pin, deleted] of [[expired, 0, 'NULL'], [pinned, 1, 'NULL'], [trashed, 0, now - 40 * day], [repair, 1, 'NULL']]) {
    sql(`INSERT INTO files(id,name,mime,size,created_at,pinned,deleted_at,thumb_size) VALUES('${id}','maintenance-test.png','image/png',${png.length},${now - 60 * day},${pin},${deleted},${id === trashed ? png.length : 0})`);
  }
  for (const [keyName, at] of [[`f/${expired}`, now - 60 * day], [`f/${pinned}`, now - 40 * day], [`f/${trashed}`, now - 60 * day], [`t/${trashed}`, now - 60 * day], [`f/${old}`, now - 7200000], [`f/${fresh}`, now], [`f/${repair}`, now - 40 * day], [`t/${repair}`, now - 7200000]]) {
    wrangler('kv', 'key', 'put', keyName, '--binding=FILES', '--path', path, '--metadata', JSON.stringify({ size: png.length, at }));
  }
  const login = await fetch(new URL('/api/auth/login', base), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-dump-client': '1' }, body: JSON.stringify({ key }) });
  if (!login.ok) throw new Error('Local login failed.');
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  const response = await fetch(new URL('/api/maintenance/run', base), { method: 'POST', headers: { Cookie: cookie, 'x-dump-client': '1' } });
  if (!response.ok) throw new Error(`Maintenance returned ${response.status}; if rate-limited wait 60 seconds.`);
  const result = await response.json();
  const rows = sql(`SELECT id,deleted_at,thumb_size FROM files WHERE id IN (${ids.map(id => `'${id}'`).join(',')})`);
  const byId = new Map(rows.map(row => [row.id, row]));
  const keys = new Set(JSON.parse(wrangler('kv', 'key', 'list', '--binding=FILES')).map(object => object.name));
  check(byId.get(expired)?.deleted_at > 0, 'old unpinned file moved to Trash');
  check(byId.get(pinned)?.deleted_at === null, 'pinned file exempt from expiration');
  check(!byId.has(trashed) && !keys.has(`f/${trashed}`) && !keys.has(`t/${trashed}`), 'old Trash row and both objects purged');
  check(!keys.has(`f/${old}`), 'old orphan deleted');
  check(keys.has(`f/${fresh}`), 'fresh orphan kept for one-hour safety window');
  check(byId.get(repair)?.thumb_size === png.length && keys.has(`t/${repair}`), 'thumbnail metadata repaired');
  check(result.ok && result.ops <= 400 && result.kvMutations <= 250, 'operation budgets respected');
  console.log(`Maintenance counters: ops=${result.ops}, kvMutations=${result.kvMutations}`);
} catch (error) { console.error(`FAIL ${error instanceof Error ? error.message : 'Maintenance test failed.'}`); process.exitCode = 1; }
finally {
  try {
    sql(`DELETE FROM file_tags WHERE file_id IN (${ids.map(id => `'${id}'`).join(',')}); DELETE FROM files WHERE id IN (${ids.map(id => `'${id}'`).join(',')})`);
    for (const id of ids) for (const prefix of ['f', 't']) wrangler('kv', 'key', 'delete', `${prefix}/${id}`, '--binding=FILES');
    if (saved) {
      // Values are existing local settings; escape literals, not shell strings.
      const quote = value => `'${value.replaceAll("'", "''")}'`;
      sql("DELETE FROM settings WHERE key='orphan_cursor';" + saved.map(row => `INSERT OR REPLACE INTO settings(key,value) VALUES(${quote(row.key)},${quote(row.value)})`).join(';'));
    }
  } catch { console.error('FAIL maintenance fixture cleanup; inspect the isolated local state.'); process.exitCode = 1; }
  unlinkSync(path);
  rmdirSync(directory);
}
