export async function peekPrefix(body: ReadableStream<Uint8Array>, n: number): Promise<{ prefix: Uint8Array; stream: ReadableStream<Uint8Array> }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let ended = false;
  try {
    while (total < n) {
      const chunk = await reader.read();
      if (chunk.done) { ended = true; break; }
      chunks.push(chunk.value);
      total += chunk.value.byteLength;
    }
  } catch (error) { reader.releaseLock(); throw error; }
  const prefix = new Uint8Array(Math.min(n, total));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, prefix.length - offset);
    prefix.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset === prefix.length) break;
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      chunks.length = 0;
      if (ended) { controller.close(); reader.releaseLock(); }
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) { controller.close(); reader.releaseLock(); }
        else controller.enqueue(chunk.value);
      } catch (error) { controller.error(error); reader.releaseLock(); }
    },
    async cancel(reason) { if (!ended) { await reader.cancel(reason); reader.releaseLock(); } },
  });
  return { prefix, stream };
}
