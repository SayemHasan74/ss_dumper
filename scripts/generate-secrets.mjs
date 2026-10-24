import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const onlyFlag = args.find((arg) => arg.startsWith('--only='));
const only = onlyFlag?.slice('--only='.length);
if (args.some((arg) => arg !== '--write-dev-vars' && arg !== onlyFlag) || (only !== undefined && !['access', 'upload', 'session'].includes(only))) {
  console.error('Usage: node scripts/generate-secrets.mjs [--only=access|upload|session] [--write-dev-vars]');
  process.exit(1);
}
const accessKey = !only || only === 'access' ? randomBytes(32).toString('base64url') : undefined;
const uploadToken = !only || only === 'upload' ? randomBytes(32).toString('base64url') : undefined;
const sessionSecret = !only || only === 'session' ? randomBytes(32).toString('base64url') : undefined;
const hash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const secrets = {
  ...(accessKey ? { ACCESS_KEY_HASH: hash(accessKey) } : {}),
  ...(uploadToken ? { UPLOAD_TOKEN_HASH: hash(uploadToken) } : {}),
  ...(sessionSecret ? { SESSION_SECRET: sessionSecret } : {}),
};

if (args.includes('--write-dev-vars')) {
  const target = new URL('../.dev.vars', import.meta.url);
  const existing = only && existsSync(target)
    ? Object.fromEntries(readFileSync(target, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
      const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
    }).filter(([name]) => ['ACCESS_KEY_HASH', 'UPLOAD_TOKEN_HASH', 'SESSION_SECRET'].includes(name))) : {};
  writeFileSync(target,
    Object.entries({ ...existing, ...secrets }).map(([name, value]) => `${name}=${value}`).join('\n') + '\n',
    { mode: 0o600 });
}

if (accessKey || uploadToken) console.log('Save these in your password manager now. They are never stored in plaintext anywhere and cannot be recovered.');
if (accessKey) console.log(`ACCESS_KEY: ${accessKey}`);
if (uploadToken) console.log(`UPLOAD_TOKEN: ${uploadToken}`);
for (const [name, value] of Object.entries(secrets)) {
  console.log(`\nnpx wrangler secret put ${name}`);
  console.log(`Value to paste: ${value}`);
}
