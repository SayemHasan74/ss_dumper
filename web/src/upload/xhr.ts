export class UploadError extends Error {
  constructor(public status = 0, public code = 'NETWORK', public retryAfter = 0) { super('Upload request failed'); }
}
const recover = new Set<() => void>();
export function recoverRequests(): void { for (const check of recover) check(); }
export function xhr<T>(path: string, body: Blob | null, options: { headers?: Record<string, string>; signal?: AbortSignal; progress?: (value: number) => void; method?: 'GET' | 'POST'; timeout?: number } = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;
    let stalled: ReturnType<typeof setTimeout> | undefined;
    const watch = () => { clearTimeout(stalled); stalled = setTimeout(() => { finish(new UploadError(0, 'TIMEOUT')); request.abort(); }, 45000); };
    const abort = () => { request.abort(); finish(new UploadError(0, 'ABORT')); };
    const check = () => { if (request.readyState === XMLHttpRequest.DONE || request.readyState === XMLHttpRequest.UNSENT) finish(new UploadError()); };
    function finish(error?: UploadError, value?: T): void {
      if (settled) return;
      settled = true; recover.delete(check); options.signal?.removeEventListener('abort', abort);
      clearTimeout(stalled);
      if (error) reject(error); else resolve(value!);
    }
    request.open(options.method ?? 'POST', path);
    request.withCredentials = true;
    request.timeout = options.timeout ?? Math.ceil(30000 + (body?.size ?? 0) / (20 * 1024) * 1000);
    request.setRequestHeader('X-Dump-Client', '1');
    for (const [name, value] of Object.entries(options.headers ?? {})) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => { watch(); if (event.lengthComputable) options.progress?.(Math.min(1, event.loaded / event.total)); };
    request.onprogress = watch;
    request.onload = () => {
      let result: { ok?: boolean; error?: { code?: string } };
      try { result = JSON.parse(request.responseText) as typeof result; } catch { finish(new UploadError(request.status, 'INTERNAL')); return; }
      if (request.status >= 200 && request.status < 300 && result.ok) finish(undefined, result as T);
      else {
        const retry = request.getResponseHeader('Retry-After') ?? '';
        const seconds = Number(retry);
        finish(new UploadError(request.status, result.error?.code ?? 'INTERNAL', Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0));
      }
    };
    request.onerror = () => finish(new UploadError());
    request.ontimeout = () => finish(new UploadError(0, 'TIMEOUT'));
    request.onabort = () => finish(new UploadError(0, 'ABORT'));
    if (options.signal?.aborted) { finish(new UploadError(0, 'ABORT')); return; }
    options.signal?.addEventListener('abort', abort, { once: true });
    recover.add(check);
    watch();
    request.send(body);
  });
}
