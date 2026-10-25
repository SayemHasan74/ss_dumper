import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../src/auth', async () => {
  const { signal } = await import('@preact/signals');
  return { authState: signal('in') };
});
vi.mock('../src/store/files', async () => {
  const { signal } = await import('@preact/signals');
  return { localItems: signal([]), acceptUpload: vi.fn() };
});
vi.mock('../src/store/ui', () => ({ showToast: vi.fn() }));
vi.mock('../src/upload/hash', () => ({ sha256Hex: vi.fn(async (file: File) => file.name.padEnd(64, '0')) }));
vi.mock('../src/upload/thumb', () => ({ createThumbnail: vi.fn(async () => ({ blob: new Blob(['thumbnail'], { type: 'image/jpeg' }), width: 4032, height: 3024 })) }));
vi.mock('../src/upload/xhr', () => {
  let next = 0;
  return {
    recoverRequests: vi.fn(),
    UploadError: class extends Error {},
    xhr: vi.fn(async (path: string) => path === '/api/upload/check' ? { existing: {} }
      : path.startsWith('/api/thumb') ? { thumbSize: 9 }
        : { duplicate: false, file: { id: String(++next), mime: 'image/jpeg', createdAt: next } }),
  };
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uploads a 66-photo batch without publishing full-size originals as image previews', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal('navigator', { onLine: true });
  const previews = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:thumbnail-${Math.random()}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const { enqueue, uploads, cancelUpload, clearFinished } = await import('../src/upload/queue');
  const { acceptUpload } = await import('../src/store/files');
  const { xhr } = await import('../src/upload/xhr');
  const files = Array.from({ length: 66 }, (_, i) => new File(['original'], `photo-${i}.jpg`, { type: 'image/jpeg' }));
  try {
    enqueue(files);
    expect(uploads.peek()).toHaveLength(66);
    expect(uploads.peek().every((item) => item.previewUrl === '')).toBe(true);
    await vi.waitFor(() => expect(uploads.peek().every((item) => item.status === 'done')).toBe(true));
    expect(acceptUpload).toHaveBeenCalledTimes(66);
    expect(previews).toHaveBeenCalledTimes(66);
    for (const [blob] of previews.mock.calls) {
      expect(files).not.toContain(blob);
      if (!(blob instanceof Blob)) throw new Error('Expected a thumbnail Blob');
      expect(blob.size).toBe(9);
    }
    const originals = vi.mocked(xhr).mock.calls.filter(([path]) => path === '/api/upload');
    expect(originals).toHaveLength(66);
    expect(new Set(originals.map(([, body]) => body))).toEqual(new Set(files));
  } finally { cancelUpload(); clearFinished(); }
});
