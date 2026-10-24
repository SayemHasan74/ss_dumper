export type FileMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'application/pdf';
export const jpegMagicOk = (bytes: Uint8Array): boolean => bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
export function sniffMime(bytes: Uint8Array): FileMime | null {
  if (bytes.length < 12) return null;
  const matches = (magic: number[], offset = 0) => magic.every((byte, index) => bytes[index + offset] === byte);
  if (matches([137,80,78,71,13,10,26,10])) return 'image/png';
  if (jpegMagicOk(bytes)) return 'image/jpeg';
  if (matches([71,73,70,56]) && (bytes[4] === 55 || bytes[4] === 57) && bytes[5] === 97) return 'image/gif';
  if (matches([82,73,70,70]) && matches([87,69,66,80], 8)) return 'image/webp';
  if (matches([37,80,68,70,45])) return 'application/pdf';
  return null;
}
export function extForMime(mime: string): string {
  switch (mime) {
    case 'image/png': return '.png';
    case 'image/jpeg': return '.jpg';
    case 'image/gif': return '.gif';
    case 'image/webp': return '.webp';
    case 'application/pdf': return '.pdf';
    default: throw new Error('Unsupported stored MIME type.');
  }
}
