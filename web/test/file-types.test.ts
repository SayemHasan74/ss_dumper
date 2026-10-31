import { expect, it } from 'vitest';
import { fileMime } from '../src/upload/names';
import { fileExtension, matchesFileType, textPreviewable } from '../src/lib/file-type';

it('admits arbitrary file types as inert general files without trusting declared active MIME',()=>{
  for(const [name,type] of [['README.md','text/markdown'],['app.ts','video/mp2t'],['page.html','text/html'],['image.svg','image/svg+xml'],['photo.heic','image/heic'],['data.zip','application/zip'],['unknown','']])expect(fileMime(new File(['x'],name,{type}))).toBe('application/octet-stream');
  expect(fileMime(new File(['x'],'photo.png',{type:'image/png'}))).toBe('image/png');
});
it('separates general files from images and PDFs for queue/gallery filtering',()=>{
  expect(matchesFileType('application/octet-stream','file')).toBe(true);
  expect(matchesFileType('image/png','file')).toBe(false);expect(matchesFileType('application/pdf','file')).toBe(false);
  expect(matchesFileType('application/octet-stream','image')).toBe(false);expect(matchesFileType('application/pdf','pdf')).toBe(true);
});
it('offers source preview only for known text extensions and safe display labels',()=>{
  expect(fileExtension('app.d.ts')).toBe('TS');expect(fileExtension('file')).toBe('FILE');
  for(const name of ['page.html','README.md','app.tsx','.gitignore'])expect(textPreviewable(name)).toBe(true);
  for(const name of ['archive.zip','program.exe','image.png'])expect(textPreviewable(name)).toBe(false);
});
