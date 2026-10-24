import { signal } from '@preact/signals';
import { api, ApiError } from './lib/api';

export const authState = signal<'unknown' | 'in' | 'out'>('unknown');
export const bootError = signal(false);

export async function bootAuth(): Promise<void> {
  bootError.value = false;
  authState.value = 'unknown';
  try {
    const session = await api<{ scope: 'full' | 'upload' }>('/api/auth/session');
    authState.value = session.scope === 'full' ? 'in' : 'out';
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) authState.value = 'out';
    else bootError.value = true;
  }
}
export async function login(key: string): Promise<void> {
  await api('/api/auth/login', { method: 'POST', json: { key } });
  authState.value = 'in';
}
export async function logout(): Promise<void> {
  await api('/api/auth/logout', { method: 'POST' });
  authState.value = 'out';
}
