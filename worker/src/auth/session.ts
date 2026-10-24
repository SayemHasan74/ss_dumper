import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { b64urlDecode, b64urlEncode, hmacSign, hmacVerify, utf8 } from './crypto';
import { CLOCK_SKEW_MS, SESSION_ABSOLUTE_MS, SESSION_RENEW_THRESHOLD_MS, SESSION_SLIDING_MS } from './config';

export interface Session { iat: number; exp: number; ep: number }
export async function createSession(secret: string, now: number, epoch: number, iat = now): Promise<string> {
  const payload: Session = { iat, exp: Math.min(now + SESSION_SLIDING_MS, iat + SESSION_ABSOLUTE_MS), ep: epoch };
  const encoded = b64urlEncode(utf8(JSON.stringify(payload)));
  return `v1.${encoded}.${b64urlEncode(await hmacSign(secret, `v1.${encoded}`))}`;
}
export async function verifySession(token: string, secret: string, now: number, epoch: number): Promise<Session | null> {
  try {
    if (token.length > 400) return null;
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    const payloadBytes = b64urlDecode(parts[1]);
    const signature = b64urlDecode(parts[2]);
    if (!payloadBytes || !signature || !await hmacVerify(secret, `v1.${parts[1]}`, signature)) return null;
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(payloadBytes));
    if (!value || typeof value !== 'object') return null;
    const { iat, exp, ep } = value as Record<string, unknown>;
    if (typeof iat !== 'number' || typeof exp !== 'number' || typeof ep !== 'number') return null;
    if (![iat, exp, ep].every(Number.isSafeInteger)) return null;
    if (now >= exp || iat > now + CLOCK_SKEW_MS || now >= iat + SESSION_ABSOLUTE_MS || ep !== epoch) return null;
    return { iat, exp, ep };
  } catch { return null; }
}
export const shouldRenew = (session: Session, now: number): boolean => session.exp - now < SESSION_RENEW_THRESHOLD_MS;
function cookieOptions(context: Context) {
  return { path: '/', maxAge: 2592000, httpOnly: true, secure: new URL(context.req.url).protocol !== 'http:', sameSite: 'Strict' as const };
}
export const cookieName = (context: Context): string => new URL(context.req.url).protocol === 'http:' ? 'dump_session' : '__Host-dump_session';
export const readSessionCookie = (context: Context): string | undefined => getCookie(context, cookieName(context));
export const setSessionCookie = (context: Context, token: string): void => setCookie(context, cookieName(context), token, cookieOptions(context));
export function clearSessionCookie(context: Context): void { deleteCookie(context, cookieName(context), cookieOptions(context)); }
