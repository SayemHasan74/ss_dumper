import { createHash, randomBytes } from 'node:crypto';
import { makePng } from './lib/png.mjs';

const args = process.argv.slice(2);
const count = Number(args.find((arg) => !arg.startsWith('--')) ?? 300);
const base = new URL(process.env.SMOKE_BASE_URL ?? 'http://localhost:8787');
const token = process.env.SMOKE_UPLOAD_TOKEN;
if (!Number.isSafeInteger(count) || count < 1 || args.some((arg) => arg.startsWith('--') && arg !== '--force')) {
  console.error('Usage: node scripts/seed.mjs [count=300] [--force]'); process.exit(1);
}
if (base.protocol === 'https:' && !args.includes('--force')) {
  console.error('Refusing HTTPS seeding without --force: each file consumes a live KV write.'); process.exit(1);
}
if (!token) { console.error('Set SMOKE_UPLOAD_TOKEN for the target server.'); process.exit(1); }
let seed = randomBytes(4).readUInt32BE();
let index = 0;
let complete = 0;
let stopped = false;
async function upload() {
  while (!stopped) {
    const current = index++;
    if (current >= count) return;
    const bytes = makePng(64, 64, ++seed);
    const response = await fetch(new URL('/api/upload', base), {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length), 'X-File-Name': encodeURIComponent(`seed-${seed}.png`), 'X-Content-Sha256': createHash('sha256').update(bytes).digest('hex'), 'X-Width': '64', 'X-Height': '64' }, body: bytes,
    });
    if (!response.ok) { stopped = true; throw new Error(`Seeding stopped with HTTP ${response.status}.`); }
    await response.arrayBuffer();
    complete += 1;
    if (complete % 100 === 0 || complete === count) console.log(`Seeded ${complete} / ${count}`);
  }
}
const results = await Promise.allSettled(Array.from({ length: 4 }, () => upload()));
if (results.some((result) => result.status === 'rejected')) { console.error('Seeding failed; check the local server and its quota.'); process.exitCode = 1; }
