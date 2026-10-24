import { expect, it } from 'vitest';
import { fixture, upload } from './helpers';
import { MAX_UPLOAD_BYTES } from '../src/files/config';

it('rejects invalid uploads before touching absent D1 or KV bindings', async () => {
  const f = await fixture();
  const send = (path: string, headers: Record<string,string> = {}, body?: string) => f.request(path,{method:'POST',headers:{Authorization:`Bearer ${upload}`,...headers},body});
  expect((await send('/api/upload')).status).toBe(411);
  expect((await send('/api/upload',{'Content-Length':String(MAX_UPLOAD_BYTES+1)})).status).toBe(413);
  expect((await send('/api/upload',{'Content-Length':'16','X-Content-Sha256':'bad'})).status).toBe(400);
  expect((await send('/api/upload',{'Content-Length':'16','X-Width':'0','X-Height':'2'})).status).toBe(400);
  expect((await send('/api/upload',{'Content-Length':'16','X-Width':'2'})).status).toBe(400);
  expect((await send('/api/upload',{'Content-Length':'16'})).status).toBe(400);
  expect((await send('/api/thumb')).status).toBe(400);
  expect((await send('/api/thumb?id=bad')).status).toBe(400);
  expect((await send('/api/upload/check',{'Content-Type':'application/json'},JSON.stringify({hashes:Array(51).fill('a'.repeat(64))}))).status).toBe(400);
  expect((await send('/api/upload/check',{'Content-Type':'text/plain'},'{}')).status).toBe(415);
});
