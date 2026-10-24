import { expect, it, vi } from 'vitest';
import { peekPrefix } from '../src/files/stream';

it.each([{chunks:[[1,2],[3],[4,5]]}, {chunks:[[1,2,3,4,5]]}, {chunks:[[1,2]]}])('peeks and replays chunk boundaries $chunks', async ({ chunks }) => {
  const bytes = chunks.flat();
  const source = new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk)); controller.close(); } });
  const result = await peekPrefix(source, 4);
  expect([...result.prefix]).toEqual(bytes.slice(0, 4));
  expect([...new Uint8Array(await new Response(result.stream).arrayBuffer())]).toEqual(bytes);
});
it('cancels the source when the replay is cancelled', async () => {
  const cancel = vi.fn();
  const result = await peekPrefix(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Uint8Array.from([1,2,3,4])); }, cancel }), 2);
  await result.stream.cancel();
  expect(cancel).toHaveBeenCalledOnce();
});
