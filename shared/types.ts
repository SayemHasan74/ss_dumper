export interface FileDTO {
  id: string; name: string; mime: string; size: number;
  width: number | null; height: number | null;
  thumbSize: number; note: string; pinned: boolean; tags: string[];
  createdAt: number; deletedAt: number | null; expiresAt: number | null;
}
export interface StatsDTO { count: number; photoCount: number; bytes: number; trashCount: number; trashBytes: number; capBytes: number }
export interface SettingsDTO { autoExpireDays: number; trashDays: number }
export type ErrorCode = 'BAD_REQUEST' | 'EMPTY_FILE' | 'CHECKSUM_MISMATCH' | 'SIZE_MISMATCH' | 'UNAUTHENTICATED'
  | 'FORBIDDEN_SCOPE' | 'CSRF' | 'NOT_FOUND' | 'NO_THUMB' | 'IN_TRASH' | 'NOT_IN_TRASH' | 'DUPLICATE_EXISTS'
  | 'NOT_IMAGE' | 'LENGTH_REQUIRED' | 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED' | 'DAILY_LIMIT' | 'INTERNAL' | 'STORAGE_FULL';
