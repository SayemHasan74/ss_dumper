import { Hono } from 'hono';
import type { AppEnv } from './env';
import { EPOCH_CACHE_MS } from './auth/config';
import { gate, type EpochCache } from './auth/gate';
import { authRoutes } from './auth/routes';
import { d1Stores, type Stores } from './auth/stores';
import { fail, HttpError, ok } from './http';
import { securityHeaders } from './middleware/headers';
import type { SettingsDTO, StatsDTO } from '../../shared/types';
import { SETTINGS_CACHE_MS, STATS_CACHE_MS } from './files/config';
import { createRepo, type FileRow } from './files/repo';
import { fileRoutes, type FileCaches } from './files/routes';
import { runMaintenance } from './maintenance';
import { noteRoutes } from './notes';

export function createApp(deps: { stores?: Stores; now?: () => number } = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const now = deps.now ?? Date.now;
  let settingsCache: { value: SettingsDTO; at: number } | undefined;
  let statsCache: { value: StatsDTO; at: number } | undefined;
  const fileCaches: FileCaches = {
    async getSettings(db) {
      if (!settingsCache || now() - settingsCache.at >= SETTINGS_CACHE_MS) settingsCache = { value: await createRepo(db).getSettings(), at: now() };
      return settingsCache.value;
    },
    setSettings(value) { settingsCache = { value, at: now() }; },
    async getStats(db) {
      if (!statsCache || now() - statsCache.at >= STATS_CACHE_MS) statsCache = { value: await createRepo(db).stats(), at: now() };
      return statsCache.value;
    },
    adjustStats(before, after) {
      if (!statsCache) return;
      const adjust = (row: FileRow, sign: number) => {
        const trash = row.deleted_at !== null;
        statsCache!.value[trash ? 'trashCount' : 'count'] += sign;
        if (!trash && row.mime.startsWith('image/')) statsCache!.value.photoCount += sign;
        statsCache!.value[trash ? 'trashBytes' : 'bytes'] += sign * (row.size + row.thumb_size);
      };
      before.forEach((row) => adjust(row, -1));
      after.forEach((row) => adjust(row, 1));
    },
  };
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
  fileRoutes(app, fileCaches);
  noteRoutes(app);
  let lastMaintenance = -Infinity;
  app.post('/api/maintenance/run', async (context) => {
    const time = now();
    if (time - lastMaintenance < 60000) throw new HttpError(429, 'RATE_LIMITED', 'Wait a minute before running cleanup again.', Math.ceil((60000 - (time - lastMaintenance)) / 1000));
    lastMaintenance = time;
    const result = await runMaintenance(context.env, time);
    statsCache = undefined;
    return ok(context, { ...result });
  });
  app.notFound((context) => fail(context, new HttpError(404, 'NOT_FOUND', 'Route not found.')));
  app.onError((error, context) => fail(context, error instanceof HttpError ? error : new HttpError(500, 'INTERNAL', 'An internal error occurred.')));
  return app;
}
