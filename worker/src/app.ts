import { Hono } from 'hono';
import type { AppEnv } from './env';
import { EPOCH_CACHE_MS } from './auth/config';
import { gate, type EpochCache } from './auth/gate';
import { authRoutes } from './auth/routes';
import { d1Stores, type Stores } from './auth/stores';
import { fail, HttpError, ok } from './http';
import { securityHeaders } from './middleware/headers';

export function createApp(deps: { stores?: Stores; now?: () => number } = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const now = deps.now ?? Date.now;
  let cached: { value: number; at: number } | undefined;
  const epoch: EpochCache = {
    async get(stores) {
      const time = now();
      if (!cached || time - cached.at >= EPOCH_CACHE_MS) cached = { value: await stores.getEpoch(), at: time };
      return cached.value;
    },
    set(value) { cached = { value, at: now() }; },
  };
  app.use('*', async (context, next) => {
    context.set('stores', deps.stores ?? d1Stores(context.env.DB));
    context.set('now', now);
    await next();
  });
  app.use('/api/*', securityHeaders);
  app.use('/api/*', gate(epoch));
  app.get('/api/health', (context) => ok(context));
  authRoutes(app, epoch);
  app.notFound((context) => fail(context, new HttpError(404, 'NOT_FOUND', 'Route not found.')));
  app.onError((error, context) => fail(context, error instanceof HttpError ? error : new HttpError(500, 'INTERNAL', 'An internal error occurred.')));
  return app;
}
