import { afterEach, expect, it, vi } from 'vitest';
import { ulidFloor } from '../src/ids';
import * as storageModule from '../src/files/storage';
import type { Storage } from '../src/files/storage';
import { fixture, start } from './helpers';

afterEach(() => vi.restoreAllMocks());
async function setup(quotaExceeded: boolean) {
  vi.spyOn(console,'log').mockImplementation(()=>{});
  const f=await fixture();
  const id=ulidFloor(start);
  const row={id,name:'test.png',mime:'image/png',size:16,width:null,height:null,thumb_size:12,note:'',pinned:0,created_at:start,deleted_at:start,tags:'[]'};
  const batch=vi.fn(async()=>[{results:[],meta:{changes:0}},{results:[row],meta:{changes:1}}]);
  const prepare=(sql:string)=>{
    const statement={bind:(_value:unknown)=>statement,first:async()=>sql.includes('COUNT(*)')?{count:0}:row,all:async()=>({results:[row]})};
    return statement;
  };
  f.env.DB={prepare,batch} as unknown as D1Database;
  const remove=vi.fn(async()=>({failed:1,quotaExceeded}));
  vi.spyOn(storageModule,'storageFor').mockReturnValue({deleteMany:remove} as unknown as Storage);
  const cookie=await f.getCookie();
  const request=(path:string,method:string,json?:unknown)=>f.request(path,{method,headers:{Cookie:cookie,'x-dump-client':'1','Content-Type':'application/json'},body:json===undefined?undefined:JSON.stringify(json)});
  return {id,remove,batch,request};
}
it.each(['bulk','empty'] as const)('returns DAILY_LIMIT after D1 deletion for %s purge',async(kind)=>{
  const f=await setup(true);
  const response=kind==='bulk'?await f.request('/api/files/bulk','POST',{action:'purge',ids:[f.id]}):await f.request('/api/trash/empty','POST');
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({error:{code:'DAILY_LIMIT'}});
  expect(f.batch).toHaveBeenCalledOnce();
  expect(f.remove).toHaveBeenCalledExactlyOnceWith([`f/${f.id}`,`t/${f.id}`]);
  expect(f.batch.mock.invocationCallOrder[0]).toBeLessThan(f.remove.mock.invocationCallOrder[0]);
});
it('keeps permanent single-file deletion successful despite quota failure',async()=>{
  const f=await setup(true);
  expect((await f.request(`/api/files/${f.id}/permanent`,'DELETE')).status).toBe(200);
  expect(f.remove).toHaveBeenCalledOnce();
});
it('keeps non-quota deletion failures successful for orphan cleanup',async()=>{
  const f=await setup(false);
  const response=await f.request('/api/trash/empty','POST');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ok:true,purged:1,remaining:0});
});
