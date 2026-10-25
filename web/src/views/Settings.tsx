import { useEffect, useState } from 'preact/hooks';
import type { SettingsDTO, StatsDTO } from '../../../shared/types';
import { authState, logout } from '../auth';
import { api, ApiError } from '../lib/api';
import { bytes } from '../lib/format';
import { navigate } from '../lib/router';
import { dataVersion, settings } from '../store/files';
import { showToast } from '../store/ui';
import { confirmAction } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { canInstall, installApp, installBusy, installed } from '../pwa/install';

export function Settings() {
  const [stats, setStats] = useState<StatsDTO | null>(null), [error, setError] = useState(false), [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  async function cleanup(): Promise<void> {
    const version = dataVersion;
    setCleaning(true);
    try {
      const result = await api<{ expired: number; purged: number; orphans: number; budgetExhausted: boolean }>('/api/maintenance/run', { method: 'POST' });
      if (version === dataVersion && authState.peek() === 'in') {
        showToast(`Cleanup: ${result.expired} moved to Trash, ${result.purged} purged, ${result.orphans} orphans removed.${result.budgetExhausted ? ' More work remains for the next run.' : ''}`);
        await load();
      }
    } catch (error) { if (version === dataVersion && authState.peek() === 'in') showToast(error instanceof ApiError ? error.message : "Couldn't run cleanup. Try again.", undefined, true); }
    finally { setCleaning(false); }
  }
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
  const uploadUrl = `${location.origin}/api/upload`;
  return <><header class="app-header"><div class="header-row page-width"><button class="icon-button" aria-label="Back to gallery" onClick={() => navigate('/')}><Icon name="chevron-left" /></button><h1 class="app-title">Settings</h1><span /></div></header><main class="settings-page page-width">
    {error && <p role="status">Couldn't load settings. <button class="text-button" onClick={() => void load()}>Retry</button></p>}
    <section><h2>Storage</h2>{stats ? <><progress class={ratio > .95 ? 'usage danger' : ratio > .8 ? 'usage warning' : 'usage'} max={1} value={Math.min(1, ratio)} aria-label="Storage used" /><p>{bytes(stats.bytes + stats.trashBytes)} of {bytes(stats.capBytes)} · {stats.count} files; Trash {bytes(stats.trashBytes)}</p></> : <p>Loading…</p>}<p class="form-hint">Free plan: about 500 uploads per day (original + thumbnail; fewer with retries). Writes, deletes and lists each have a separate 1,000/day limit, resetting at 00:00 UTC = 06:00 Dhaka.</p></section>
    <section><h2>Auto-delete</h2><label>Move unpinned files to Trash after<select disabled={saving || !settings.value} value={settings.value?.autoExpireDays ?? 30} onChange={(event) => void save({ autoExpireDays: Number(event.currentTarget.value) })}>{[0, 7, 14, 30, 60, 90].map((days) => <option value={days} key={days}>{days ? `${days} days after upload` : 'Never'}</option>)}</select></label></section>
    <section><h2>Trash retention</h2><label>Delete trashed files forever after<select disabled={saving || !settings.value} value={settings.value?.trashDays ?? 7} onChange={(event) => void save({ trashDays: Number(event.currentTarget.value) })}>{[1, 3, 7, 14, 30].map((days) => <option value={days} key={days}>{days} days</option>)}</select></label></section>
    <section><h2>Security</h2><button class="text-button" onClick={() => void logout().catch(() => showToast("Couldn't sign out. Try again.", undefined, true))}>Sign out</button><button class="text-button danger-text" onClick={async () => { if (!await confirmAction('Sign out everywhere?')) return; try { await api('/api/auth/logout-all', { method: 'POST' }); authState.value = 'out'; } catch { showToast("Couldn't sign out everywhere. Try again.", undefined, true); } }}>Sign out everywhere</button></section>
    <section><h2>Install</h2>{installed.value ? <p>Dump is installed.</p> : <><p>On iPhone, tap Share, then Add to Home Screen. Other browsers may offer an install menu.</p>{canInstall.value && <button class="primary-button" disabled={installBusy.value} onClick={() => void installApp()}>Install app</button>}</>}<p class="form-hint">On iPhone the installed app has its own login; sign in once inside it.</p></section>
    <section><h2>iPhone Shortcut</h2><label>Upload URL<input class="upload-url" readOnly value={uploadUrl} /></label><button class="text-button" onClick={() => { if (!navigator.clipboard?.writeText) { showToast("Copy isn't available here. Select the URL to copy it.", undefined, true); return; } void navigator.clipboard.writeText(uploadUrl).then(() => showToast('Upload URL copied.')).catch(() => showToast("Couldn't copy the URL. Select it to copy.", undefined, true)); }}>Copy Upload URL</button><p class="form-hint">The upload token is not shown here and is never stored in the app.</p><details><summary>Shortcut setup checklist</summary><ol><li>Create “Dump” in Shortcuts; enable Show in Share Sheet for Images and PDFs.</li><li>Repeat with Each Shortcut Input. Convert HEIC/HEIF to JPEG; set UploadFile to the converted image or original.</li><li>Get UploadFile’s name and URL Encode it as EncName. Optionally hash UploadFile with SHA256 as Sha.</li><li>Get Contents of URL: POST to the Upload URL above. Headers: Authorization = Bearer followed by one space and your upload token; X-File-Name = EncName; optional X-Content-Sha256 = Sha; Content-Type = application/octet-stream.</li><li>Set Request Body to File, UploadFile. Check the result’s ok; show error → message if false. Notify “Sent to Dump” after the repeat.</li><li>For “Dump latest screenshots”, start with Find Photos: Screenshots album, latest first, limit 5, then the same repeat.</li></ol></details></section>
    <section><h2>Maintenance</h2><p>Cleanup runs daily at 03:00 Dhaka time.</p><button class="text-button" disabled={cleaning} aria-busy={cleaning} onClick={() => void cleanup()}>{cleaning ? 'Running cleanup…' : 'Run cleanup now'}</button></section>
    <section><h2>About</h2><p>Dump {__APP_VERSION__} · {__BUILD_DATE__}</p></section>
  </main></>;
}
