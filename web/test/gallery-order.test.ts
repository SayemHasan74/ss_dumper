import { expect, it, vi } from 'vitest';
import type { FileDTO } from '../../shared/types';
import { photoOrder } from '../../shared/photo-date';

vi.mock('../src/auth',async()=>{const {signal}=await import('@preact/signals');return {authState:signal('out')};});
vi.mock('../src/lib/api',()=>({api:vi.fn()}));
it('inserts old photos chronologically and refreshes changes below page one with composite pagination',async()=>{
  vi.stubGlobal('window',Object.assign(new EventTarget(),{scrollTo:vi.fn()}));vi.stubGlobal('document',Object.assign(new EventTarget(),{hidden:false}));vi.stubGlobal('navigator',{onLine:true});vi.stubGlobal('scrollY',0);
  try {
    const {api}=await import('../src/lib/api');
    const file=(n:number,date:number):FileDTO=>({id:String(n).padStart(26,'0'),name:`photo-${n}`,mime:'image/jpeg',size:1,width:null,height:null,thumbSize:0,note:'',pinned:false,tags:[],createdAt:2000000+n,deletedAt:null,expiresAt:null,photoDate:{at:date,source:'capture',timezoneAssumed:false}});
    let library=Array.from({length:130},(_,i)=>file(i+1,100000-i*100));
    vi.mocked(api).mockImplementation(async(path:string)=>{
      if(path==='/api/tags')return {ok:true,tags:[]} as any;if(path==='/api/settings')return {ok:true,autoExpireDays:30,trashDays:7} as any;
      const url=new URL(path,'https://test.local');expect(url.searchParams.get('sort')).toBe('photo');
      const sorted=[...library].sort(photoOrder),cursor=url.searchParams.get('cursor'),start=cursor?sorted.findIndex(f=>f.id===cursor)+1:0,limit=Number(url.searchParams.get('limit'));
      return {ok:true,files:sorted.slice(start,start+limit),nextCursor:sorted.length>start+limit?sorted[start+limit-1].id:null} as any;
    });
    const files=await import('../src/store/files'),{authState}=await import('../src/auth'),{filters}=await import('../src/store/ui');
    authState.value='in';await vi.waitFor(()=>expect(files.items.peek()).toHaveLength(48));
    const old=file(999,1);library.push(old);files.acceptUpload(old);expect(files.items.peek().at(-1)?.id).toBe(old.id);
    await files.loadMore();expect(files.items.peek()).toHaveLength(109);expect(files.items.peek()).toEqual([...files.items.peek()].sort(photoOrder));
    const external=file(500,92050);library.push(external);library=library.filter(f=>f.id!==String(70).padStart(26,'0'));
    await files.refresh();expect(files.items.peek().some(f=>f.id===external.id)).toBe(true);expect(files.items.peek().some(f=>f.id===String(70).padStart(26,'0'))).toBe(false);
    while(files.nextCursor.peek())await files.loadMore();expect(files.items.peek().map(f=>f.id)).toEqual([...library].sort(photoOrder).map(f=>f.id));
    filters.value={...filters.peek(),type:'pdf'};expect(files.listQuery(48)).not.toContain('sort=photo');
    files.trashMode.value=true;expect(files.listQuery(48)).not.toContain('sort=photo');authState.value='out';
  }finally{vi.unstubAllGlobals();}
});
