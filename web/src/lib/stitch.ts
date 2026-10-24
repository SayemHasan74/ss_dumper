export const SHEET_MAX_WIDTH = 1440, SHEET_DEFAULT_WIDTH = 1170, SHEET_MIN_WIDTH = 600;
export const SHEET_PAD = 24, SHEET_GAP = 24, SHEET_MAX_IMAGES = 6, SHEET_MAX_AREA = 14000000, SHEET_MAX_HEIGHT = 16000;
export interface Dimensions { w: number; h: number }
export interface Sheet { indices: number[]; height: number; width: number; placements: { index: number; x: number; y: number; w: number; h: number }[] }
export function chronological<T extends { createdAt: number; id: string }>(files: T[]): T[] { return [...files].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)); }
export function sheetWidth(widths: (number | null)[]): number { const known = widths.filter((w): w is number => !!w && w > 0); return Math.max(SHEET_MIN_WIDTH, Math.min(SHEET_MAX_WIDTH, known.length ? Math.max(...known) : SHEET_DEFAULT_WIDTH)); }
export function planSheets(dims: Dimensions[], requestedWidth: number): Sheet[] {
  const width = sheetWidth([requestedWidth]), maxHeight = Math.min(SHEET_MAX_HEIGHT, Math.floor(SHEET_MAX_AREA / width));
  const result: Sheet[] = []; let sheet: Sheet | undefined;
  dims.forEach((dim, index) => {
    const scale = Math.min(1, (width - 2 * SHEET_PAD) / Math.max(1, dim.w));
    let w = Math.max(1, Math.floor(dim.w * scale)), h = Math.max(1, Math.ceil(dim.h * scale));
    const alone = h + 2 * SHEET_PAD > maxHeight;
    if (alone) { const ratio = (maxHeight - 2 * SHEET_PAD) / h; w = Math.max(1, Math.floor(w * ratio)); h = maxHeight - 2 * SHEET_PAD; }
    if (!sheet || alone || sheet.indices.length >= SHEET_MAX_IMAGES || sheet.height + SHEET_GAP + h > maxHeight) {
      sheet = { indices: [], height: SHEET_PAD * 2, width, placements: [] }; result.push(sheet);
    }
    const y = sheet.height - SHEET_PAD + (sheet.indices.length ? SHEET_GAP : 0);
    sheet.indices.push(index); sheet.placements.push({ index, x: Math.floor((width - w) / 2), y, w, h }); sheet.height = y + h + SHEET_PAD;
    if (alone) sheet = undefined;
  });
  return result;
}
export async function renderSheet(sheet: Sheet, loadBitmap: (index: number) => Promise<ImageBitmap>): Promise<Blob> {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(sheet.width, sheet.height) : Object.assign(document.createElement('canvas'), { width: sheet.width, height: sheet.height });
  const context = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('Canvas unavailable');
  context.fillStyle = '#fff'; context.fillRect(0, 0, sheet.width, sheet.height);
  try {
    for (const placement of sheet.placements) { const bitmap = await loadBitmap(placement.index); try { context.drawImage(bitmap, placement.x, placement.y, placement.w, placement.h); } finally { bitmap.close(); } }
    if (canvas instanceof HTMLCanvasElement) return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Canvas unavailable')), 'image/png'));
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally { canvas.width = 1; canvas.height = 1; }
}
