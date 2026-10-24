import { useEffect, useRef, useState } from 'preact/hooks';
import { downloadFiles } from '../lib/zip';
import { eligible, startCopy } from '../lib/clipboard';
import { shareableFiles, shareFiles } from '../lib/share';
import { actionBusy, bulkAction } from '../store/actions';
import { trashMode } from '../store/files';
import { clearSelection, selectedFiles, selectMatching, selecting } from '../store/selection';
import { confirmAction } from './Dialog';
import { openTag } from './TagDialog';
import { openEdit } from './EditDialog';
import { Icon } from './Icon';

export function SelectionBar() {
  const files = selectedFiles.value, trash = trashMode.value;
  const [shared, setShared] = useState<File[] | null>(null), [more, setMore] = useState(false);
  const [phone, setPhone] = useState(innerWidth - 32 < 640);
  const root = useRef<HTMLElement>(null);
  useEffect(() => { let active = true; setShared(null); void shareableFiles(files).then((result) => { if (active) setShared(result); }); return () => { active = false; }; }, [files.map((file) => `${file.id}:${file.name}:${file.mime}`).join(',')]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => { if (root.current) { setPhone(entry.contentRect.width < 640); document.documentElement.style.setProperty('--header-height', `${root.current.getBoundingClientRect().height}px`); window.dispatchEvent(new Event('dump:layout')); } });
    const row = root.current?.querySelector('.selection-row'); if (row) observer.observe(row); return () => observer.disconnect();
  }, []);
  useEffect(() => { if (!more) return; const close = (event: PointerEvent) => { if (!(event.target as Element).closest('.selection-more')) setMore(false); }; const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); setMore(false); } }; document.addEventListener('pointerdown', close); document.addEventListener('keydown', key, true); return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key, true); }; }, [more]);
  const disabled = !files.length || actionBusy.value;
  const allPinned = files.length > 0 && files.every((file) => file.pinned);
  const pin = () => { void bulkAction(allPinned ? 'unpin' : 'pin', files); setMore(false); };
  const remove = async () => { if (!trash || await confirmAction(`Delete ${files.length} files forever? This can't be undone.`)) void bulkAction(trash ? 'purge' : 'trash', files); };
  const actions = trash ? <><button class="action-button" disabled={disabled} onClick={() => void bulkAction('restore', files)}>Restore</button><button class="action-button danger-text" disabled={disabled} onClick={() => void remove()}>Delete forever</button></> : <>
    <button class="action-button copy-primary" title={!files.some(eligible) ? "PDFs can't be copied. Use Download." : 'Copy images'} disabled={disabled || !files.some(eligible)} onClick={() => startCopy(files)}><Icon name="copy" />Copy</button>
    <button class="action-button danger-text phone-action" disabled={disabled} onClick={() => void remove()}><Icon name="trash" />Delete</button>
    {shared && <button class="action-button" disabled={disabled} onClick={() => shareFiles(shared)}><Icon name="share" />Share</button>}
    <button class="action-button" disabled={disabled} onClick={() => void downloadFiles(files)}><Icon name="download" />Download</button>
    <button class="action-button wide-action" disabled={disabled} onClick={pin}><Icon name="pin" />{allPinned ? 'Unpin' : 'Pin'}</button><button class="action-button wide-action" disabled={disabled} onClick={() => openTag(files)}><Icon name="tag" />Tag</button>
    {files.length === 1 && <button class="action-button wide-action" disabled={disabled} onClick={() => openEdit(files[0])}><Icon name="edit" />Edit</button>}
    <button class="action-button danger-text wide-action" disabled={disabled} onClick={() => void remove()}><Icon name="trash" />Delete</button>
    <div class="selection-more phone-action"><button class="action-button" aria-expanded={more} disabled={disabled} onClick={() => setMore(!more)}><Icon name="more" />More</button>{more && <div class="menu"><button onClick={pin}>{allPinned ? 'Unpin' : 'Pin'}</button><button onClick={() => { setMore(false); openTag(files); }}>Tag</button>{files.length === 1 && <button onClick={() => { setMore(false); openEdit(files[0]); }}>Edit</button>}</div>}</div>
  </>;
  return <header ref={root} class={phone ? 'app-header selection-header phone' : 'app-header selection-header'}><div class="page-width selection-row"><span aria-live="polite">{selecting.value || (files.length ? `${files.length} selected` : 'Select items')}</span><label class="select-menu"><span class="sr-only">Select menu</span><select aria-label="Select menu" value="" onChange={(event) => { const value = event.currentTarget.value; if (value) void selectMatching(value); }}><option value="">Select…</option><option value="loaded">All loaded</option><option value="matching">Everything matching the current filters</option><option value="today">Today</option><option value="week">Last 7 days</option><option value="images">Images only</option></select></label><div class="selection-actions" role="toolbar" aria-label="Selection actions">{actions}</div><button class="icon-button" aria-label="Clear selection" onClick={clearSelection}><Icon name="close" /></button></div></header>;
}
