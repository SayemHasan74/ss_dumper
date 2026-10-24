import { expect, it } from 'vitest';
import { sanitizeName } from '../src/files/validate';

it('removes paths, control characters, bidi formatting and invisible characters', () => {
  expect(sanitizeName('../../etc/passwd.png', 'image/png')).toBe('passwd.png');
  expect(sanitizeName('C:\\folder\\photo.png', 'image/png')).toBe('photo.png');
  expect(sanitizeName('ph\u202eoto\u200b\u0000.png', 'image/png')).toBe('photo.png');
  expect(sanitizeName(' ..  hello   world.png.. ', 'image/png')).toBe('hello world.png');
});
it('preserves extensions within the 200-code-point limit', () => {
  const name = sanitizeName('ক'.repeat(300) + '.png', 'image/png');
  expect(Array.from(name).length).toBe(200);
  expect(name.endsWith('.png')).toBe(true);
});
it('enforces MIME extensions and preserves Unicode', () => {
  expect(sanitizeName('', 'image/png')).toBe('file.png');
  expect(sanitizeName('photo.png', 'image/jpeg')).toBe('photo.jpg');
  expect(sanitizeName('photo', 'image/png')).toBe('photo.png');
  expect(sanitizeName('Photo.JPEG', 'image/jpeg')).toBe('Photo.JPEG');
  expect(sanitizeName('আমার ছবি.png', 'image/png')).toBe('আমার ছবি.png');
  expect(sanitizeName('photo\ud800.png', 'image/png')).toBe('photo.png');
  expect(sanitizeName('photo📷.png', 'image/png')).toBe('photo📷.png');
});
