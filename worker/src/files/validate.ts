import { HttpError } from '../http';
import { LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT, MAX_TAGS_PER_FILE, NAME_MAX, TAG_REGEX } from './config';
import { extForMime } from './sniff';

export function badRequest(parameter: string): never { throw new HttpError(400, 'BAD_REQUEST', `Invalid ${parameter}.`); }
export function sanitizeName(raw: string, mime: string): string {
  let name = raw.normalize('NFC').replace(/[\ud800-\udfff]/gu, '').split(/[\\/]/).at(-1) ?? '';
  name = name.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff/:*?"<>|\\]/g, '')
    .replace(/\s+/gu, ' ').replace(/^[ .]+|[ .]+$/g, '') || 'file';
  const dot = name.lastIndexOf('.');
  let ext = dot > 0 ? name.slice(dot) : '';
  const valid = ext.toLowerCase() === extForMime(mime) || (mime === 'image/jpeg' && ext.toLowerCase() === '.jpeg');
  let base = dot > 0 ? name.slice(0, dot) : name;
  if (!valid) ext = extForMime(mime);
  base = Array.from(base).slice(0, NAME_MAX - Array.from(ext).length).join('') || 'file';
  return base + ext;
}
export function normalizeTag(value: string): string {
  const tag = value.trim().toLowerCase().replace(/[ _]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (!TAG_REGEX.test(tag)) badRequest('tag');
  return tag;
}
export function parseTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_TAGS_PER_FILE || !value.every((tag): tag is string => typeof tag === 'string')) badRequest('tags');
  return [...new Set(value.map(normalizeTag))];
}
export function parseSha(value: string): string {
  if (!/^[a-f0-9]{64}$/i.test(value)) badRequest('sha256');
  return value.toLowerCase();
}
export function parseDim(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 30000) badRequest('dimensions');
  return Number(value);
}
export function parseLimit(value?: string): number {
  if (value === undefined) return LIST_DEFAULT_LIMIT;
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) badRequest('limit');
  return Math.max(1, Math.min(LIST_MAX_LIMIT, Number(value)));
}
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, '\\$&');
