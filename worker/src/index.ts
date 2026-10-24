import { Hono } from 'hono';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (context) => context.json({ ok: true }));

app.notFound((context) => context.json({
  ok: false,
  error: { code: 'NOT_FOUND', message: 'Route not found.' },
}, 404));

app.onError((_error, context) => context.json({
  ok: false,
  error: { code: 'INTERNAL', message: 'An internal error occurred.' },
}, 500));

export default {
  fetch: app.fetch,
  async scheduled() {},
} satisfies ExportedHandler<Env>;
