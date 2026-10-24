import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const accessKey = randomBytes(32).toString('base64url');
const uploadToken = randomBytes(32).toString('base64url');
const sessionSecret = randomBytes(32).toString('base64url');
const hash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const secrets = {
  ACCESS_KEY_HASH: hash(accessKey),
  UPLOAD_TOKEN_HASH: hash(uploadToken),
  SESSION_SECRET: sessionSecret,
};

if (process.argv.includes('--write-dev-vars')) {
  writeFileSync(new URL('../.dev.vars', import.meta.url),
    Object.entries(secrets).map(([name, value]) => `${name}=${value}`).join('\n') + '\n',
    { mode: 0o600 });
}

console.log('Save these in your password manager now. They are never stored in plaintext anywhere and cannot be recovered.');
console.log(`ACCESS_KEY: ${accessKey}`);
console.log(`UPLOAD_TOKEN: ${uploadToken}`);
for (const [name, value] of Object.entries(secrets)) {
  console.log(`\nnpx wrangler secret put ${name}`);
  console.log(`Value to paste: ${value}`);
}
