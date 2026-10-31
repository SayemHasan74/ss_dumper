import type { FileDTO, PhotoDate } from './types';

export function validPhotoTime(at: number, now = Date.now()): boolean {
  return Number.isSafeInteger(at) && at >= -5364662400000 && at <= now + 86400000;
}
export const effectiveDate = (file: FileDTO): number => file.mime.startsWith('image/') ? file.photoDate?.at ?? file.createdAt : file.createdAt;
export const photoOrder = (a: FileDTO, b: FileDTO): number => effectiveDate(b) - effectiveDate(a) || b.id.localeCompare(a.id);
export function photoDateLabel(date?: PhotoDate): string {
  return date?.source === 'capture' ? `Capture date${date.timezoneAssumed ? ' (uploader timezone assumed)' : ''}` : date?.source === 'modified' ? 'File modification date (capture date unavailable)' : 'Upload date (capture date unavailable)';
}
