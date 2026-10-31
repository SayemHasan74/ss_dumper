import { Hono } from 'hono';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppEnv } from '../src/env';
import { fail, HttpError } from '../src/http';
import { securityHeaders } from '../src/middleware/headers';
import type { FileRow } from '../src/files/repo';
import { contentDisposition, serveFile } from '../src/files/serve';
import type { Storage } from '../src/files/storage';

afterEach(() => vi.restoreAllMocks());
const row: FileRow = { id:'01K8AZ40000000000000000000',name:'photo.png',mime:'image/png',size:16,width:null,height:null,thumb_size:12,note:'',pinned:0,created_at:0,deleted_at:null,tags:'[]' };
function fixture(missing = false, thumbnail = false, file = row) {
  const get = vi.fn(async () => missing ? null : {body:new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(16));c.close();}}),meta:{size:16,at:0}});
  const app = new Hono<AppEnv>();
  app.use('*',securityHeaders);
  app.get('/file',c=>serveFile(c,file,thumbnail,{get} as unknown as Storage));
  app.onError((error,c)=>fail(c,error instanceof HttpError ? error : new HttpError(500,'INTERNAL','Internal error.')));
  return {get,request:(init:RequestInit={})=>app.request('https://dump.test/file',init)};
}
it('answers HEAD and conditional GET without reading storage', async () => {
  const f=fixture();
  const head=await f.request({method:'HEAD'});
  expect(head.status).toBe(200);
  expect(head.headers.get('Content-Length')).toBe('16');
  for(const value of [`"${row.id}"`,'*',`"other", W/"${row.id}"`]) {
    const response=await f.request({headers:{'If-None-Match':value}});
    expect(response.status).toBe(304);
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
    expect(response.headers.get('Vary')).toBe('Cookie, Authorization');
  }
  expect(f.get).not.toHaveBeenCalled();
});
it('serves the entire body for Range requests with one storage read', async () => {
  const f=fixture(); const response=await f.request({headers:{Range:'bytes=0-9'}});
  expect(response.status).toBe(200);
  expect((await response.arrayBuffer()).byteLength).toBe(16);
  expect(response.headers.get('Accept-Ranges')).toBe('none');
  expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
  expect(f.get).toHaveBeenCalledExactlyOnceWith(`f/${row.id}`);
});
it('returns a retryable, non-cacheable error for missing KV data', async () => {
  vi.spyOn(console,'log').mockImplementation(()=>{});
  const f=fixture(true); const response=await f.request();
  expect(response.status).toBe(404);
  expect(response.headers.get('Retry-After')).toBe('2');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('ETag')).toBeNull();
  expect(console.log).toHaveBeenCalledExactlyOnceWith('{"evt":"kv_missing"}');
});
it('uses thumbnail-specific ETags and MIME', async () => {
  const f=fixture(false,true); const response=await f.request();
  expect(response.headers.get('ETag')).toBe(`"${row.id}-12"`);
  expect(response.headers.get('Content-Type')).toBe('image/jpeg');
  await response.body?.cancel();
});
it('encodes header values safely for quotes, CR/LF and Unicode', () => {
  const header=contentDisposition('a"\r\nবাংলা\\.png',true);
  expect(header.startsWith('attachment; filename="')).toBe(true);
  expect(header).not.toMatch(/[\r\n]/);
  expect(header).toContain("filename*=UTF-8''");
  expect(header).toContain('%22%0D%0A');
});
it('forces untrusted general files to inert attachment downloads, including HTML and SVG names',async()=>{
  for(const name of ['page.html','drawing.svg','source.ts','README.md','archive.zip']){
    const response=await fixture(false,false,{...row,name,mime:'application/octet-stream'}).request();
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(response.headers.get('Content-Disposition')).toMatch(/^attachment;/);
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    await response.body?.cancel();
  }
});
