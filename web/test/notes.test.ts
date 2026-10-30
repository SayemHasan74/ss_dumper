import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NoteMeta } from '../../shared/notes';

vi.mock('../src/auth', async () => {
  const { signal } = await import('@preact/signals');
  return { authState: signal<'in' | 'out'>('in') };
});
vi.mock('../src/lib/api', () => ({ api: vi.fn(), ApiError: class extends Error { constructor(public status: number, public code: string, message: string) { super(message); } } }));
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal('navigator', { onLine: true });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function setup() {
  const model = await import('../src/store/notes');
  const { api, ApiError } = await import('../src/lib/api');
  const call = vi.mocked(api);
  call.mockReset();
  let head: NoteMeta = { id: crypto.randomUUID(), version: '0', chunks: 0, createdAt: 1, updatedAt: 1 };
  call.mockImplementation(async (path, options) => {
    if (path === '/api/notes' && options?.method === 'POST') { head = { ...head, id: (options.json as { id: string }).id }; return { ok: true, note: head }; }
    if (path.includes('/commit')) { const body = options!.json as { version: string; chunks: number }; head = { ...head, ...body, updatedAt: 2 }; return { ok: true, note: head }; }
    if (path.includes('/chunks/')) return { ok: true };
    return { ok: true, revision: 1, notes: [head], nextCursor: null };
  });
  const block = (await model.addNote())!;
  return { ...model, block, call, ApiError, getHead: () => head, setHead: (meta: NoteMeta) => { head = meta; } };
}
it('saves cutting all text as an empty revision with no chunk writes', async () => {
  const f = await setup(); f.editNote(f.block, 'Send this text'); await f.saveNote(f.block);
  f.call.mockClear(); f.editNote(f.block, ''); await f.saveNote(f.block);
  expect(f.block.state.peek().saved).toBe('');
  expect(f.call.mock.calls.some(([path]) => path.includes('/chunks/'))).toBe(false);
  expect(f.call.mock.calls.find(([path]) => path.endsWith('/commit'))?.[1]?.json).toMatchObject({ chunks: 0 });
});
it('keeps text typed while an earlier save is in flight and saves it in the next revision', async () => {
  const f = await setup();
  let release!: (result: { ok: true; note: NoteMeta }) => void;
  let announce!: () => void;
  const started = new Promise<void>(resolve => { announce = resolve; });
  const commit = new Promise<{ ok: true; note: NoteMeta }>(resolve => { release = resolve; });
  const original = f.call.getMockImplementation()!;
  f.call.mockImplementation(async (path, options) => { if (path.endsWith('/commit')) { announce(); return commit; } return original(path, options); });
  f.editNote(f.block, 'first'); const saving = f.saveNote(f.block); await started;
  const pending = f.block.pending!; f.editNote(f.block, 'typed while saving');
  release({ ok: true, note: { ...f.getHead(), version: pending.version, chunks: 1 } }); await saving;
  expect(f.block.state.peek()).toMatchObject({ text: 'typed while saving', saved: 'first' });
  f.call.mockImplementation(original); await f.saveNote(f.block);
  expect(f.block.state.peek()).toMatchObject({ text: 'typed while saving', saved: 'typed while saving' });
});
it('retains a draft on conflict rather than overwriting it with a remote version', async () => {
  const f = await setup(), original = f.call.getMockImplementation()!;
  f.call.mockImplementation(async (path, options) => {
    if (path.includes('/chunks/') || path.includes('?version=')) throw new f.ApiError(409, 'NOTE_CONFLICT', 'Changed.');
    return original(path, options);
  });
  f.editNote(f.block, 'my unsaved draft'); await f.saveNote(f.block);
  f.setHead({ ...f.getHead(), version: crypto.randomUUID(), chunks: 1 }); await f.refreshNotes();
  expect(f.block.state.peek()).toMatchObject({ text: 'my unsaved draft', conflict: 'changed' });
});
it('recognizes an acknowledged-by-poll commit after its response was lost', async () => {
  const f = await setup(), original = f.call.getMockImplementation()!;
  f.call.mockImplementation(async (path, options) => {
    if (path.endsWith('/commit')) { await original(path, options); throw new f.ApiError(0, 'NETWORK', 'Lost response.'); }
    return original(path, options);
  });
  f.editNote(f.block, 'committed once'); await f.saveNote(f.block);
  expect(f.block.pending).toBeDefined();
  f.call.mockClear(); await f.refreshNotes();
  expect(f.block.pending).toBeUndefined();
  expect(f.block.state.peek()).toMatchObject({ text: 'committed once', saved: 'committed once', conflict: null, error: '' });
  expect(f.call.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
});
it('clears drafts on sign-out and ignores an in-flight response from the previous session', async () => {
  const f = await setup(), { authState } = await import('../src/auth');
  let release!: (value: { ok: true; note: NoteMeta }) => void;
  f.call.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const pending = f.addNote(); authState.value = 'out';
  release({ ok: true, note: f.getHead() }); await pending;
  expect(f.blocks.peek()).toEqual([]);
  expect(f.hasUnsavedNotes()).toBe(false);
});
