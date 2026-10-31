import { deflateSync } from 'node:zlib';

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type, bytes) {
  const content = Buffer.concat([Buffer.from(type), bytes]);
  let crc = 0xffffffff;
  for (const byte of content) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length, 0);
  content.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
export function makePng(width, height, seed) {
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 4096)) throw new RangeError('Invalid PNG dimensions.');
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(height * (width * 3 + 1));
  let random = (Number(seed) >>> 0) || 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width * 3; x += 1) {
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
      pixels[y * (width * 3 + 1) + 1 + x] = random & 255;
    }
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

// Small synthetic capture-date fixture. Original image bytes remain otherwise unchanged.
export function withCaptureDate(png, date, offset = '+00:00') {
  const tiff = Buffer.alloc(256); tiff.write('II'); tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);
  tiff.writeUInt16LE(1,8);tiff.writeUInt16LE(0x8769,10);tiff.writeUInt16LE(4,12);tiff.writeUInt32LE(1,14);tiff.writeUInt32LE(26,18);
  tiff.writeUInt16LE(offset?2:1,26);let next=56;
  [date,offset].forEach((text,i)=>{if(!text)return;const at=28+i*12;tiff.writeUInt16LE(i?0x9011:0x9003,at);tiff.writeUInt16LE(2,at+2);tiff.writeUInt32LE(text.length+1,at+4);tiff.writeUInt32LE(next,at+8);tiff.write(text,next);next+=text.length+1;});
  return Buffer.concat([png.subarray(0,33),chunk('eXIf',tiff.subarray(0,next)),png.subarray(33)]);
}

export function createRaster(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}
function paint(raster, x, y, color) { raster.data.set(color, (y * raster.width + x) * 4); }
export function fillRect(raster, x, y, width, height, color) {
  for (let py = Math.max(0, Math.floor(y)); py < Math.min(raster.height, Math.ceil(y + height)); py++)
    for (let px = Math.max(0, Math.floor(x)); px < Math.min(raster.width, Math.ceil(x + width)); px++) paint(raster, px, py, color);
}
export function fillRoundRect(raster, x, y, width, height, radius, color) {
  for (let py = Math.max(0, Math.floor(y)); py < Math.min(raster.height, Math.ceil(y + height)); py++) {
    for (let px = Math.max(0, Math.floor(x)); px < Math.min(raster.width, Math.ceil(x + width)); px++) {
      const cx = Math.max(x + radius, Math.min(x + width - radius, px + .5));
      const cy = Math.max(y + radius, Math.min(y + height - radius, py + .5));
      if ((px + .5 - cx) ** 2 + (py + .5 - cy) ** 2 <= radius ** 2) paint(raster, px, py, color);
    }
  }
}
export function thickLine(raster, x1, y1, x2, y2, width, color) {
  const radius = width / 2, dx = x2 - x1, dy = y2 - y1, lengthSquared = dx * dx + dy * dy;
  for (let y = Math.max(0, Math.floor(Math.min(y1, y2) - radius)); y < Math.min(raster.height, Math.ceil(Math.max(y1, y2) + radius)); y++) {
    for (let x = Math.max(0, Math.floor(Math.min(x1, x2) - radius)); x < Math.min(raster.width, Math.ceil(Math.max(x1, x2) + radius)); x++) {
      const t = lengthSquared ? Math.max(0, Math.min(1, ((x + .5 - x1) * dx + (y + .5 - y1) * dy) / lengthSquared)) : 0;
      if ((x + .5 - x1 - t * dx) ** 2 + (y + .5 - y1 - t * dy) ** 2 <= radius ** 2) paint(raster, x, y, color);
    }
  }
}
export function rasterPng(raster, samples = 4) {
  const width = raster.width / samples, height = raster.height / samples;
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new RangeError('Raster dimensions must match supersampling.');
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let red = 0, green = 0, blue = 0, alpha = 0;
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
      const offset = ((y * samples + sy) * raster.width + x * samples + sx) * 4, a = raster.data[offset + 3];
      red += raster.data[offset] * a; green += raster.data[offset + 1] * a; blue += raster.data[offset + 2] * a; alpha += a;
    }
    const offset = y * (width * 4 + 1) + 1 + x * 4;
    pixels[offset] = alpha ? Math.round(red / alpha) : 0; pixels[offset + 1] = alpha ? Math.round(green / alpha) : 0;
    pixels[offset + 2] = alpha ? Math.round(blue / alpha) : 0; pixels[offset + 3] = Math.round(alpha / samples ** 2);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
