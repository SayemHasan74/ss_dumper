export interface Env {
  DB: D1Database;
  FILES: KVNamespace;
  ASSETS: Fetcher;
  ACCESS_KEY_HASH: string;
  UPLOAD_TOKEN_HASH: string;
  SESSION_SECRET: string;
}
