import type { Hono } from 'hono';
import type { AppEnv } from '../env';
import { HttpError, ok, parseJsonBody } from '../http';
import { KEY_REGEX, LOGIN_MAX_FAILS, LOGIN_WINDOW_MS } from './config';
import { JSON_LIMITS } from '../limits';
import { sha256Hex, timingSafeEqual } from './crypto';
import { checkConfig, type EpochCache } from './gate';
import { ipHash, lockout } from './ratelimit';
import { clearSessionCookie, createSession, setSessionCookie } from './session';

export function authRoutes(app: Hono<AppEnv>, epoch: EpochCache): void {
  app.post('/api/auth/login', async (context) => {
    const body = await parseJsonBody(context, JSON_LIMITS.login);
    if (typeof body.key !== 'string') throw new HttpError(400, 'BAD_REQUEST', 'Key must be a string.');
    const key = body.key.trim();
    checkConfig(context);
    const stores = context.get('stores');
    const now = context.get('now')();
    const hash = await ipHash(context);
    const identifier = `login:${hash}`;
    try { lockout(await stores.getAttempt(identifier), now, LOGIN_WINDOW_MS, LOGIN_MAX_FAILS); }
    catch (error) {
      if (error instanceof HttpError && error.status === 429) console.log(JSON.stringify({ evt: 'login_locked', ip: hash.slice(0, 8) }));
      throw error;
    }
    if (!KEY_REGEX.test(key) || !timingSafeEqual(await sha256Hex(key), context.env.ACCESS_KEY_HASH)) {
      await stores.recordFailure(identifier, now, LOGIN_WINDOW_MS);
      console.log(JSON.stringify({ evt: 'login_fail', ip: hash.slice(0, 8) }));
      throw new HttpError(401, 'INVALID_KEY', 'Invalid key.');
    }
    await stores.clearAttempt(identifier);
    const token = await createSession(context.env.SESSION_SECRET, now, await epoch.get(stores));
    setSessionCookie(context, token);
    console.log(JSON.stringify({ evt: 'login_ok' }));
    return ok(context, { scope: 'full' });
  });
  app.post('/api/auth/logout', (context) => { clearSessionCookie(context); context.header('Clear-Site-Data', '"cache"'); return ok(context); });
  app.post('/api/auth/logout-all', async (context) => {
    epoch.set(await context.get('stores').bumpEpoch());
    clearSessionCookie(context);
    context.header('Clear-Site-Data', '"cache"');
    console.log(JSON.stringify({ evt: 'logout_all' }));
    return ok(context);
  });
  app.get('/api/auth/session', (context) => ok(context, { authenticated: true, scope: context.get('scope') }));
}
