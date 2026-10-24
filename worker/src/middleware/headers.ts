import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';

export const securityHeaders: MiddlewareHandler<AppEnv> = async (context, next) => {
  await next();
  const defaults = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  };
  for (const [name, value] of Object.entries(defaults)) if (!context.res.headers.has(name)) context.header(name, value);
};
