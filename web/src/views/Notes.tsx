import { useEffect, useRef, useState } from 'preact/hooks';
import { addNote, addingNote, blocks, deleteNote, editNote, loadNote, notesError, notesLoading, refreshNotes, saveNote, useRemote, type NoteBlock } from '../store/notes';
import { Icon } from '../components/Icon';
import { confirmAction } from '../components/Dialog';
import { online, showToast } from '../store/ui';

function Block({ block, number }: { block: NoteBlock; number: number }) {
  const value = block.state.value;
  const root = useRef<HTMLElement>(null);
  const [deleting, setDeleting] = useState(false), [resolving, setResolving] = useState(false);
  useEffect(() => {
    if (block.state.peek().loaded) return;
    if (!root.current || !('IntersectionObserver' in window)) { void loadNote(block); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void loadNote(block); } }, { rootMargin: '300px' });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [value.meta.version]);
  const pending = value.text !== value.saved || !!block.pending;
  const status = value.saving ? 'Saving…' : value.error ? 'Not synced' : value.conflict ? 'Needs review' : pending ? 'Waiting to save…' : value.loaded ? 'Saved' : 'Loading…';
  async function copy(): Promise<void> {
    try { await navigator.clipboard.writeText(block.state.peek().text); showToast('Note copied.'); }
    catch { showToast("Couldn't copy. Select the text and copy it.", undefined, true); }
  }
  async function remove(): Promise<void> {
    if (!await confirmAction('Delete this note block forever?')) return;
    setDeleting(true);
    try { await deleteNote(block); }
    catch { showToast("Couldn't delete this block. It may have changed on another device.", undefined, true); void refreshNotes(); }
    finally { setDeleting(false); }
  }
  return <section ref={root} class="note-block" aria-label={`Note block ${number}`}>
    <div class="note-block-header"><label htmlFor={`note-${value.meta.id}`}>Block {number}</label><span class={value.error || value.conflict ? 'note-status danger-text' : 'note-status'} role="status">{status}</span><div class="note-actions"><button class="icon-button" aria-label={`Copy block ${number}`} disabled={!value.loaded} onClick={() => void copy()}><Icon name="copy" size={18} /></button><button class="icon-button danger-text" aria-label={`Delete block ${number}`} disabled={deleting || value.saving || resolving} onClick={() => void remove()}><Icon name="trash" size={18} /></button></div></div>
    <textarea id={`note-${value.meta.id}`} class="note-editor" aria-describedby={`note-help-${value.meta.id}`} value={value.text} disabled={!value.loaded || resolving || deleting} spellcheck={false} placeholder="Type or paste anything…" onCompositionStart={() => { block.composing = true; clearTimeout(block.timer); }} onCompositionEnd={event => { block.composing = false; editNote(block, event.currentTarget.value); }} onInput={event => editNote(block, event.currentTarget.value)} onBlur={() => void saveNote(block)} />
    <div class="note-block-footer" id={`note-help-${value.meta.id}`}><span>{value.error || (value.conflict ? (value.conflict === 'deleted' ? 'This block was deleted on another device. Your draft is preserved here.' : 'Another device changed this block. Your draft is preserved here.') : 'Autosaves · Cut or clear text here to remove it on your other devices.')}</span>{!value.loaded && !value.loading && <button class="text-button" onClick={() => void loadNote(block)}>Retry loading</button>}{value.error && value.loaded && !value.conflict && <button class="text-button" onClick={() => void saveNote(block)}>Retry saving</button>}</div>
    {value.conflict && <div class="note-conflict"><button class="text-button" disabled={resolving} onClick={async () => {
      if (!await confirmAction('Discard this local draft and load the other device’s version?')) return;
      setResolving(true); try { await useRemote(block); } finally { setResolving(false); }
    }}>Discard draft and load latest</button><button class="text-button" disabled={resolving || addingNote.value} onClick={async () => {
      setResolving(true);
      try { const created = await addNote(block.state.peek().text); if (created) await useRemote(block); }
      finally { setResolving(false); }
    }}>Keep my text as a new block</button></div>}
  </section>;
}

export function Notes() {
  useEffect(() => {
    let stopped = false, updating = false, timer: ReturnType<typeof setTimeout> | undefined;
    const update = async () => {
      if (stopped || updating) return;
      updating = true;
      clearTimeout(timer);
      if (!document.hidden && navigator.onLine) await refreshNotes();
      updating = false;
      if (!stopped && !document.hidden) timer = setTimeout(() => { void update(); }, notesError.peek() ? 15000 : 4000);
    };
    const wake = () => { if (!document.hidden) void update(); else clearTimeout(timer); };
    void update();
    window.addEventListener('focus', wake); window.addEventListener('online', wake); document.addEventListener('visibilitychange', wake);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener('focus', wake); window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake); };
  }, []);
  async function create(): Promise<void> {
    const block = await addNote();
    if (block) requestAnimationFrame(() => { const element = document.getElementById(`note-${block.state.peek().meta.id}`); element?.scrollIntoView({ block: 'center', behavior: 'smooth' }); element?.focus({ preventScroll: true }); });
  }
  return <main class="notes-page page-width" id="notes"><div class="notes-heading"><div><h2>Notes</h2><p>Private text, ready on your other devices.</p></div><button class="primary-button note-add" disabled={addingNote.value || !online.value} onClick={() => void create()}><Icon name="plus" size={20} />Add block</button></div>
    <p class="notes-sync-hint">{online.value ? 'Changes autosave and sync while Notes is open. Keep this tab open until it says Saved.' : 'Offline — edits stay in this tab and sync when you reconnect. Keep it open.'}</p>
    {notesError.value && <p class="notes-error" role="status">{notesError.value} <button class="text-button" onClick={() => void refreshNotes()}>Retry sync</button></p>}
    {notesLoading.value && !blocks.value.length ? <p role="status">Loading notes…</p> : !blocks.value.length ? <section class="notes-empty"><Icon name="edit" size={32} /><h3>A place for text that needs to move.</h3><p>Add a block, paste on one device, and pick it up on another.</p></section> : <div class="notes-blocks">{blocks.value.map((block, index) => <Block key={block.state.peek().meta.id} block={block} number={index + 1} />)}</div>}
  </main>;
}
