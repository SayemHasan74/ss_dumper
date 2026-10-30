import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../src/auth', async () => { const {signal}=await import('@preact/signals');return {authState:signal('in')}; });
vi.mock('../src/lib/router',()=>({navigate:vi.fn()}));
vi.mock('../src/store/files',async()=>{const {signal}=await import('@preact/signals');return {localItems:signal([]),acceptUpload:vi.fn(),updateThumbnail:vi.fn()};});
vi.mock('../src/store/ui',()=>({showToast:vi.fn()}));
vi.mock('../src/upload/hash',()=>({sha256Hex:vi.fn(async(file:File)=>file.name.padEnd(64,'0'))}));
vi.mock('../src/upload/thumb',()=>({createThumbnail:vi.fn(async()=>({blob:new Blob(['thumbnail'],{type:'image/jpeg'}),width:4032,height:3024}))}));
vi.mock('../src/upload/persistence',()=>{
  const jobs=new Map<string,Record<string,unknown>>(),originals=new Map<string,Blob>(),thumbs=new Map<string,Blob>();
  return {LocalStoreError:class extends Error{},reserveOrder:vi.fn(async()=>Date.now()*1000+jobs.size),pageJobs:vi.fn(async()=>[]),getSetting:vi.fn(async()=>undefined),setSetting:vi.fn(async()=>{}),getJob:vi.fn(async(id:string)=>jobs.get(id)),getBlob:vi.fn(async(id:string,thumb=false)=>(thumb?thumbs:originals).get(id)),acquireLease:vi.fn(async(owner:string)=>({owner,generation:1,expires:Date.now()+30000})),releaseLease:vi.fn(async()=>{}),checkOwnership:vi.fn(async()=>{}),saveJob:vi.fn(async(job:Record<string,unknown>,opts:{original?:Blob;thumbnail?:Blob;dropOriginal?:boolean;dropThumbnail?:boolean;remove?:boolean}={})=>{const next={...job,rev:Number(job.rev)+1};if(opts.remove)jobs.delete(String(job.id));else jobs.set(String(job.id),next);if(opts.original)originals.set(String(job.id),opts.original);if(opts.thumbnail)thumbs.set(String(job.id),opts.thumbnail);if(opts.dropOriginal)originals.delete(String(job.id));if(opts.dropThumbnail)thumbs.delete(String(job.id));return next;}),retain:vi.fn(async(job:Record<string,unknown>,blob:Blob)=>{originals.set(String(job.id),blob);const next={...job,rev:Number(job.rev)+1,retention:'retained'};jobs.set(String(job.id),next);return next;})};
});
vi.mock('../src/upload/xhr',()=>{
  let next=0;const files=new Map<string,unknown>();
  return {recoverRequests:vi.fn(),UploadError:class extends Error{},xhr:vi.fn(async(path:string,body:Blob|null)=>{if(path==='/api/upload/check')return {existing:{}};if(path==='/api/auth/session')return {scope:'full'};if(path.startsWith('/api/files/'))return {file:files.get(path.split('/')[3])};if(path.startsWith('/api/thumb'))return {thumbSize:9};const file={id:String(++next),name:'photo.jpg',mime:'image/jpeg',size:body!.size,thumbSize:0,deletedAt:null,createdAt:next};files.set(file.id,file);return {duplicate:false,file};})};
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('retains and uploads 66 photos with only thumbnail storage and unchanged original bytes',async()=>{
  vi.stubGlobal('window',new EventTarget());vi.stubGlobal('document',Object.assign(new EventTarget(),{hidden:false}));vi.stubGlobal('navigator',{onLine:true});
  const previews=vi.spyOn(URL,'createObjectURL').mockImplementation(()=>`blob:thumbnail-${Math.random()}`);vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  const {enqueue,uploads}=await import('../src/upload/queue');const {acceptUpload}=await import('../src/store/files');const {xhr}=await import('../src/upload/xhr');const {retain}=await import('../src/upload/persistence');
  const files=Array.from({length:66},(_,i)=>new File(['original'],`photo-${i}.jpg`,{type:'image/jpeg'}));enqueue(files);
  await vi.waitFor(()=>expect(uploads.peek()).toHaveLength(66),{timeout:10000});await vi.waitFor(()=>expect(uploads.peek().every(item=>item.status==='done')).toBe(true),{timeout:10000});
  expect(retain).toHaveBeenCalledTimes(66);expect(acceptUpload).toHaveBeenCalledTimes(66);expect(previews).not.toHaveBeenCalled();
  const originals=vi.mocked(xhr).mock.calls.filter(([path])=>path==='/api/upload');expect(originals).toHaveLength(66);
  for(const [,body]of originals)expect(await body!.text()).toBe('original');
});
