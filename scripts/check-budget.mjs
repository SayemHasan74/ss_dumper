import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const dist = new URL('../dist/', import.meta.url);
const html = readFileSync(new URL('index.html', dist), 'utf8');
const js = new Set();
const css = new Set();

for (const match of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
  const attributes = new Map();
  for (const attribute of match[2].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attributes.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4]);
  }
  const tag = match[1].toLowerCase();
  const rel = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/);
  if (tag === 'script' && attributes.has('src')) js.add(attributes.get('src'));
  if (tag === 'link' && rel.includes('modulepreload') && attributes.has('href')) js.add(attributes.get('href'));
  if (tag === 'link' && rel.includes('stylesheet') && attributes.has('href')) css.add(attributes.get('href'));
}

function gzipTotal(paths) {
  let total = 0;
  for (const path of paths) {
    if (/^(?:[a-z]+:)?\/\//i.test(path)) throw new Error('External initial assets are not allowed.');
    const asset = new URL(path.replace(/^\//, '').split(/[?#]/)[0], dist);
    if (!asset.href.startsWith(dist.href)) throw new Error('Asset is outside the build directory.');
    total += gzipSync(readFileSync(asset)).byteLength;
  }
  return total;
}

const jsBytes = gzipTotal(js);
const cssBytes = gzipTotal(css);
console.log(`Initial JS gzip: ${jsBytes} bytes / ${40 * 1024} bytes`);
console.log(`Initial CSS gzip: ${cssBytes} bytes / ${10 * 1024} bytes`);
if (jsBytes > 40 * 1024 || cssBytes > 10 * 1024) {
  console.error('Initial bundle budget exceeded.');
  process.exitCode = 1;
}
