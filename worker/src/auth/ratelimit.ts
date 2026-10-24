import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { HttpError } from '../http';
import { sha256Hex } from './crypto';
import type { Attempt } from './stores';

export async function ipHash(context: Context<AppEnv>): Promise<string> {
  return (await sha256Hex(`${context.req.header('CF-Connecting-IP') ?? 'local'}|${context.env.SESSION_SECRET}`)).slice(0, 32);
}
export function lockout(attempt: Attempt | null, now: number, windowMs: number, maximum: number): void {
  if (attempt && attempt.failCount >= maximum && now < attempt.windowStart + windowMs) {
    throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts.', Math.ceil((attempt.windowStart + windowMs - now) / 1000));
  }
}
