import type { PhotoDate } from '../../../shared/types';
import { validPhotoTime } from '../../../shared/photo-date';

const BUDGET = 256 * 1024;
// DateTimeOriginal only: modification/creation tags are not verified capture dates.
function tiff(bytes: Uint8Array, now: number): PhotoDate | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const le = bytes[0] === 73 && bytes[1] === 73;
  if (!le && !(bytes[0] === 77 && bytes[1] === 77)) return;
  const u16 = (at: number) => view.getUint16(at, le), u32 = (at: number) => view.getUint32(at, le);
  if (u16(2) !== 42) return;
  const entries = (at: number): Map<number, { at: number; count: number; type: number }> => {
    const count = u16(at);
    if (count > 256 || at + 2 + count * 12 > bytes.length) throw new Error('Invalid IFD');
    const result = new Map<number, { at: number; count: number; type: number }>();
    for (let i = 0; i < count; i++) {
      const entry = at + 2 + i * 12, type = u16(entry + 2), size = u32(entry + 4);
      if (type === 2) {
        const value = size <= 4 ? entry + 8 : u32(entry + 8);
        if (size <= 64 && value + size <= bytes.length) result.set(u16(entry), { at: value, count: size, type });
      } else if (type === 4 && size === 1) result.set(u16(entry), { at: u32(entry + 8), count: 1, type });
    }
    return result;
  };
  const root = entries(u32(4)), pointer = root.get(0x8769);
  const exif = pointer?.type === 4 ? entries(pointer.at) : root;
  const text = (tag: number): string => { const value = exif.get(tag); return value?.type === 2 ? new TextDecoder().decode(bytes.subarray(value.at, value.at + value.count)).replace(/\0.*$/s, '').trim() : ''; };
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text(0x9003));
  if (!match) return;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const fraction = text(0x9291), ms = /^\d+$/.test(fraction) ? Number(fraction.slice(0, 3).padEnd(3, '0')) : 0;
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return;
  const zone = text(0x9011);
  let at: number;
  if (zone) {
    const offset = /^([+-])(\d{2}):(\d{2})$/.exec(zone);
    if (!offset || Number(offset[2]) > 14 || Number(offset[3]) > 59 || (Number(offset[2]) === 14 && Number(offset[3]) !== 0)) return;
    at = utc.getTime() - (offset[1] === '+' ? 1 : -1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60000;
  } else {
    const local = new Date(year, month - 1, day, hour, minute, second, ms);
    if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day || local.getHours() !== hour || local.getMinutes() !== minute) return;
    at = local.getTime();
  }
  if (validPhotoTime(at, now)) return { at, source: 'capture', timezoneAssumed: !zone };
}

export async function readPhotoDate(blob: Blob, modified: number, uploaded: number, now = Date.now()): Promise<PhotoDate> {
  let remaining = BUDGET;
  const read = async (at: number, size: number): Promise<Uint8Array> => {
    if (!Number.isSafeInteger(at) || at < 0 || size < 0 || at + size > blob.size || size > remaining) throw new Error('Metadata bounds');
    remaining -= size;
    return new Uint8Array(await blob.slice(at, at + size).arrayBuffer());
  };
  try {
    const header = await read(0, Math.min(12, blob.size));
    const ascii = (data: Uint8Array, start = 0, end = data.length) => String.fromCharCode(...data.subarray(start, end));
    let at = header[0] === 255 && header[1] === 216 ? 2 : header[0] === 137 && ascii(header, 1, 4) === 'PNG' ? 8 : ascii(header, 0, 4) === 'RIFF' && ascii(header, 8, 12) === 'WEBP' ? 12 : -1;
    for (let part = 0; at >= 0 && at < blob.size && part < 64; part++) {
      let data: Uint8Array | undefined;
      if (header[0] === 255) {
        const segment = await read(at, 4);
        if (segment[0] !== 255 || segment[1] === 0xda || segment[1] === 0xd9) break;
        if (segment[1] === 0xff) { at++; continue; }
        if (segment[1] === 0x01 || (segment[1] >= 0xd0 && segment[1] <= 0xd7)) { at += 2; continue; }
        const size = segment[2] * 256 + segment[3];
        if (size < 2) break;
        if (segment[1] === 0xe1) {
          const app = await read(at + 4, size - 2);
          if (ascii(app, 0, 6) === 'Exif\0\0') data = app.subarray(6);
        }
        at += 2 + size;
      } else {
        const chunk = await read(at, 8), png = header[0] === 137;
        const view = new DataView(chunk.buffer), size = view.getUint32(png ? 0 : 4, !png), name = ascii(chunk, png ? 4 : 0, png ? 8 : 4);
        if ((png && name === 'eXIf') || (!png && name === 'EXIF')) {
          data = await read(at + 8, size);
          if (ascii(data, 0, 6) === 'Exif\0\0') data = data.subarray(6);
        }
        at += 8 + size + (png ? 4 : size % 2);
        if (name === 'IEND') break;
      }
      if (data) { const date = tiff(data, now); if (date) return date; }
    }
  } catch { /* Unsupported, malformed or unreadable metadata uses the stable fallback. */ }
  return { at: modified > 0 && validPhotoTime(modified, now) ? modified : uploaded, source: modified > 0 && validPhotoTime(modified, now) ? 'modified' : 'upload', timezoneAssumed: false };
}
