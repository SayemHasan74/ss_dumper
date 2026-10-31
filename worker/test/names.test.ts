import { expect, it } from 'vitest';
import { sanitizeName } from '../src/files/validate';
it('preserves general-file extensions and dotfiles while removing paths and control characters',()=>{
  for(const name of ['README.md','index.html','types.d.ts','archive.tar.gz','.gitignore','without-extension'])expect(sanitizeName(name,'application/octet-stream')).toBe(name);
  expect(sanitizeName('../../code/app.ts','application/octet-stream')).toBe('app.ts');
  expect(sanitizeName('a\r\n<script>.html','application/octet-stream')).toBe('ascript.html');
  expect(sanitizeName('..','application/octet-stream')).toBe('file');
  const long=sanitizeName('ক'.repeat(300)+'.tsx','application/octet-stream');expect(long.endsWith('.tsx')).toBe(true);expect(Array.from(long)).toHaveLength(200);
});

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
