import { expect, it } from 'vitest';
import { readPhotoDate } from '../src/upload/photo-date';

function jpeg(date: string, offset = '+06:00'): Blob {
  const strings = [date, offset], bytes = new Uint8Array(256), view = new DataView(bytes.buffer);
  bytes.set([73,73,42,0,8,0,0,0]); view.setUint16(8,1,true);
  view.setUint16(10,0x8769,true); view.setUint16(12,4,true); view.setUint32(14,1,true); view.setUint32(18,26,true);
  view.setUint16(26,offset?2:1,true); let next=56;
  strings.forEach((text,i)=>{if(!text)return;const at=28+i*12;view.setUint16(at,i?0x9011:0x9003,true);view.setUint16(at+2,2,true);view.setUint32(at+4,text.length+1,true);view.setUint32(at+8,next,true);bytes.set(new TextEncoder().encode(text),next);next+=text.length+1;});
  const exif = new Uint8Array(6+next); exif.set([69,120,105,102,0,0]);exif.set(bytes.subarray(0,next),6);
  return new Blob([new Uint8Array([255,216,255,225,(exif.length+2)>>8,(exif.length+2)&255]),exif,new Uint8Array([255,217])]);
}
const now=Date.UTC(2026,9,31), modified=Date.UTC(2024,1,1), uploaded=now-1000;
it('uses DateTimeOriginal with explicit offset, independent of the viewing device',async()=>{
  expect(await readPhotoDate(jpeg('2022:07:09 12:30:45'),modified,uploaded,now)).toEqual({at:Date.UTC(2022,6,9,6,30,45),source:'capture',timezoneAssumed:false});
});
it('resolves a missing offset once in the uploader timezone and marks the assumption',async()=>{
  expect(await readPhotoDate(jpeg('2022:07:09 12:30:45',''),modified,uploaded,now)).toEqual({at:new Date(2022,6,9,12,30,45).getTime(),source:'capture',timezoneAssumed:true});
});
it('falls back safely for malformed, impossible, future and unsupported metadata',async()=>{
  for(const blob of [jpeg('2022:02:30 12:00:00'),jpeg('2035:01:01 00:00:00'),jpeg('not a date'),jpeg('2022:07:09 12:30:45','+18:00'),new Blob(['unknown']),new Blob([new Uint8Array([255,216,255,225,255,255])])])expect(await readPhotoDate(blob,modified,uploaded,now)).toEqual({at:modified,source:'modified',timezoneAssumed:false});
  for(const time of [0,NaN,Infinity,now+86400001])expect(await readPhotoDate(new Blob(['x']),time,uploaded,now)).toEqual({at:uploaded,source:'upload',timezoneAssumed:false});
});
it('never reads more than 256 KiB, skips large image payloads and does not decode images',async()=>{
  const blob=new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,8,0,0,101,88,73,102]),new Uint8Array(1024*1024)]);
  let read=0;const slice=blob.slice.bind(blob);blob.slice=(start=0,end=blob.size)=>{read+=end-start;return slice(start,end);};
  expect((await readPhotoDate(blob,modified,uploaded,now)).source).toBe('modified');expect(read).toBeLessThanOrEqual(256*1024);
});
