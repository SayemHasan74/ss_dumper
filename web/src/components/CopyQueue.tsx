import { useEffect, useRef } from 'preact/hooks';
import { closeCopy, copyQueue, nextCopy, switchCopyMode } from '../lib/clipboard';
import { Icon } from './Icon';

export function CopyQueue() {
  const state = copyQueue.value, root = useRef<HTMLElement>(null);
  useEffect(() => { if (state) root.current?.focus(); }, [!!state]);
  if (!state) return null;
  const imageIndex = state.mode === 'sheet' ? state.imagesInSheet.slice(0, state.index).reduce((sum, count) => sum + count, 0) : state.index;
  const file = state.files[Math.min(imageIndex, state.files.length - 1)];
  return <section ref={root} class="copy-queue" aria-label="Copy Queue" tabIndex={0} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCopy(); }
    if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); nextCopy(); }
  }}><div class="copy-summary">{file.thumbSize > 0 && <img src={`/api/files/${file.id}/thumb?v=${file.thumbSize}`} alt="" />}<span aria-live="polite">{state.mode === 'one' ? `Image ${state.index + 1} of ${state.entries} · copied ${state.copied}` : `Sheet ${state.index + 1} of ${state.entries} · ${state.imagesInSheet[state.index] ?? '…'} images`}</span><button class="icon-button" aria-label="Close Copy Queue" onClick={closeCopy}><Icon name="close" /></button></div>
    <div class="copy-modes" role="group" aria-label="Copy mode"><button class="chip" aria-pressed={state.mode === 'one'} onClick={() => switchCopyMode('one')}>One by one</button><button class="chip" aria-pressed={state.mode === 'sheet'} onClick={() => switchCopyMode('sheet')}>One image</button></div>
    <div class="copy-controls"><button class="primary-button" disabled={state.busy} onClick={() => nextCopy()}>{state.busy ? 'Copying…' : `Copy next (${state.index + 1} of ${state.entries})`}</button><button class="text-button" disabled={state.busy} onClick={() => nextCopy(true)}>Skip</button></div>
  </section>;
}
