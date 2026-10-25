import { createApp } from './app';
import type { Env } from './env';
import { runMaintenance } from './maintenance';

export default {
  fetch: createApp().fetch,
  async scheduled(controller, env) { await runMaintenance(env, controller.scheduledTime); },
} satisfies ExportedHandler<Env>;
