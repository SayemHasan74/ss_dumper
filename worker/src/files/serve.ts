import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { HttpError } from '../http';
import type { FileRow } from './repo';
import type { Storage } from './storage';

export function contentDisposition(name: string, download: boolean): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${download ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
export async function serveFile(context: Context<AppEnv>, row: FileRow, thumbnail: boolean, storage: Storage): Promise<Response> {
  if (thumbnail && !row.thumb_size) throw new HttpError(404, 'NO_THUMB', 'Thumbnail not available.');
  const etag = `"${row.id}${thumbnail ? `-${row.thumb_size}` : ''}"`;
  const headers = new Headers({
    ETag: etag, 'Accept-Ranges': 'none',
    'Content-Type': thumbnail ? 'image/jpeg' : row.mime,
    'Content-Disposition': contentDisposition(row.name, context.req.query('download') === '1'),
    'Cache-Control': 'private, max-age=31536000, immutable', Vary: 'Cookie, Authorization',
  });
  if (thumbnail || row.mime.startsWith('image/')) headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  const conditional = context.req.header('If-None-Match');
  if (conditional?.split(',').some((value) => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag)) return new Response(null, { status: 304, headers });
  headers.set('Content-Length', String(thumbnail ? row.thumb_size : row.size));
  if (context.req.method === 'HEAD') return new Response(null, { status: 200, headers });
  const object = await storage.get(`${thumbnail ? 't' : 'f'}/${row.id}`);
  if (!object) {
    console.log(JSON.stringify({ evt: 'kv_missing' }));
    context.header('Retry-After', '2');
    throw new HttpError(404, 'NOT_FOUND', 'File not available yet. Try again.');
  }
  return new Response(object.body, { status: 200, headers });
}
