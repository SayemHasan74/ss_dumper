import { effect, signal, untracked, type Signal } from '@preact/signals';
import { authState } from '../auth';
import { api, ApiError } from '../lib/api';
import { splitNote, type NoteMeta } from '../../../shared/notes';

export interface NoteState { meta: NoteMeta; text: string; saved: string; loaded: boolean; saving: boolean; loading: boolean; conflict: 'changed' | 'deleted' | null; error: string }
export interface NoteBlock { state: Signal<NoteState>; timer?: ReturnType<typeof setTimeout>; composing?: boolean; pending?: { version: string; base: string; text: string } }
export const blocks = signal<NoteBlock[]>([]);
export const notesLoading = signal(false), notesError = signal(''), addingNote = signal(false);
let revision = -1, epoch = 0, refreshing = false, mutation = 0;
let controller = new AbortController();
function makeBlock(meta: NoteMeta, text = '', loaded = meta.chunks === 0): NoteBlock { return { state: signal({ meta, text, saved: text, loaded, saving: false, loading: false, conflict: null, error: '' }) }; }
const valid = (generation: number) => generation === epoch && authState.peek() === 'in';
const message = (error: unknown) => error instanceof ApiError ? error.message : "Couldn't sync notes. Your changes are still in this tab.";
const options = () => ({ signal: controller.signal });
const dirty = (block: NoteBlock) => { const value = block.state.peek(); return value.text !== value.saved || value.saving || !!block.pending; };

export async function loadNote(block: NoteBlock, discard = false): Promise<void> {
  const value = block.state.peek(), generation = epoch;
  if (value.loading || value.saving || (!discard && dirty(block))) return;
  block.state.value = { ...value, loading: true, error: '' };
  try {
    let cursor: number | null = 0, text = '';
    do {
      const result: { text: string; nextCursor: number | null } = await api(`/api/notes/${value.meta.id}?version=${value.meta.version}&cursor=${cursor}`, options());
      text += result.text; cursor = result.nextCursor;
    } while (cursor !== null && valid(generation));
    if (!valid(generation)) return;
    if (block.state.peek().meta.version !== value.meta.version) return;
    // Typing during a remote read must never be overwritten by its response.
    if (!discard && dirty(block)) return;
    block.state.value = { ...block.state.peek(), text, saved: text, loaded: true, conflict: null, error: '' };
    block.pending = undefined;
  } catch (error) {
    if (!valid(generation)) return;
    if (error instanceof ApiError && (error.status === 409 || error.status === 404)) revision = -1;
    else block.state.value = { ...block.state.peek(), error: message(error) };
  } finally {
    if (valid(generation)) {
      block.state.value = { ...block.state.peek(), loading: false };
      if (block.state.peek().meta.version !== value.meta.version && !dirty(block)) void loadNote(block);
    }
  }
}

export async function refreshNotes(): Promise<void> {
  if (refreshing || authState.peek() !== 'in' || !navigator.onLine) return;
  refreshing = true;
  const generation = epoch, before = mutation;
  if (revision < 0 && !blocks.peek().length) notesLoading.value = true;
  try {
    let cursor: string | null = null, state = revision;
    const metadata: NoteMeta[] = [];
    do {
      const query = new URLSearchParams();
      if (revision >= 0) query.set('since', String(revision));
      if (cursor) query.set('cursor', cursor);
      const result: { revision: number; unchanged?: boolean; notes?: NoteMeta[]; nextCursor?: string | null } = await api(`/api/notes?${query}`, options());
      if (!valid(generation)) return;
      if (result.unchanged && revision >= 0) { notesError.value = ''; return; }
      if (cursor && state !== result.revision) { revision = -1; return; }
      state = result.revision; metadata.push(...(result.notes ?? [])); cursor = result.nextCursor ?? null;
    } while (cursor && valid(generation));
    if (!valid(generation)) return;
    if (before !== mutation) { revision = -1; return; }
    const known = new Map(blocks.peek().map(block => [block.state.peek().meta.id, block]));
    const next: NoteBlock[] = [];
    for (const meta of metadata) {
      const block = known.get(meta.id) ?? makeBlock(meta);
      known.delete(meta.id);
      const previous = block.state.peek();
      if (previous.meta.version !== meta.version) {
        if (block.pending?.version === meta.version) {
          const saved = block.pending.text; block.pending = undefined; mutation++;
          block.state.value = { ...previous, meta, saved, conflict: null, error: '' };
          if (!previous.saving && previous.text !== saved) void saveNote(block);
        } else if (dirty(block)) block.state.value = { ...previous, conflict: 'changed' };
        else { block.state.value = { ...previous, meta, loaded: false }; if (previous.loaded) void loadNote(block); }
      }
      next.push(block);
    }
    for (const block of known.values()) if (dirty(block)) { block.state.value = { ...block.state.peek(), conflict: 'deleted' }; next.push(block); }
    blocks.value = next.sort((a, b) => a.state.peek().meta.createdAt - b.state.peek().meta.createdAt || a.state.peek().meta.id.localeCompare(b.state.peek().meta.id));
    revision = state; notesError.value = '';
  } catch (error) { if (valid(generation)) notesError.value = message(error); }
  finally { if (valid(generation)) { refreshing = false; notesLoading.value = false; } }
}

