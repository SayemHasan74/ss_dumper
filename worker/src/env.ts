import type { Stores } from './auth/stores';

export interface Env {
  DB: D1Database;
  FILES: KVNamespace;
  ASSETS: Fetcher;
  ACCESS_KEY_HASH: string;
  UPLOAD_TOKEN_HASH: string;
  SESSION_SECRET: string;
}

export type Scope = 'full' | 'upload';
export interface Variables { stores: Stores; scope: Scope; now: () => number }
export type AppEnv = { Bindings: Env; Variables: Variables };
