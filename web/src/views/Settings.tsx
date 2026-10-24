import { useEffect, useState } from 'preact/hooks';
import type { SettingsDTO, StatsDTO } from '../../../shared/types';
import { authState, logout } from '../auth';
import { api } from '../lib/api';
import { bytes } from '../lib/format';
import { navigate } from '../lib/router';
import { dataVersion, settings } from '../store/files';
import { showToast } from '../store/ui';
import { confirmAction } from '../components/Dialog';
import { Icon } from '../components/Icon';

export function Settings() {
  const [stats, setStats] = useState<StatsDTO | null>(null), [error, setError] = useState(false), [saving, setSaving] = useState(false);
  async function load(): Promise<void> { const version = dataVersion; setError(false); try { const stats = await api<StatsDTO>('/api/stats'), result = await api<SettingsDTO>('/api/settings'); if (version === dataVersion && authState.peek() === 'in') { setStats(stats); settings.value = result; } } catch { setError(true); } }
  useEffect(() => { void load(); }, []);
  async function save(changes: Partial<SettingsDTO>): Promise<void> {
    const previous = settings.peek(), version = dataVersion; if (!previous) return;
    setSaving(true); settings.value = { ...previous, ...changes };
    try { const result = await api<SettingsDTO>('/api/settings', { method: 'PATCH', json: changes }); if (version === dataVersion && authState.peek() === 'in') settings.value = result; }
    catch { if (version === dataVersion && authState.peek() === 'in') { settings.value = previous; showToast("Couldn't save settings. Try again.", undefined, true); } }
    finally { setSaving(false); }
  }
  const ratio = stats ? (stats.bytes + stats.trashBytes) / stats.capBytes : 0;
  return <><header class="app-header"><div class="header-row page-width"><button class="icon-button" aria-label="Back to gallery" onClick={() => navigate('/')}><Icon name="chevron-left" /></button><h1 class="app-title">Settings</h1><span /></div></header><main class="settings-page page-width">
    {error && <p role="status">Couldn't load settings. <button class="text-button" onClick={() => void load()}>Retry</button></p>}
    <section><h2>Storage</h2>{stats ? <><progress class={ratio > .95 ? 'usage danger' : ratio > .8 ? 'usage warning' : 'usage'} max={1} value={Math.min(1, ratio)} aria-label="Storage used" /><p>{bytes(stats.bytes + stats.trashBytes)} of {bytes(stats.capBytes)} · {stats.count} files; Trash {bytes(stats.trashBytes)}</p></> : <p>Loading…</p>}<p class="form-hint">Free plan: about 400 uploads per day. The daily limit resets at 06:00 Dhaka time.</p></section>
    <section><h2>Auto-delete</h2><label>Move unpinned files to Trash after<select disabled={saving || !settings.value} value={settings.value?.autoExpireDays ?? 30} onChange={(event) => void save({ autoExpireDays: Number(event.currentTarget.value) })}>{[0, 7, 14, 30, 60, 90].map((days) => <option value={days} key={days}>{days ? `${days} days after upload` : 'Never'}</option>)}</select></label></section>
    <section><h2>Trash retention</h2><label>Delete trashed files forever after<select disabled={saving || !settings.value} value={settings.value?.trashDays ?? 7} onChange={(event) => void save({ trashDays: Number(event.currentTarget.value) })}>{[1, 3, 7, 14, 30].map((days) => <option value={days} key={days}>{days} days</option>)}</select></label></section>
    <section><h2>Security</h2><button class="text-button" onClick={() => void logout().catch(() => showToast("Couldn't sign out. Try again.", undefined, true))}>Sign out</button><button class="text-button danger-text" onClick={async () => { if (!await confirmAction('Sign out everywhere?')) return; try { await api('/api/auth/logout-all', { method: 'POST' }); authState.value = 'out'; } catch { showToast("Couldn't sign out everywhere. Try again.", undefined, true); } }}>Sign out everywhere</button></section>
    <section><h2>About</h2><p>Dump {__APP_VERSION__} · {__BUILD_DATE__}</p></section>
  </main></>;
}
