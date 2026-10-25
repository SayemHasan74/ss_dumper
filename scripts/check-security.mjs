import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(`${dir}/${entry.name}`) : entry.name.endsWith('.ts') ? [`${dir}/${entry.name}`] : []);
const sources = files('worker/src').map(path => [path, readFileSync(path, 'utf8')]);
const calls = sources.filter(([path]) => !path.endsWith('/http.ts')).flatMap(([, source]) => [...source.matchAll(/await parseJsonBody\(context, ([^)]+)\)/g)].map(match => match[1]));
assert.deepEqual(calls.sort(), ['login', 'settings', 'patch', 'check', 'bulk'].map(key => `JSON_LIMITS.${key}`).sort());
for (const [path, source] of sources) {
  if (!path.endsWith('/storage.ts')) assert(!/\b(?:env|context\.env)\.FILES\b/.test(source), 'Direct KV access outside storage module');
  assert(!/\.req\.(?:json|text|blob)\(/.test(source), 'Unbounded body parser');
}
assert(!/r2_buckets|durable_objects|\[\[queues\./i.test(readFileSync('wrangler.toml', 'utf8')));
console.log('PASS centralized JSON-body limits, storage-module boundary and free binding configuration');
