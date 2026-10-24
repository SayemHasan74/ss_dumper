import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { clearCellCache } from '../components/Cell';
import { FilterBar } from '../components/FilterBar';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import { Toast } from '../components/Toast';
import { VirtualGrid } from '../components/VirtualGrid';
import { closeViewer, route } from '../lib/router';
import { errorMessage, firstPageLoaded, galleryItems as items, loadFirstPage, loadMore, loadMoreError, nextCursor, status, trashMode } from '../store/files';
import { clearFilters, hasFilters, online, pendingNew } from '../store/ui';
import { showPending } from '../store/files';
import { Fab } from '../components/Fab';
import { UploadTray } from '../components/UploadTray';
import { DropOverlay } from '../components/DropOverlay';
import { enqueue } from '../upload/queue';
import '../upload/backfill';
import { clearSelection, selectedFiles, selectMode, selectMatching } from '../store/selection';
import { bulkAction } from '../store/actions';
import { SelectionBar } from '../components/SelectionBar';
import { CopyQueue } from '../components/CopyQueue';
import { copyQueue, closeCopy, startCopy } from '../lib/clipboard';
import { ConfirmHost, dialogCount } from '../components/Dialog';
import { TagDialog } from '../components/TagDialog';
import { EditDialog } from '../components/EditDialog';
import { dismissInstallHint, showInstallHint } from '../pwa/install';

let viewerModule: Promise<typeof import('../components/Viewer')> | undefined;
const loadViewer = () => viewerModule ??= import('../components/Viewer').catch((error: unknown) => { viewerModule = undefined; throw error; });
export function Gallery() {
  const [Viewer, setViewer] = useState<ComponentType | null>(null);
  const [viewerError, setViewerError] = useState(false);
  const [Auxiliary, setAuxiliary] = useState<ComponentType | null>(null), [auxError, setAuxError] = useState(false), [auxRetry, setAuxRetry] = useState(0);
  const view = route.value.view;
  const id = route.value.view === 'viewer' ? route.value.id : undefined;
  const ready = firstPageLoaded.value;
  function importViewer(): void { setViewerError(false); void loadViewer().then((module) => setViewer(() => module.Viewer)).catch(() => setViewerError(true)); }
  useEffect(() => { if (id) importViewer(); }, [id]);
  useEffect(() => {
    if (view === 'viewer') return;
    clearSelection();
    if (view === 'gallery' || view === 'trash') { const wanted = view === 'trash'; if (trashMode.peek() !== wanted) { trashMode.value = wanted; void loadFirstPage(); } }
    window.scrollTo({ top: 0, behavior: 'instant' });
    let active = true; setAuxError(false); setAuxiliary(null);
    const module = view === 'trash' ? import('./Trash').then((module) => module.Trash) : view === 'settings' ? import('./Settings').then((module) => module.Settings) : null;
    if (module) void module.then((component) => { if (active) setAuxiliary(() => component); }).catch(() => { if (active) setAuxError(true); });
    return () => { active = false; };
  }, [view, auxRetry]);
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
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (dialogCount.peek() || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
      if (event.key === 'Escape' && copyQueue.peek()) { event.preventDefault(); event.stopImmediatePropagation(); closeCopy(); return; }
      if (route.peek().view === 'viewer' || route.peek().view === 'settings') return;
      if (event.key === 'Escape') { clearSelection(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); void selectMatching('loaded'); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selectedFiles.peek().length) { event.preventDefault(); startCopy(selectedFiles.peek()); }
      if (event.key === 'Delete' && selectedFiles.peek().length && !trashMode.peek()) { event.preventDefault(); void bulkAction('trash', selectedFiles.peek()); }
      if (event.key === '/' && !selectMode.peek()) { event.preventDefault(); window.dispatchEvent(new Event('dump:search')); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const empty = !items.value.length && status.value !== 'loading' && status.value !== 'error';
  return <>
    <div inert={!!id} aria-hidden={id ? true : undefined}>
      {view === 'settings' ? (Auxiliary ? <Auxiliary /> : <p role="status">{auxError ? <button class="text-button" onClick={() => setAuxRetry((value) => value + 1)}>Retry settings</button> : 'Loading…'}</p>) : <>
      {selectMode.value ? <SelectionBar /> : trashMode.value ? (Auxiliary ? <Auxiliary /> : <header class="app-header"><p>{auxError ? <button class="text-button" onClick={() => setAuxRetry((value) => value + 1)}>Retry Trash</button> : 'Loading Trash…'}</p></header>) : <Header />}
      {!trashMode.value && <FilterBar />}
      <main class="gallery page-width" id="gallery">
        {!trashMode.value && showInstallHint.value && <aside class="install-hint"><p>Install Dump: tap Share, then Add to Home Screen.</p><button class="icon-button" aria-label="Dismiss install hint" onClick={dismissInstallHint}><Icon name="close" /></button></aside>}
        <div class="gallery-summary"><span>{status.value === 'loading' && !items.value.length ? 'Loading files…' : `${items.value.length}${nextCursor.value ? '+' : ''} ${items.value.length === 1 ? 'file' : 'files'}`}</span>{!online.value && <span>Offline</span>}</div>
        {status.value === 'error' && !items.value.length ? <section class="empty-state" role="status"><Icon name="refresh" size={32} /><h2>{errorMessage.value}</h2><button class="primary-button" onClick={() => void loadFirstPage()}>Retry</button></section> : empty ? <section class="empty-state"><Icon name={hasFilters.value ? 'search' : 'image'} size={36} /><h2>{trashMode.value ? 'Trash is empty' : hasFilters.value ? 'No matches' : 'Nothing here yet'}</h2>{!trashMode.value && (hasFilters.value ? <button class="text-button" onClick={() => { clearFilters(); void loadFirstPage(); }}>Clear filters</button> : <p>Tap + to add screenshots.</p>)}</section> : <VirtualGrid />}
        {loadMoreError.value && <div class="load-more-error" role="status"><span>Couldn't load more</span><button class="text-button" onClick={() => void loadMore(true)}>Retry</button></div>}
      </main>
      {pendingNew.value > 0 && <button class="new-pill" onClick={showPending}>{pendingNew.value} new · Show</button>}
      {!trashMode.value && <Fab />}
      </>}
    </div>
    <aside class="action-stack" aria-label="Activity"><CopyQueue /><UploadTray /><Toast /></aside><ConfirmHost /><TagDialog /><EditDialog />
    <DropOverlay />
    {id && (Viewer ? <Viewer /> : <div class="viewer-loading" role="status"><span>{viewerError ? "Couldn't open viewer." : 'Opening viewer…'}</span>{viewerError && <button class="text-button" onClick={importViewer}>Retry</button>}<button class="icon-button" aria-label="Close viewer" onClick={closeViewer}><Icon name="close" /></button></div>)}
  </>;
}
