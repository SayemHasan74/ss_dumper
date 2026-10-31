import { expect, it, vi } from 'vitest';
import { createRepo } from '../src/files/repo';
import { fileDTO } from '../src/files/dto';
import { parsePhotoDate, parsePhotoCursor, photoCursor } from '../src/files/photo-date';
import { ulidFloor } from '../src/ids';

it('validates timestamp headers and composite cursors without accepting malformed values',()=>{
  const now=Date.UTC(2026,9,31), headers=(at:string,source='capture',assumed='0')=>new Headers({'X-Photo-Date':at,'X-Photo-Date-Source':source,'X-Photo-Timezone-Assumed':assumed});
  expect(parsePhotoDate(new Headers(),now)).toBeUndefined();
  expect(parsePhotoDate(headers('1600000000000','capture','1'),now)).toMatchObject({timezoneAssumed:true});
  for(const h of [headers('NaN'),headers('1.5'),headers('9999999999999999'),headers(String(now+86400001)),headers('1600000000000','no'),headers('1600000000000','modified','1'),new Headers({'X-Photo-Date-Source':'capture'})])expect(()=>parsePhotoDate(h,now)).toThrow();
  const id=ulidFloor(now);expect(parsePhotoCursor(`p1.-1000.${id}`)).toEqual({at:-1000,id});
  for(const cursor of [id,'p1.NaN.'+id,'p1.1.bad','p1.9007199254740992.'+id])expect(()=>parsePhotoCursor(cursor)).toThrow();
});

it('orders a migrated library globally by photo date with stable ties and unchanged upload-time filters/expiry',async()=>{
  const {DatabaseSync}=await vi.importActual<any>('node:sqlite'), {readFileSync}=await vi.importActual<any>('node:fs');
  const sqlite=new DatabaseSync(':memory:');
  try {
    sqlite.exec(readFileSync('migrations/0001_init.sql','utf8'));
    const now=Date.UTC(2026,9,31), old=Date.UTC(2020,0,1), legacy=ulidFloor(now-1000);
    sqlite.prepare('INSERT INTO files(id,name,mime,size,created_at) VALUES(?,?,?,?,?)').run(legacy,'legacy','image/jpeg',1,now-1000);
    sqlite.exec(readFileSync('migrations/0003_photo_dates.sql','utf8'));
    const db={prepare:(sql:string)=>({bind:(...args:unknown[])=>({all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>{sqlite.prepare(sql).run(...args);}})})} as unknown as D1Database;
    const repo=createRepo(db);
    for(let i=0;i<73;i++)await repo.insert({id:ulidFloor(now+i),name:`photo-${i}`,mime:'image/jpeg',size:1,width:null,height:null,thumb_size:0,note:'',pinned:0,created_at:now+i,deleted_at:null,tags:'[]',photo_date:old+(i%17)*1000,photo_date_source:'capture',photo_timezone_assumed:i%2},null);
    const all=[];let cursor:ReturnType<typeof parsePhotoCursor>|undefined;
    do {const page=await repo.list({limit:10,trash:false,sort:'photo',photoCursor:cursor});const more=page.length>10;if(more)page.pop();all.push(...page);cursor=more?parsePhotoCursor(photoCursor(page.at(-1)!)):undefined;}while(cursor);
    expect(all).toHaveLength(74);expect(new Set(all.map(row=>row.id)).size).toBe(74);expect(all[0].id).toBe(legacy);
    for(let i=1;i<all.length;i++){const a=all[i-1],b=all[i];expect((a.photo_date??a.created_at)>(b.photo_date??b.created_at)||((a.photo_date??a.created_at)===(b.photo_date??b.created_at)&&a.id>b.id)).toBe(true);}
    const filtered=await repo.list({limit:200,trash:false,sort:'photo',since:ulidFloor(now)});expect(filtered).toHaveLength(73);
    const dto=fileDTO(filtered[0],{autoExpireDays:30,trashDays:7});expect(dto.photoDate?.source).toBe('capture');expect(dto.photoDate!.at).toBeLessThan(now);expect(dto.expiresAt).toBe(dto.createdAt+30*86400000);
    const legacyDTO=fileDTO(all[0],{autoExpireDays:30,trashDays:7});expect(legacyDTO.photoDate).toEqual({at:now-1000,source:'upload',timezoneAssumed:false});
    const defaultOrder=await repo.list({limit:200,trash:false});expect(defaultOrder.map(row=>row.id)).toEqual(defaultOrder.map(row=>row.id).sort().reverse());
    expect(sqlite.prepare("EXPLAIN QUERY PLAN SELECT id FROM files WHERE deleted_at IS NULL ORDER BY COALESCE(photo_date,created_at) DESC,id DESC LIMIT 10").all().some((row:any)=>row.detail.includes('idx_files_photo_active'))).toBe(true);
  }finally{sqlite.close();}
});
