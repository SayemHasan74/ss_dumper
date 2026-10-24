import { authState } from '../auth';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly retryAfterSec?: number) { super(message); }
}
interface Options { method?: string; json?: unknown; signal?: AbortSignal }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export async function api<T>(path: string, opts: Options = {}): Promise<T & { ok: true }> {
  const method = opts.method ?? 'GET';
  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, 30000);
    opts.signal?.addEventListener('abort', abort, { once: true });
    if (opts.signal?.aborted) abort();
    let response: Response;
    try {
      response = await fetch(path, {
        method, credentials: 'same-origin', signal: controller.signal,
        headers: { 'x-dump-client': '1', Accept: 'application/json', ...(opts.json === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(opts.json === undefined ? {} : { body: JSON.stringify(opts.json) }),
      });
      if (response.status === 401 && path !== '/api/auth/login') authState.value = 'out';
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body) || body.ok !== true) {
        const error = isRecord(body) && isRecord(body.error) ? body.error : {};
        throw new ApiError(response.status, typeof error.code === 'string' ? error.code : 'INTERNAL',
          typeof error.message === 'string' ? error.message : 'Something went wrong.',
          typeof error.retryAfterSec === 'number' ? error.retryAfterSec : undefined);
      }
      return body as T & { ok: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof SyntaxError) throw new ApiError(response!.status, 'INTERNAL', 'Invalid server response.');
      if (method !== 'GET' || attempt >= 2 || opts.signal?.aborted) throw new ApiError(0, 'NETWORK', "Can't reach the server.");
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', abort);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, attempt === 0 ? 300 : 900));
  }
}
