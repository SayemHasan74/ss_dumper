import { mkdirSync, writeFileSync } from 'node:fs';
import { createRaster, fillRect, fillRoundRect, thickLine, rasterPng } from './lib/png.mjs';

const output = new URL('../web/public/icons/', import.meta.url);
mkdirSync(output, { recursive: true });
const accent = [79, 70, 229, 255], white = [255, 255, 255, 255];
for (const [name, size, fullBleed, maskable] of [
  ['icon-192.png', 192, false, false], ['icon-512.png', 512, false, false],
  ['icon-512-maskable.png', 512, true, true], ['apple-touch-icon-180.png', 180, true, false], ['favicon-32.png', 32, false, false],
]) {
  const raster = createRaster(size * 4, size * 4), scale = size * 4 / 512;
  if (fullBleed) fillRect(raster, 0, 0, raster.width, raster.height, accent);
  else fillRoundRect(raster, 0, 0, raster.width, raster.height, 112 * scale, accent);
  const point = n => (256 + (n - 256) * (maskable ? .8 : 1)) * scale;
  const line = (x1, y1, x2, y2) => thickLine(raster, point(x1), point(y1), point(x2), point(y2), 36 * scale * (maskable ? .8 : 1), white);
  line(136, 300, 136, 372); line(136, 372, 376, 372); line(376, 372, 376, 300);
  line(256, 120, 256, 300); line(196, 240, 256, 300); line(256, 300, 316, 240);
  const png = rasterPng(raster, 4); writeFileSync(new URL(name, output), png);
  console.log(`${name}: ${png.length} bytes`);
}
