import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { EPOCH_CACHE_MS, LOGIN_WINDOW_MS, SESSION_RENEW_THRESHOLD_MS, SESSION_SLIDING_MS } from '../src/auth/config';
import { sha256Hex } from '../src/auth/crypto';
import { verifySession } from '../src/auth/session';
import { access, fixture, secret, silenceEvents, start, upload } from './helpers';

beforeEach(silenceEvents);
afterEach(() => vi.restoreAllMocks());
describe('authentication flow', () => {
  it('logs in and sets exact HTTPS and local HTTP cookie attributes', async () => {
    const f = await fixture();
    const response = await f.login(` ${access}\n`);
    expect(response.status).toBe(200);
    const cookie = response.headers.get('Set-Cookie')!;
    expect(cookie).toMatch(/^__Host-dump_session=/);
    for (const value of ['Path=/', 'Max-Age=2592000', 'HttpOnly', 'Secure', 'SameSite=Strict']) expect(cookie).toContain(value);
    expect(cookie).not.toContain('Domain=');
    const local = await f.app.request('http://localhost/api/auth/login', { method: 'POST', headers: { 'x-dump-client': '1', 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify({ key: access }) }, f.env);
    expect(local.status).toBe(200);
    expect(local.headers.get('Set-Cookie')).toMatch(/^dump_session=/);
    expect(local.headers.get('Set-Cookie')).not.toContain('Secure');
  });
  it('returns identical failures for malformed and wrong keys', async () => {
    const f = await fixture();
    const bad = await f.login('bad');
    const wrong = await f.login('C'.repeat(43));
    expect([bad.status, wrong.status]).toEqual([401, 401]);
    expect(await bad.json()).toEqual(await wrong.json());
  });
  it.each<Record<string, string>>([
    { 'x-dump-client': '' }, { Origin: 'https://evil.test' }, { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' },
  ])('rejects login CSRF %j', async (headers) => {
    const response = await (await fixture()).login(access, headers);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'CSRF' } });
  });
  it('enforces media type, declared and actual byte limits, JSON and field types', async () => {
    const f = await fixture();
    const send = (body: string, headers: Record<string, string> = {}) => f.request('/api/auth/login', { method: 'POST', headers: { 'x-dump-client': '1', 'Content-Type': 'application/json', ...headers }, body });
    expect((await send('{}', { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await send('{}', { 'Content-Length': '1025' })).status).toBe(413);
    expect((await send(JSON.stringify({ key: 'ক'.repeat(400) }))).status).toBe(413);
    for (const body of ['{', '[]', 'null', '{}', '{"key":1}']) expect((await send(body)).status).toBe(400);
  });
  it('returns five failures then locks out even the correct key; window expires', async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i += 1) expect((await f.login('wrong')).status).toBe(401);
    const locked = await f.login();
    expect(locked.status).toBe(429);
    expect(locked.headers.get('Retry-After')).toBe('900');
    expect(await locked.json()).toMatchObject({ error: { retryAfterSec: 900 } });
    f.advance(LOGIN_WINDOW_MS);
    expect((await f.login()).status).toBe(200);
  });
  it('clears failures on success and keeps per-IP counters separate', async () => {
    const f = await fixture();
    await f.login('wrong');
    await f.login();
    const id = `login:${(await sha256Hex(`local|${secret}`)).slice(0,32)}`;
    expect(await f.stores.getAttempt(id)).toBeNull();
    for (let i = 0; i < 5; i += 1) await f.login('wrong', { 'CF-Connecting-IP': '2001:db8::1' });
    expect((await f.login(access, { 'CF-Connecting-IP': '2001:db8::2' })).status).toBe(200);
  });
  it('authenticates the session, clears invalid cookies, and logs out idempotently', async () => {
    const f = await fixture();
    const cookie = await f.getCookie();
    expect(await (await f.request('/api/auth/session', { headers: { Cookie: cookie } })).json()).toEqual({ ok: true, authenticated: true, scope: 'full' });
    const invalid = await f.request('/api/auth/session', { headers: { Cookie: '__Host-dump_session=bad' } });
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get('Set-Cookie')).toContain('Max-Age=0');
    const out = await f.request('/api/auth/logout', { method: 'POST', headers: { 'x-dump-client': '1' } });
    expect(out.status).toBe(200);
    expect(out.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });
  it('ignores the cookie for the other protocol', async () => {
    const f = await fixture();
    const cookie = await f.getCookie();
    expect((await f.app.request('http://localhost/api/auth/session', { headers: { Cookie: cookie } }, f.env)).status).toBe(401);
  });
  it('protects cookie mutations and cross-site reads, including unknown routes', async () => {
    const f = await fixture();
    const cookie = await f.getCookie();
    expect((await f.request('/api/nope')).status).toBe(401);
    expect((await f.request('/api/nope', { headers: { Cookie: cookie } })).status).toBe(404);
    expect((await f.request('/api/auth/logout-all', { method: 'POST', headers: { Cookie: cookie } })).status).toBe(403);
    expect((await f.request('/api/auth/session', { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect((await f.request('/api/auth/session', { method: 'HEAD', headers: { Cookie: cookie } })).status).toBe(200);
    expect((await f.request('/api/nope', { method: 'OPTIONS', headers: { Cookie: cookie, 'x-dump-client': '1' } })).status).toBe(404);
  });
  it('logout-all invalidates this isolate immediately and others after cache TTL', async () => {
    const f = await fixture();
    const cookie = await f.getCookie();
    const other = createApp({ stores: f.stores, now: f.clock });
    const otherRequest = () => other.request('https://dump.test/api/auth/session', { headers: { Cookie: cookie } }, f.env);
    expect((await otherRequest()).status).toBe(200);
    expect((await f.request('/api/auth/logout-all', { method: 'POST', headers: { Cookie: cookie, 'x-dump-client': '1' } })).status).toBe(200);
    expect((await f.request('/api/auth/session', { headers: { Cookie: cookie } })).status).toBe(401);
    expect((await otherRequest()).status).toBe(200);
    f.advance(EPOCH_CACHE_MS - 1);
    expect((await otherRequest()).status).toBe(200);
    f.advance(1);
    expect((await otherRequest()).status).toBe(401);
  });
  it('renews cookies below threshold while preserving original issuance', async () => {
    const f = await fixture();
    const cookie = await f.getCookie();
    f.advance(SESSION_SLIDING_MS - SESSION_RENEW_THRESHOLD_MS);
    const request = () => f.request('/api/auth/session', { headers: { Cookie: cookie } });
    expect((await request()).headers.get('Set-Cookie')).toBeNull();
    f.advance(1);
    const renewed = (await request()).headers.get('Set-Cookie')!.split(';')[0].split('=')[1];
    expect((await verifySession(renewed, secret, f.clock(), 1))?.iat).toBe(start);
  });
  it('limits bearer scope, ignores cookies and skips CSRF for bearer requests', async () => {
    const f = await fixture();
    const cookie = await f.getCookie();
    const bearer = { Authorization: `Bearer ${upload}` };
    expect(await (await f.request('/api/auth/session', { headers: bearer })).json()).toEqual({ ok: true, authenticated: true, scope: 'upload' });
    const forbidden = await f.request('/api/auth/logout-all', { method: 'POST', headers: bearer });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ error: { code: 'FORBIDDEN_SCOPE' } });
    for (const value of ['Basic x', `Bearer  ${upload}`, `Bearer ${'C'.repeat(43)}`]) {
      expect((await f.request('/api/auth/session', { headers: { Authorization: value, Cookie: cookie } })).status).toBe(401);
    }
    expect((await f.request('/api/auth/session', { headers: { Authorization: `bEaReR ${upload}`, 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(200);
  });
  it('returns 429 on the tenth wrong bearer, but valid bearer still passes with zero DB access', async () => {
    const f = await fixture();
    for (let i = 1; i <= 10; i += 1) {
      expect((await f.request('/api/auth/session', { headers: { Authorization: `Bearer ${'C'.repeat(43)}` } })).status).toBe(i === 10 ? 429 : 401);
    }
    const noDB = createApp();
    expect((await noDB.request('https://dump.test/api/auth/session', { headers: { Authorization: `Bearer ${upload}` } }, f.env)).status).toBe(200);
    f.advance(LOGIN_WINDOW_MS);
    expect((await f.request('/api/auth/session', { headers: { Authorization: `Bearer ${'C'.repeat(43)}` } })).status).toBe(401);
  });
  it('fails closed on configuration errors without logging values', async () => {
    const f = await fixture();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const change of [{ ACCESS_KEY_HASH: '' }, { UPLOAD_TOKEN_HASH: 'bad' }, { SESSION_SECRET: 'short' }]) {
      const response = await f.app.request('https://dump.test/api/auth/login', { method: 'POST', headers: { 'x-dump-client': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ key: access }) }, { ...f.env, ...change });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'An internal error occurred.' } });
    }
    expect(log.mock.calls.every(([line]) => /^\{"evt":"config_error","name":"(ACCESS_KEY_HASH|UPLOAD_TOKEN_HASH|SESSION_SECRET)"\}$/.test(String(line)))).toBe(true);
  });
});
