import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { HttpError } from '../http';
import { PUBLIC_ROUTES, UPLOAD_SCOPE_ROUTES } from '../policy';
import { BEARER_MAX_FAILS, BEARER_WINDOW_MS, CSRF_HEADER } from './config';
import { sha256Hex, timingSafeEqual } from './crypto';
import { ipHash, lockout } from './ratelimit';
import { clearSessionCookie, createSession, readSessionCookie, setSessionCookie, shouldRenew, verifySession } from './session';
import type { Stores } from './stores';

export interface EpochCache { get(stores: Stores): Promise<number>; set(epoch: number): void }
export function checkConfig(context: Context<AppEnv>): void {
  for (const name of ['ACCESS_KEY_HASH', 'UPLOAD_TOKEN_HASH', 'SESSION_SECRET'] as const) {
    const value = context.env[name];
    if (typeof value !== 'string' || (name === 'SESSION_SECRET' ? value.length < 32 : !/^[a-f0-9]{64}$/i.test(value))) {
      console.error(JSON.stringify({ evt: 'config_error', name }));
      throw new HttpError(500, 'INTERNAL', 'An internal error occurred.');
    }
  }
}
export function csrfCheck(context: Context<AppEnv>): void {
  const reject = () => { throw new HttpError(403, 'CSRF', 'Request not allowed.'); };
  const site = context.req.header('Sec-Fetch-Site');
  if (site !== undefined && site !== 'same-origin' && site !== 'none') reject();
  const origin = context.req.header('Origin');
  if (origin !== undefined) {
    const target = new URL(context.req.url);
    let source: URL;
    try { source = new URL(origin); } catch { return reject(); }
    const local = target.hostname === 'localhost' || target.hostname === '127.0.0.1';
    if (local ? source.hostname !== target.hostname : source.origin !== target.origin) reject();
  }
  if (context.req.header(CSRF_HEADER) !== '1') reject();
}
export function gate(epoch: EpochCache): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const method = context.req.method === 'HEAD' ? 'GET' : context.req.method;
    const key = `${method} ${new URL(context.req.url).pathname}`;
    const unsafe = method !== 'GET';
    if (PUBLIC_ROUTES.includes(key)) {
      if (unsafe) csrfCheck(context);
      await next();
      return;
    }
    checkConfig(context);
    const authorization = context.req.header('Authorization');
    if (authorization !== undefined) {
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization)?.[1];
      if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required.');
      if (!timingSafeEqual(await sha256Hex(token), context.env.UPLOAD_TOKEN_HASH)) {
        const hash = await ipHash(context);
        const now = context.get('now')();
        const attempt = await context.get('stores').recordFailure(`bearer:${hash}`, now, BEARER_WINDOW_MS);
        console.log(JSON.stringify({ evt: 'bearer_fail', ip: hash.slice(0, 8) }));
        lockout(attempt, now, BEARER_WINDOW_MS, BEARER_MAX_FAILS);
        throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required.');
      }
      if (!UPLOAD_SCOPE_ROUTES.includes(key)) throw new HttpError(403, 'FORBIDDEN_SCOPE', 'Upload token cannot access this route.');
      context.set('scope', 'upload');
      await next();
      return;
    }
    const cookie = readSessionCookie(context);
    if (!cookie) {
      if (cookie !== undefined) clearSessionCookie(context);
      throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required.');
    }
    const now = context.get('now')();
    const currentEpoch = await epoch.get(context.get('stores'));
    const session = await verifySession(cookie, context.env.SESSION_SECRET, now, currentEpoch);
    if (!session) {
      clearSessionCookie(context);
      throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required.');
    }
    if (unsafe) csrfCheck(context);
    else if (context.req.header('Sec-Fetch-Site') === 'cross-site') throw new HttpError(403, 'CSRF', 'Request not allowed.');
    if (shouldRenew(session, now)) setSessionCookie(context, await createSession(context.env.SESSION_SECRET, now, currentEpoch, session.iat));
    context.set('scope', 'full');
    await next();
  };
}
