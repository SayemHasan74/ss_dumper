export interface NoteMeta { id: string; version: string; chunks: number; createdAt: number; updatedAt: number }
export const NOTE_CHUNK_CHARS = 8192;
export const NOTE_PAGE_CHUNKS = 4;
export const NOTE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function splitNote(text: string): string[] {
  const result: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + NOTE_CHUNK_CHARS, text.length);
    const code = text.charCodeAt(end - 1);
    if (end < text.length && code >= 0xd800 && code <= 0xdbff) end--;
    result.push(text.slice(start, end));
    start = end;
  }
  return result;
}
