import { createApp } from './app';
import type { Env } from './env';

export default {
  fetch: createApp().fetch,
  async scheduled() {},
} satisfies ExportedHandler<Env>;
