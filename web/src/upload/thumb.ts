export interface Thumbnail { blob: Blob; width: number; height: number }
export async function createThumbnail(blob: Blob): Promise<Thumbnail | null> {
  let bitmap: ImageBitmap | undefined;
  let url = '';
  try {
    let source: CanvasImageSource;
    let width: number, height: number;
    try {
      bitmap = await createImageBitmap(blob);
      source = bitmap; width = bitmap.width; height = bitmap.height;
    } catch {
      url = URL.createObjectURL(blob);
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Decode failed')); image.src = url; });
      source = image; width = image.naturalWidth; height = image.naturalHeight;
    }
    if (!width || !height) return null;
    const scale = Math.min(1, 480 / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const context = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context) return null;
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, w, h);
    context.drawImage(source, 0, 0, w, h);
    const jpeg = canvas instanceof HTMLCanvasElement
      ? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
      : await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    return jpeg ? { blob: jpeg, width, height } : null;
  } catch { return null; }
  finally { bitmap?.close(); if (url) URL.revokeObjectURL(url); }
}
