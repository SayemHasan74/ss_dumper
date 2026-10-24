import { signal } from '@preact/signals';

export interface Route { view: string; id?: string }
const table: { pattern: RegExp; resolve: (match: RegExpMatchArray) => Route }[] = [
  { pattern: /^\/$/, resolve: () => ({ view: 'gallery' }) },
  { pattern: /^\/v\/([0-9A-HJKMNP-TV-Z]{26})$/, resolve: (match) => ({ view: 'viewer', id: match[1] }) },
];
export const route = signal<Route>({ view: 'gallery' });
let fromGallery = false;
let origin: HTMLElement | null = null;
function sync(): void {
  if (!location.hash) history.replaceState(null, '', '#/');
  const path = location.hash.slice(1) || '/';
  for (const entry of table) {
    const match = path.match(entry.pattern);
    if (match) { route.value = entry.resolve(match); return; }
  }
  history.replaceState(null, '', '#/');
  route.value = { view: 'gallery' };
}
window.addEventListener('hashchange', sync);
window.addEventListener('popstate', sync);
sync();
export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (options.replace) { history.replaceState(null, '', `#${path}`); sync(); }
  else { location.hash = path; sync(); }
}
export function openViewer(id: string, element?: HTMLElement): void {
  fromGallery = route.peek().view === 'gallery';
  if (element) origin = element;
  navigate(`/v/${id}`);
}
export function closeViewer(): void {
  if (fromGallery) { fromGallery = false; history.back(); }
  else navigate('/', { replace: true });
}
export function restoreViewerFocus(): void {
  const element = origin;
  origin = null;
  requestAnimationFrame(() => { if (element?.isConnected) element.focus({ preventScroll: true }); });
}
