import { photoDateLabel } from '../../../shared/photo-date';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { FileDTO } from '../../../shared/types';
import { authState } from '../auth';
import { api } from '../lib/api';
import { isTouch } from '../lib/env';
import { bytes, dateTime } from '../lib/format';
import { closeViewer, navigate, restoreViewerFocus, route } from '../lib/router';
import { fileUpdates, items, loadMore, nextCursor, settings } from '../store/files';
import { Icon } from './Icon';
import { bulkAction } from '../store/actions';
import { copyQueue, eligible, startCopy } from '../lib/clipboard';
import { downloadFiles } from '../lib/zip';
import { shareableFiles, shareFiles } from '../lib/share';
import { confirmAction, dialogCount } from './Dialog';
import { openEdit } from './EditDialog';
import { TextPreview } from './TextPreview';

export function Viewer() {
  const id = route.value.id!;
  const list = items.value;
  const index = list.findIndex((item) => item.id === id);
  const [deepFile, setDeepFile] = useState<FileDTO | null>(null);
  const [metadataError, setMetadataError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [source, setSource] = useState('');
  const [ready, setReady] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [dragY, setDragY] = useState(0);
  const close = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const zoomRef = useRef(false); zoomRef.current = zoom;
  const propagationRetry = useRef('');
  const lastTap = useRef(0);
  const suppressClick = useRef(0);
  const sourceId = useRef('');
  const file = index >= 0 ? list[index] : fileUpdates.value[id] ?? (deepFile?.id === id ? deepFile : null);
  const currentFile = useRef<FileDTO | null>(file); currentFile.current = file;
  const [shared, setShared] = useState<File[] | null>(null);
  useEffect(() => { let active = true; setShared(null); if (file) void shareableFiles([file]).then((result) => { if (active) setShared(result); }); return () => { active = false; }; }, [file?.id, file?.name, file?.mime]);
  async function removeCurrent(permanent = false): Promise<void> {
    const current = currentFile.current;
    if (!current) return;
    if (permanent && !await confirmAction("Delete 1 files forever? This can't be undone.")) return;
    const files = items.peek(), position = files.findIndex((file) => file.id === current.id), next = files[position + 1] ?? files[position - 1];
    if (await bulkAction(permanent ? 'purge' : 'trash', [current])) { if (next) navigate(`/v/${next.id}`, { replace: true }); else closeViewer(); }
  }
  const cursor = nextCursor.value;
  function move(direction: number): void {
    const files = items.peek();
    const current = files.findIndex((item) => item.id === route.peek().id);
    const next = current >= 0 ? files[current + direction] : undefined;
    if (next) navigate(`/v/${next.id}`, { replace: true });
  }
  useEffect(() => {
    const controller = new AbortController();
    setMetadataError(false); setDeepFile(null);
    if (!items.peek().some((item) => item.id === id)) {
      const updates = { ...fileUpdates.peek() }; delete updates[id]; fileUpdates.value = updates;
      void api<{ file: FileDTO }>(`/api/files/${id}`, { signal: controller.signal }).then((response) => setDeepFile(response.file)).catch(() => { if (!controller.signal.aborted) setMetadataError(true); });
    }
    return () => controller.abort();
  }, [id, retry]);
  useEffect(() => {
    const y = scrollY;
    const previous = { position: document.body.style.position, top: document.body.style.top, width: document.body.style.width, overflow: document.body.style.overflow };
    Object.assign(document.body.style, { position: 'fixed', top: `-${y}px`, width: '100%', overflow: 'hidden' });
    close.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (dialogCount.peek() || copyQueue.peek()) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
      if (event.target instanceof Element && event.target.closest('.source-preview') && !['Escape','Tab'].includes(event.key)) return;
      const current = currentFile.current;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && current && eligible(current)) { event.preventDefault(); startCopy([current]); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && current) { event.preventDefault(); void removeCurrent(current.deletedAt !== null); }
      if (event.key === 'p' && current && !current.deletedAt) { event.preventDefault(); void bulkAction(current.pinned ? 'unpin' : 'pin', [current]); }
      if (event.key === 'Escape') { event.preventDefault(); if (zoomRef.current) setZoom(false); else closeViewer(); }
      if (!zoomRef.current && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); }
      if (event.key === 'Tab') {
        const controls = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]')].filter((element) => element.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('keydown', keydown);
      Object.assign(document.body.style, previous);
      window.scrollTo({ top: y, behavior: 'instant' });
      window.dispatchEvent(new Event('dump:layout'));
      restoreViewerFocus();
    };
  }, []);
  useEffect(() => {
    if (index >= 0 && index >= list.length - 3 && cursor) void loadMore();
  }, [index, list.length, cursor]);
  const imageId = file?.id;
  const mime = file?.mime;
  useEffect(() => {
    setSource(''); setReady(false); setImageError(false); setThumbFailed(false); setZoom(false); setDragY(0);
    if (!file || !file.mime.startsWith('image/')) return;
    const original = file;
    const controller = new AbortController();
    let objectUrl = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function fetchOriginal(): Promise<void> {
      try {
        const response = await fetch(`/api/files/${original.id}/original`, { credentials: 'same-origin', signal: controller.signal });
        if (response.status === 401) { authState.value = 'out'; return; }
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 404 && Date.now() - original.createdAt < 120000 && propagationRetry.current !== original.id) {
            propagationRetry.current = original.id;
            await new Promise<void>((resolve) => { timer = setTimeout(resolve, 3000); });
            if (!controller.signal.aborted) await fetchOriginal();
            return;
          }
          throw new Error('Image unavailable.');
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        sourceId.current = original.id;
        setSource(objectUrl);
      } catch { if (!controller.signal.aborted) setImageError(true); }
    }
    void fetchOriginal();
    return () => { controller.abort(); clearTimeout(timer); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [imageId, mime, retry]);
  useEffect(() => {
    const next = index >= 0 ? list[index + 1] : undefined;
    if (!ready || sourceId.current !== id || !next?.mime.startsWith('image/') || next.size > 8 * 1024 * 1024) return;
    const image = new Image(); image.src = `/api/files/${next.id}/original`;
    return () => { if (!image.complete) image.src = ''; };
  }, [ready, id, index, list]);
  const isImage = file?.mime.startsWith('image/');
  const decoded = ready && sourceId.current === id;
  function retryLoad(): void { setRetry((value) => value + 1); }
  return <div ref={dialog} class={zoom ? 'viewer allows-zoom' : 'viewer'} role="dialog" aria-modal="true" aria-label={file?.name ?? 'File viewer'} onClick={(event) => { if (event.target === event.currentTarget && !zoom) closeViewer(); }}>
    <div class="viewer-sheet" style={{ transform: `translateY(${dragY}px)` }}>
      <header class="viewer-top"><button ref={close} class="icon-button" aria-label="Close viewer" onClick={closeViewer}><Icon name="close" /></button><span class="viewer-name">{file?.name ?? 'Loading…'}</span>{index >= 0 && <span class="viewer-counter">{index + 1} / {list.length}</span>}</header>
      {file && <div class="viewer-actions" role="toolbar" aria-label="File actions">{file.deletedAt ? <><button class="action-button" onClick={async () => { if (await bulkAction('restore', [file])) closeViewer(); }}>Restore</button><button class="action-button" onClick={() => void removeCurrent(true)}>Delete forever</button></> : <>
        <button class="action-button" disabled={!eligible(file)} title={!eligible(file) ? 'Use Download or the source preview for this file.' : 'Copy image'} onClick={() => startCopy([file])}><Icon name="copy" />Copy</button><button class="action-button" onClick={() => void downloadFiles([file])}><Icon name="download" />Download</button>{shared && <button class="action-button" onClick={() => shareFiles(shared)}><Icon name="share" />Share</button>}<button class="action-button" onClick={() => void bulkAction(file.pinned ? 'unpin' : 'pin', [file])}><Icon name="pin" />{file.pinned ? 'Unpin' : 'Pin'}</button><button class="action-button" onClick={() => openEdit(file)}><Icon name="edit" />Edit</button><button class="action-button" onClick={() => void removeCurrent()}><Icon name="trash" />Delete</button>
      </>}</div>}
      <div class={zoom ? 'viewer-stage zoomed' : 'viewer-stage'} onClick={(event) => { if (Date.now() >= suppressClick.current && (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains('viewer-fit')) && !zoom) closeViewer(); }} onTouchStart={(event) => {
        touch.current = !zoom && event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
      }} onTouchMove={(event) => {
        if (!touch.current || zoom || event.touches.length !== 1) return;
        const dx = event.touches[0].clientX - touch.current.x, dy = event.touches[0].clientY - touch.current.y;
        if (dy > 0 && Math.abs(dy) > Math.abs(dx)) setDragY(dy);
      }} onTouchEnd={(event) => {
        if (!touch.current || zoom) return;
        const dx = event.changedTouches[0].clientX - touch.current.x, dy = event.changedTouches[0].clientY - touch.current.y;
        touch.current = null; setDragY(0);
        if (Math.abs(dx) > 48 && Math.abs(dx) > 1.5 * Math.abs(dy)) { suppressClick.current = Date.now() + 400; move(dx < 0 ? 1 : -1); }
        else if (dy > 80 && Math.abs(dy) > Math.abs(dx)) { suppressClick.current = Date.now() + 400; closeViewer(); }
      }} onTouchCancel={() => { touch.current = null; setDragY(0); }}>
        {!file ? <div class="viewer-state">{metadataError ? <><p>Couldn't load file</p><button class="viewer-button" onClick={retryLoad}>Retry</button></> : <span class="spinner" aria-label="Loading file" />}</div> : isImage ? <>
          <div class="viewer-fit">
            {file.thumbSize > 0 && !zoom && !thumbFailed && <img class="viewer-thumb" src={`/api/files/${file.id}/thumb?v=${file.thumbSize}`} alt="" draggable={false} onError={() => setThumbFailed(true)} />}
            {source && sourceId.current === id && <img class={decoded ? 'viewer-original is-ready' : 'viewer-original'} src={source} alt={file.name} draggable={false} width={zoom && file.width ? file.width : undefined} height={zoom && file.height ? file.height : undefined} onLoad={async (event) => {
              const image = event.currentTarget;
              try { await image.decode(); if (image.isConnected) setReady(true); } catch { setImageError(true); }
            }} onError={() => setImageError(true)} onClick={(event) => {
              event.stopPropagation();
              if (Date.now() < suppressClick.current) return;
              if (!isTouch() || Date.now() - lastTap.current < 300) { setZoom(!zoom); lastTap.current = 0; }
              else lastTap.current = Date.now();
            }} />}
          </div>
          {!decoded && !imageError && (!file.thumbSize || thumbFailed) && <div class="viewer-state"><span class="spinner" aria-label="Loading image" /></div>}
          {imageError && <div class="viewer-state"><p>Couldn't load image</p><button class="viewer-button" onClick={retryLoad}>Retry</button></div>}
          {decoded && <button class="viewer-zoom" onClick={() => setZoom(!zoom)} aria-pressed={zoom}>{zoom ? 'Fit image' : 'Actual size'}</button>}
        </> : <div class={file.mime==='application/pdf'?'pdf-card':'pdf-card generic-file-card'}><Icon name={file.mime==='application/pdf'?'file-pdf':'file'} size={44} /><h2>{file.name}</h2><p>{bytes(file.size)}</p><div>{file.mime==='application/pdf'&&<a class="viewer-button" href={`/api/files/${file.id}/original`} target="_blank" rel="noopener">Open</a>}<a class="viewer-button secondary" href={`/api/files/${file.id}/original?download=1`}>Download</a></div>{file.mime!=='application/pdf'&&<TextPreview file={file}/>}</div>}
        {index >= 0 && <><button class="viewer-chevron previous icon-button" aria-label="Previous file" disabled={index === 0} onClick={() => move(-1)}><Icon name="chevron-left" size={28} /></button><button class="viewer-chevron next icon-button" aria-label="Next file" disabled={index === list.length - 1} onClick={() => move(1)}><Icon name="chevron-right" size={28} /></button></>}
      </div>
      {file && <footer class="viewer-info"><p>{bytes(file.size)}{file.width && file.height ? ` · ${file.width} × ${file.height}` : ''}<span class="info-divider">·</span><time dateTime={new Date(file.createdAt).toISOString()}>{dateTime(file.createdAt)}</time> · uploaded</p>{file.mime.startsWith('image/')&&<p>{photoDateLabel(file.photoDate)}: {dateTime(file.photoDate?.at ?? file.createdAt)}</p>}{file.pinned && !!settings.value?.autoExpireDays ? <p>Pinned — never expires</p> : file.expiresAt && file.expiresAt - Date.now() <= 14 * 86400000 ? <p>Expires in {Math.max(0, Math.ceil((file.expiresAt - Date.now()) / 86400000))} days</p> : null}{file.tags.length > 0 && <div class="viewer-tags">{file.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}{file.note && <p class="viewer-note">{file.note}</p>}</footer>}
    </div>
  </div>;
}
