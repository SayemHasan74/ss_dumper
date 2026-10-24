import { vi } from 'vitest';
import { createApp } from '../src/app';
import { sha256Hex } from '../src/auth/crypto';
import { memoryStores } from '../src/auth/stores';
import type { Env } from '../src/env';

export const access = 'A'.repeat(43);
export const upload = 'B'.repeat(43);
export const secret = 'S'.repeat(43);
export const start = 1792843200000;
export async function fixture() {
  const env = { ACCESS_KEY_HASH: await sha256Hex(access), UPLOAD_TOKEN_HASH: await sha256Hex(upload), SESSION_SECRET: secret } as Env;
  const stores = memoryStores();
  let time = start;
  const app = createApp({ stores, now: () => time });
  const request = (path: string, init: RequestInit = {}) => app.request(`https://dump.test${path}`, init, env);
  const login = (key = access, headers: Record<string, string> = {}) => request('/api/auth/login', {
    method: 'POST', headers: { 'x-dump-client': '1', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ key }),
  });
  const getCookie = async () => (await login()).headers.get('Set-Cookie')!.split(';')[0];
  return { app, env, stores, request, login, getCookie, advance: (ms: number) => { time += ms; }, clock: () => time };
}
export function silenceEvents(): void { vi.spyOn(console, 'log').mockImplementation(() => {}); }
