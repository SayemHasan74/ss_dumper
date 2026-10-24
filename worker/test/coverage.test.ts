import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PUBLIC_ROUTES, UPLOAD_SCOPE_ROUTES } from '../src/policy';
import { fixture, silenceEvents, upload } from './helpers';

beforeEach(silenceEvents);
afterEach(() => vi.restoreAllMocks());
it('every non-public registered route denies anonymous requests and enforces bearer scope', async () => {
  const f = await fixture();
  const seen = new Set<string>();
  for (const route of f.app.routes) {
    if (route.method === 'ALL' || route.path.includes('*')) continue;
    const method = route.method === 'HEAD' ? 'GET' : route.method;
    const path = route.path.replace(/:[^/]+/g, 'x');
    const key = `${method} ${path}`;
    if (PUBLIC_ROUTES.includes(key) || seen.has(key)) continue;
    seen.add(key);
    expect((await f.request(path, { method })).status, key).toBe(401);
    const response = await f.request(path, { method, headers: { Authorization: `Bearer ${upload}` } });
    if (UPLOAD_SCOPE_ROUTES.includes(key)) expect(response.status, key).toBeGreaterThanOrEqual(200);
    else { expect(response.status, key).toBe(403); expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN_SCOPE' } }); }
    if (UPLOAD_SCOPE_ROUTES.includes(key)) expect(response.status, key).toBeLessThan(300);
  }
  expect(seen.size).toBeGreaterThan(0);
});
