import { useEffect, useRef, useState } from 'preact/hooks';
import type { FileDTO } from '../../../shared/types';
import { bytes } from '../lib/format';
import { openViewer } from '../lib/router';
import { Icon } from './Icon';

const loaded = new Set<string>();
const retried = new Set<string>();
export function clearCellCache(): void { loaded.clear(); retried.clear(); }
export function Cell({ file, size }: { file: FileDTO; size: number }) {
  const source = `/api/files/${file.id}/thumb?v=${file.thumbSize}`;
  const [ready, setReady] = useState(loaded.has(source));
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { setReady(loaded.has(source)); setFailed(false); setRetry(0); return () => clearTimeout(timer.current); }, [source]);
  const image = file.mime.startsWith('image/');
  return <button id={`cell-${file.id}`} type="button" class="file-cell" tabIndex={-1} data-file-id={file.id} aria-label={`${file.name}, ${bytes(file.size)}`} onClick={(event) => openViewer(file.id, event.currentTarget)}>
    <span class="cell-placeholder">{image ? <Icon name="image" size={28} /> : <><Icon name="file-pdf" size={28} /><span>PDF</span></>}</span>
    {image && file.thumbSize > 0 && !failed && <img src={retry ? `${source}&retry=1` : source} width={size} height={size} alt="" decoding="async" draggable={false} class={ready ? 'cell-image is-ready' : 'cell-image'} onLoad={() => { loaded.add(source); setReady(true); }} onError={() => {
      setFailed(true);
      if (!retry && !retried.has(source) && Date.now() - file.createdAt < 120000) { retried.add(source); timer.current = setTimeout(() => { setRetry(1); setFailed(false); }, 3000); }
    }} />}
    {file.pinned && <span class="cell-pin"><Icon name="pin" size={14} /></span>}
    {!image && <span class="cell-pdf">PDF</span>}
  </button>;
}
