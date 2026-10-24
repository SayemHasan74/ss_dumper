import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class HttpError extends Error {
  constructor(public readonly status: ContentfulStatusCode, public readonly code: string, message: string, public readonly retryAfterSec?: number) { super(message); }
}
export function ok<T extends Record<string, unknown>>(context: Context, data?: T) {
  return context.json({ ok: true as const, ...data });
}
export function fail(context: Context, error: HttpError) {
  if (error.retryAfterSec !== undefined) context.header('Retry-After', String(error.retryAfterSec));
  return context.json({ ok: false, error: {
    code: error.code, message: error.message,
    ...(error.retryAfterSec === undefined ? {} : { retryAfterSec: error.retryAfterSec }),
  } }, error.status);
}

export async function parseJsonBody(context: Context, maxBytes: number): Promise<Record<string, unknown>> {
  const type = context.req.header('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.');
  const length = context.req.header('Content-Length');
  if (length && Number(length) > maxBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
  const reader = context.req.raw.body?.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
  }
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON body.'); }
}
