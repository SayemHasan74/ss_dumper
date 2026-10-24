import { expect, it } from 'vitest';
import { escapeLike, normalizeTag, parseDim, parseLimit, parseSha, parseTags } from '../src/files/validate';

it('normalizes and deduplicates tags while enforcing count and character limits', () => {
  expect(normalizeTag(' --Hello__ WORLD-- ')).toBe('hello-world');
  expect(parseTags(['One', 'one', 'Two Tags'])).toEqual(['one', 'two-tags']);
  expect(() => parseTags(['a','b','c','d','e','f'])).toThrow();
  for (const input of ['a!', '', 'a'.repeat(25), 'বাংলা']) expect(() => normalizeTag(input)).toThrow();
  expect(() => parseTags([1])).toThrow();
});
it('validates SHA, dimensions and limit clamping', () => {
  expect(parseSha('A'.repeat(64))).toBe('a'.repeat(64));
  expect(() => parseSha('a'.repeat(63))).toThrow();
  expect(parseDim('30000')).toBe(30000);
  for (const input of ['0','30001','2.5','']) expect(() => parseDim(input)).toThrow();
  expect(parseLimit()).toBe(60);
  expect(parseLimit('-5')).toBe(1);
  expect(parseLimit('999')).toBe(200);
  expect(() => parseLimit('1.5')).toThrow();
  expect(escapeLike('a_%\\b')).toBe('a\\_\\%\\\\b');
});
