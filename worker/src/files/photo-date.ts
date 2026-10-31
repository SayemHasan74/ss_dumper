import type { PhotoDate } from '../../../shared/types';
import { validPhotoTime } from '../../../shared/photo-date';
import { isUlid } from '../ids';
import { badRequest } from './validate';

export function parsePhotoDate(headers: Headers, now: number): PhotoDate | undefined {
  const raw = headers.get('X-Photo-Date'), source = headers.get('X-Photo-Date-Source'), assumed = headers.get('X-Photo-Timezone-Assumed');
  if (raw === null && source === null && assumed === null) return;
  if (raw === null || !/^-?\d+$/.test(raw) || !validPhotoTime(Number(raw), now) || !['capture', 'modified', 'upload'].includes(source ?? '') || !['0', '1', null].includes(assumed) || (assumed === '1' && source !== 'capture')) badRequest('photo date');
  return { at: Number(raw), source: source as PhotoDate['source'], timezoneAssumed: assumed === '1' };
}
export function parsePhotoCursor(raw: string): { at: number; id: string } {
  const match = /^p1\.(-?\d+)\.([0-9A-Z]{26})$/.exec(raw);
  // Cursors can outlive the timestamp validation window and are still bounded integers.
  if (!match || !Number.isSafeInteger(Number(match[1])) || !isUlid(match[2])) badRequest('cursor');
  return { at: Number(match[1]), id: match[2] };
}
export const photoCursor = (row: { id: string; photo_date?: number | null; created_at: number }): string => `p1.${row.photo_date ?? row.created_at}.${row.id}`;
