import { expect, it } from 'vitest';
import { extForMime, jpegMagicOk, sniffMime } from '../src/files/sniff';

const padded = (magic: number[]): Uint8Array => Uint8Array.from([...magic, ...Array<number>(16).fill(0)]);
it.each([
  [[137,80,78,71,13,10,26,10], 'image/png'], [[255,216,255], 'image/jpeg'],
  [[71,73,70,56,55,97], 'image/gif'], [[71,73,70,56,57,97], 'image/gif'],
  [[82,73,70,70,0,0,0,0,87,69,66,80], 'image/webp'], [[37,80,68,70,45], 'application/pdf'],
] as const)('recognizes magic %j', (magic, mime) => { expect(sniffMime(padded([...magic]))).toBe(mime); });
it('rejects truncated, text, HEIC, invalid GIF and non-WebP RIFF input', () => {
  for (const value of ['<svg>hello there', '<html>hello there', 'GIF86a123456789', 'RIFF1234OTHERxxxx', '0000ftypheicxxxx']) expect(sniffMime(new TextEncoder().encode(value))).toBeNull();
  expect(sniffMime(Uint8Array.from([255,216,255]))).toBeNull();
  expect(sniffMime(new Uint8Array())).toBeNull();
  expect(jpegMagicOk(Uint8Array.from([255,216,255]))).toBe(true);
  expect(extForMime('image/jpeg')).toBe('.jpg');
});
