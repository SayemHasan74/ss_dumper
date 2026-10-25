import { useEffect, useRef, useState } from 'preact/hooks';
import type { FileDTO } from '../../../shared/types';
import { bytes } from '../lib/format';
import { openViewer } from '../lib/router';
import { Icon } from './Icon';
import { previewById, settings, type LocalFile } from '../store/files';
import { selectedIds, selectMode, toggleSelection } from '../store/selection';

const loaded = new Set<string>();
const retried = new Set<string>();
export function clearCellCache(): void { loaded.clear(); retried.clear(); }
export function Cell({ file, size }: { file: FileDTO | LocalFile; size: number }) {
  const local = 'localId' in file ? file : null;
  const preview = local?.previewUrl || previewById.value[file.id];
  const source = preview || `/api/files/${file.id}/thumb?v=${file.thumbSize}`;
  const [ready, setReady] = useState(loaded.has(source));
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), point = useRef<{ x: number; y: number } | null>(null), suppress = useRef(false);
  useEffect(() => { const cancel = () => clearTimeout(press.current); window.addEventListener('scroll', cancel, { passive: true }); return () => { cancel(); window.removeEventListener('scroll', cancel); }; }, []);
  useEffect(() => { setReady(loaded.has(source)); setFailed(false); setRetry(0); return () => clearTimeout(timer.current); }, [source]);
  const image = file.mime.startsWith('image/');
  const selected = selectedIds.value.has(file.id);
  return <button id={`cell-${file.id}`} type="button" class={selected ? 'file-cell selected' : 'file-cell'} tabIndex={-1} data-file-id={file.id} aria-pressed={selected} aria-disabled={!!local} aria-label={`${image ? '' : 'PDF, '}${file.name}, ${bytes(file.size)}${local ? `, ${local.message}` : ''}`} onContextMenu={(event) => event.preventDefault()} onPointerDown={(event) => {
    suppress.current = false; point.current = { x: event.clientX, y: event.clientY };
    if (!local && event.pointerType === 'touch') press.current = setTimeout(() => { toggleSelection(file); suppress.current = true; navigator.vibrate?.(10); }, 500);
  }} onPointerMove={(event) => { if (point.current && Math.hypot(event.clientX - point.current.x, event.clientY - point.current.y) > 8) clearTimeout(press.current); }} onPointerUp={() => clearTimeout(press.current)} onPointerCancel={() => clearTimeout(press.current)} onClick={(event) => {
    if (local) return;
    if (suppress.current) { suppress.current = false; return; }
    if (selectMode.peek() || event.ctrlKey || event.metaKey || event.shiftKey || (event.target as Element).closest('.cell-select')) toggleSelection(file, event.shiftKey);
    else openViewer(file.id, event.currentTarget);
  }}>
    <span class="cell-placeholder" aria-hidden="true"><Icon name={image ? 'image' : 'file-pdf'} size={28} /></span>
    {image && (preview || file.thumbSize > 0) && !failed && <img src={retry && !preview ? `${source}&retry=1` : source} width={size} height={size} alt="" decoding="async" draggable={false} class={ready ? 'cell-image is-ready' : 'cell-image'} onLoad={() => { loaded.add(source); setReady(true); }} onError={() => {
      setFailed(true);
      if (!preview && !retry && !retried.has(source) && Date.now() - file.createdAt < 120000) { retried.add(source); timer.current = setTimeout(() => { setRetry(1); setFailed(false); }, 3000); }
    }} />}
    {file.pinned && <span class="cell-pin"><Icon name="pin" size={14} /></span>}
    {!image && <span class="cell-pdf" aria-hidden="true">PDF</span>}
    {!local && <span class={selectMode.value ? 'cell-select visible' : 'cell-select'} role="checkbox" aria-checked={selected} aria-label={`Select ${file.name}`}><Icon name="check" size={16} /></span>}
    {file.deletedAt && <span class="cell-trash-left">{Math.max(0, Math.ceil((file.deletedAt + (settings.value?.trashDays ?? 7) * 86400000 - Date.now()) / 86400000))} d left</span>}
    {local && <span class={local.status === 'failed' ? 'cell-upload upload-error' : 'cell-upload'}><span>{local.message}</span><progress aria-label="Upload progress" value={local.progress} max={1} /></span>}
  </button>;
}
