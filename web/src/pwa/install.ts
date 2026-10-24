import { computed, signal } from '@preact/signals';
import { isIOS, isStandalone } from '../lib/env';
import { showToast } from '../store/ui';

interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const standalone = signal(isStandalone());
const dismissed = signal((() => { try { return localStorage.getItem('dump.installHintDismissed') === '1'; } catch { return false; } })());
const deferred = signal<InstallPrompt | null>(null);
export const installBusy = signal(false);
export const installed = computed(() => standalone.value);
export const canInstall = computed(() => !standalone.value && deferred.value !== null);
export const showInstallHint = computed(() => isIOS() && !standalone.value && !dismissed.value);
export function dismissInstallHint(): void { dismissed.value = true; try { localStorage.setItem('dump.installHintDismissed', '1'); } catch {} }
export async function installApp(): Promise<void> {
  const event = deferred.peek(); if (!event || installBusy.peek()) return;
  installBusy.value = true; deferred.value = null;
  try { await event.prompt(); await event.userChoice; }
  catch { showToast("Couldn't open installation. Use your browser's install menu.", undefined, true); }
  finally { installBusy.value = false; }
}
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferred.value = event as InstallPrompt; });
window.addEventListener('appinstalled', () => { deferred.value = null; standalone.value = true; });
matchMedia('(display-mode: standalone)').addEventListener('change', () => { standalone.value = isStandalone(); });

let frame = 0;
function positionAboveKeyboard(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const viewport = window.visualViewport;
    const searching = document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'search';
    const inset = searching && viewport ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop) : 0;
    document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);
  });
}
window.visualViewport?.addEventListener('resize', positionAboveKeyboard);
window.visualViewport?.addEventListener('scroll', positionAboveKeyboard);
document.addEventListener('focusin', positionAboveKeyboard);
document.addEventListener('focusout', positionAboveKeyboard);
