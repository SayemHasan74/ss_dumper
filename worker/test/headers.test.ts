import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fixture, silenceEvents } from './helpers';

beforeEach(silenceEvents);
afterEach(() => vi.restoreAllMocks());
it('sets security headers on success, 401, 404 and generic 500', async () => {
  const f = await fixture();
  f.app.get('/api/test-error', () => { throw new Error('sensitive internal detail'); });
  const cookie = await f.getCookie();
  const responses = [await f.request('/api/health'), await f.request('/api/nope'), await f.request('/api/nope', { headers: { Cookie: cookie } }), await f.request('/api/test-error', { headers: { Cookie: cookie } })];
  expect(responses.map(response => response.status)).toEqual([200, 401, 404, 500]);
  for (const response of responses) {
    for (const [name, value] of Object.entries({
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Frame-Options': 'DENY', 'Strict-Transport-Security': 'max-age=31536000', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
    })) expect(response.headers.get(name)).toBe(value);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  }
  expect(await responses[3].json()).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'An internal error occurred.' } });
});
it('preserves handler overrides', async () => {
  const f = await fixture();
  f.app.get('/api/test-cache', context => {
    context.header('Cache-Control', 'private, max-age=60');
    context.header('Vary', 'Cookie, Authorization');
    context.header('Content-Security-Policy', "default-src 'none'; sandbox");
    return context.json({ ok: true });
  });
  const response = await f.request('/api/test-cache', { headers: { Cookie: await f.getCookie() } });
  expect(response.headers.get('Cache-Control')).toBe('private, max-age=60');
  expect(response.headers.get('Vary')).toBe('Cookie, Authorization');
  expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
});
