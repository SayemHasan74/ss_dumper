import type { FileDTO, SettingsDTO } from '../../../shared/types';
import type { FileRow } from './repo';

export function fileDTO(row: FileRow, settings: SettingsDTO): FileDTO {
  const tags: string[] = JSON.parse(row.tags);
  return {
    id: row.id, name: row.name, mime: row.mime, size: row.size, width: row.width, height: row.height,
    thumbSize: row.thumb_size, note: row.note, pinned: row.pinned === 1, tags: tags.sort(),
    createdAt: row.created_at, deletedAt: row.deleted_at,
    expiresAt: row.pinned || row.deleted_at !== null || !settings.autoExpireDays ? null : row.created_at + settings.autoExpireDays * 86400000,
  };
}
