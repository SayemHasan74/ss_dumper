import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JSON_LIMITS } from '../src/limits';
import { fixture, silenceEvents } from './helpers';

beforeEach(silenceEvents);
afterEach(() => vi.restoreAllMocks());
it('clears the browser cache on both sign-out routes', async () => {
  const f = await fixture(), cookie = await f.getCookie();
  for (const path of ['/api/auth/logout', '/api/auth/logout-all']) {
    const response = await f.request(path, { method: 'POST', headers: { Cookie: cookie, 'x-dump-client': '1' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Clear-Site-Data')).toBe('"cache"');
  }
});
it('defines all JSON limits in one place', () => {
  expect(JSON_LIMITS).toEqual({ login: 1024, settings: 1024, patch: 4096, check: 8192, bulk: 16384 });
});
it('hides thrown database or storage details in generic 500 responses', async () => {
  const f = await fixture();
  vi.spyOn(f.stores, 'getAttempt').mockRejectedValue(new Error('SQL SELECT internal-id f/private-key stack-trace'));
  const response = await f.login();
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'An internal error occurred.' } });
});
it('unknown and OPTIONS methods receive the not-found envelope after authentication', async () => {
  const f = await fixture(), cookie = await f.getCookie();
  for (const method of ['OPTIONS', 'PUT', 'CUSTOM']) {
    const response = await f.request('/api/files', { method, headers: { Cookie: cookie, 'x-dump-client': '1' } });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  }
});
