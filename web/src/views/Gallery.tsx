import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { clearCellCache } from '../components/Cell';
import { FilterBar } from '../components/FilterBar';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import { Toast } from '../components/Toast';
import { VirtualGrid } from '../components/VirtualGrid';
import { closeViewer, route } from '../lib/router';
import { errorMessage, firstPageLoaded, galleryItems as items, loadFirstPage, loadMore, loadMoreError, nextCursor, status } from '../store/files';
import { clearFilters, hasFilters, online, pendingNew } from '../store/ui';
import { showPending } from '../store/files';
import { Fab } from '../components/Fab';
import { UploadTray } from '../components/UploadTray';
import { DropOverlay } from '../components/DropOverlay';
import { enqueue } from '../upload/queue';
import '../upload/backfill';

let viewerModule: Promise<typeof import('../components/Viewer')> | undefined;
const loadViewer = () => viewerModule ??= import('../components/Viewer').catch((error: unknown) => { viewerModule = undefined; throw error; });
export function Gallery() {
  const [Viewer, setViewer] = useState<ComponentType | null>(null);
  const [viewerError, setViewerError] = useState(false);
  const id = route.value.view === 'viewer' ? route.value.id : undefined;
  const ready = firstPageLoaded.value;
  function importViewer(): void { setViewerError(false); void loadViewer().then((module) => setViewer(() => module.Viewer)).catch(() => setViewerError(true)); }
  useEffect(() => { if (id) importViewer(); }, [id]);
  useEffect(() => {
    if (!ready) return;
    const prefetch = () => { void loadViewer().catch(() => {}); };
    if ('requestIdleCallback' in window) { const idle = window.requestIdleCallback(prefetch); return () => window.cancelIdleCallback(idle); }
    const timeout = setTimeout(prefetch, 1500); return () => clearTimeout(timeout);
  }, [ready]);
  useEffect(() => () => clearCellCache(), []);
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
      if (files.length) { event.preventDefault(); enqueue(files, true); }
    };
    document.addEventListener('paste', paste); return () => document.removeEventListener('paste', paste);
  }, []);
  const empty = !items.value.length && status.value !== 'loading' && status.value !== 'error';
  return <>
    <div inert={!!id} aria-hidden={id ? true : undefined}>
      <Header /><FilterBar />
      <main class="gallery page-width" id="gallery">
        <div class="gallery-summary"><span>{status.value === 'loading' && !items.value.length ? 'Loading files…' : `${items.value.length}${nextCursor.value ? '+' : ''} ${items.value.length === 1 ? 'file' : 'files'}`}</span>{!online.value && <span>Offline</span>}</div>
        {status.value === 'error' && !items.value.length ? <section class="empty-state" role="status"><Icon name="refresh" size={32} /><h2>{errorMessage.value}</h2><button class="primary-button" onClick={() => void loadFirstPage()}>Retry</button></section> : empty ? <section class="empty-state"><Icon name={hasFilters.value ? 'search' : 'image'} size={36} /><h2>{hasFilters.value ? 'No matches' : 'Nothing here yet'}</h2>{hasFilters.value ? <button class="text-button" onClick={() => { clearFilters(); void loadFirstPage(); }}>Clear filters</button> : <p>Tap + to add screenshots.</p>}</section> : <VirtualGrid />}
        {loadMoreError.value && <div class="load-more-error" role="status"><span>Couldn't load more</span><button class="text-button" onClick={() => void loadMore(true)}>Retry</button></div>}
      </main>
      {pendingNew.value > 0 && <button class="new-pill" onClick={showPending}>{pendingNew.value} new · Show</button>}
      <Toast />
      <Fab /><UploadTray />
    </div>
    <DropOverlay />
    {id && (Viewer ? <Viewer /> : <div class="viewer-loading" role="status"><span>{viewerError ? "Couldn't open viewer." : 'Opening viewer…'}</span>{viewerError && <button class="text-button" onClick={importViewer}>Retry</button>}<button class="icon-button" aria-label="Close viewer" onClick={closeViewer}><Icon name="close" /></button></div>)}
  </>;
}