export async function addNote(text = ''): Promise<NoteBlock | undefined> {
  if (addingNote.peek() || authState.peek() !== 'in') return;
  addingNote.value = true;
  const generation = epoch, id = crypto.randomUUID();
  try {
    const result = await api<{ note: NoteMeta }>('/api/notes', { method: 'POST', json: { id }, ...options() });
    if (!valid(generation)) return;
    const block = makeBlock(result.note);
    mutation++;
    blocks.value = [...blocks.peek().filter(existing => existing.state.peek().meta.id !== id), block];
    if (text) editNote(block, text);
    return block;
  } catch (error) { if (valid(generation)) notesError.value = message(error); }
  finally { if (valid(generation)) addingNote.value = false; }
}
export function editNote(block: NoteBlock, text: string): void {
  block.state.value = { ...block.state.peek(), text, error: '' };
  clearTimeout(block.timer);
  if (!block.composing) block.timer = setTimeout(() => { void saveNote(block); }, 600);
}
export async function saveNote(block: NoteBlock): Promise<void> {
  const value = block.state.peek(), generation = epoch;
  clearTimeout(block.timer);
  if (value.saving || value.loading || !value.loaded || value.conflict || block.composing || authState.peek() !== 'in') return;
  if (!navigator.onLine) { block.state.value = { ...value, error: 'Offline — changes are waiting in this tab.' }; return; }
  if (value.text === value.saved && !block.pending) return;
  const pending = block.pending ??= { version: crypto.randomUUID(), base: value.meta.version, text: value.text };
  block.state.value = { ...value, saving: true, error: '' };
  try {
    const chunks = splitNote(pending.text);
    for (let index = 0; index < chunks.length; index++) {
      await api(`/api/notes/${value.meta.id}/chunks/${pending.version}/${index}`, { method: 'PUT', json: { baseVersion: pending.base, text: chunks[index] }, ...options() });
      if (!valid(generation)) return;
    }
    const result = await api<{ note: NoteMeta }>(`/api/notes/${value.meta.id}/commit`, { method: 'POST', json: { baseVersion: pending.base, version: pending.version, chunks: chunks.length }, ...options() });
    if (!valid(generation)) return;
    block.pending = undefined;
    mutation++;
    block.state.value = { ...block.state.peek(), meta: result.note, saved: pending.text, conflict: null };
  } catch (error) {
    if (!valid(generation)) return;
    if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
      // A lost response may mean our own commit succeeded. Resolve that safely.
      try {
        const result = await api<{ note: NoteMeta; text: string }>(`/api/notes/${value.meta.id}?version=${pending.version}`, options());
        if (valid(generation)) { mutation++; block.pending = undefined; block.state.value = { ...block.state.peek(), meta: result.note, saved: pending.text, conflict: null }; }
      } catch { if (valid(generation)) block.state.value = { ...block.state.peek(), conflict: error.status === 404 ? 'deleted' : 'changed' }; }
    } else if (block.state.peek().meta.version !== pending.version) block.state.value = { ...block.state.peek(), error: message(error) };
  } finally {
    if (valid(generation)) {
      block.state.value = { ...block.state.peek(), saving: false };
      if (!block.state.peek().error && !block.state.peek().conflict && dirty(block)) block.timer = setTimeout(() => { void saveNote(block); }, 600);
    }
  }
}
export async function deleteNote(block: NoteBlock): Promise<void> {
  const value = block.state.peek(), generation = epoch;
  if (value.saving) return;
  clearTimeout(block.timer);
  await api(`/api/notes/${value.meta.id}`, { method: 'DELETE', json: { version: value.meta.version }, ...options() });
  if (valid(generation)) { mutation++; blocks.value = blocks.peek().filter(existing => existing !== block); }
}
export async function useRemote(block: NoteBlock): Promise<void> {
  const draft = block.state.peek(), generation = epoch;
  try {
    const result = await api<{ note: NoteMeta }>(`/api/notes/${draft.meta.id}`, options());
    if (!valid(generation)) return;
    const temporary = makeBlock(result.note, '', false);
    await loadNote(temporary, true);
    if (!valid(generation)) return;
    if (!temporary.state.peek().loaded) throw new Error();
    clearTimeout(block.timer); block.pending = undefined;
    block.state.value = temporary.state.peek(); mutation++;
  } catch (error) {
    if (!valid(generation)) return;
    if (error instanceof ApiError && error.status === 404) { mutation++; blocks.value = blocks.peek().filter(existing => existing !== block); }
    else block.state.value = { ...block.state.peek(), error: message(error) };
  }
}
export const hasUnsavedNotes = () => blocks.peek().some(dirty);
effect(() => {
  if (authState.value === 'out') untracked(() => {
    epoch++; controller.abort(); controller = new AbortController();
    for (const block of blocks.peek()) clearTimeout(block.timer);
    blocks.value = []; revision = -1; refreshing = false; notesLoading.value = false; notesError.value = ''; addingNote.value = false;
  });
});
window.addEventListener('beforeunload', event => { if (hasUnsavedNotes()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('online', () => { for (const block of blocks.peek()) void saveNote(block); });
document.addEventListener('visibilitychange', () => { if (document.hidden) for (const block of blocks.peek()) void saveNote(block); });
