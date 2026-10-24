import { showToast } from '../store/ui';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const start = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => navigator.serviceWorker.getRegistration('/'));
      if (!registration) return;
      let reloadRequested = false, reloaded = false;
      const announce = (worker: ServiceWorker) => showToast('Update ready', { label: 'Reload', run: () => {
        if (reloadRequested) return;
        reloadRequested = true;
        const reload = () => { if (!reloaded) { reloaded = true; location.reload(); } };
        if (worker.state === 'activated') { reload(); return; }
        navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
        worker.postMessage({ type: 'SKIP_WAITING' });
      } }, false, 0);
      const inspect = (worker: ServiceWorker | null) => {
        if (!worker) return;
        const changed = () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) announce(worker); };
        worker.addEventListener('statechange', changed); changed();
      };
      if (registration.waiting && navigator.serviceWorker.controller) announce(registration.waiting);
      inspect(registration.installing);
      registration.addEventListener('updatefound', () => inspect(registration.installing));
      let lastCheck = Date.now();
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && Date.now() - lastCheck >= 10 * 60 * 1000) {
          lastCheck = Date.now(); void registration.update().catch(() => {});
        }
      });
    } catch { /* The app remains usable when service workers are unavailable. */ }
  };
  if (document.readyState === 'complete') void start();
  else window.addEventListener('load', () => { void start(); }, { once: true });
}
