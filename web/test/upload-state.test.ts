import { expect, it, vi } from 'vitest';
import { canonicalFor, chainLimit, dailyReset, eligible, finished, recoverJob, retentionLabel, type UploadJob } from '../src/upload/model';
import { ownsLease } from '../src/upload/persistence';

function job(change: Partial<UploadJob> = {}): UploadJob {
  return { id:'a',group:'selection',order:1,rev:1,originalName:'photo.png',name:'photo.png',mime:'image/png',size:123,modified:1,created:1,updated:1,submitted:true,selected:true,intent:'run',phase:'pending',retention:'retained',blocker:'',sessionOnly:false,hash:'hash',originalConfirmed:false,thumbnail:'needed',thumbBytes:0,width:null,height:null,uncertain:false,thumbUncertain:false,duplicate:false,attempt:0,nextRetry:0,error:'',cleanup:false,...change };
}
it('restores interrupted work as paused without losing uncertain outcome or manual intent',()=>{
  const recovered=recoverJob(job({phase:'original',uncertain:true,intent:'pause'}),true,false);
  expect(recovered).toMatchObject({phase:'pending',uncertain:true,intent:'pause',blocker:'restored',retention:'retained'});
  expect(eligible(recovered,Date.now())).toBe(false);
});
it('never labels missing bytes retained and does not need originals for stored thumbnails',()=>{
  expect(recoverJob(job(),false,false)).toMatchObject({retention:'missing',blocker:'missing'});
  expect(recoverJob(job({originalConfirmed:true,thumbnail:'stored',thumbBytes:9}),false,true)).toMatchObject({retention:'released',blocker:'restored',thumbnail:'stored'});
  expect(recoverJob(job({originalConfirmed:true,thumbnail:'stored'}),false,false).blocker).toBe('missing');
  expect(retentionLabel(job({retention:'saving'}))).toContain('Keep the app open');
});
it('retry eligibility respects review, manual pause, blockers, retry clocks and completion',()=>{
  expect(eligible(job(),10)).toBe(true);
  for(const change of [{submitted:false},{intent:'pause' as const},{blocker:'daily' as const},{retention:'unretained' as const},{nextRetry:11},{phase:'completed' as const}])expect(eligible(job(change),10)).toBe(false);
  expect(eligible(job({retention:'unretained',sessionOnly:true}),10)).toBe(true);
  expect(finished(job({blocker:'retry'}))).toBe(false);
  expect(finished(job({intent:'cancel'}))).toBe(true);
});
it('a duplicate depends on a runnable canonical, not a cancelled or failed uploader',()=>{
  const first=job(),second=job({id:'b',order:2});
  expect(canonicalFor(second,[first,second])?.id).toBe('a');
  expect(canonicalFor(second,[job({intent:'cancel'}),second])).toBeUndefined();
  expect(canonicalFor(second,[job({blocker:'retry'}),second])).toBeUndefined();
  expect(canonicalFor(second,[job({intent:'pause'}),second])).toBeUndefined();
});
it('fences reject expired leases and old owners even after their request returns',()=>{
  const lease={owner:'one',generation:4,expires:30000};
  expect(ownsLease(lease,lease,29999)).toBe(true);
  expect(ownsLease(lease,lease,30000)).toBe(false);
  expect(ownsLease({...lease,owner:'two',generation:5},lease,1)).toBe(false);
  expect(ownsLease({...lease,generation:5},lease,1)).toBe(false);
});
it('daily reset is the next UTC midnight (06:00 Dhaka)',()=>{
  expect(dailyReset(Date.UTC(2026,9,30,23,59))).toBe(Date.UTC(2026,9,31));
});
it('uses one chain for touch, 3G and saveData, with three for a normal desktop',()=>{
  try {
    vi.stubGlobal('matchMedia',()=>({matches:false}));vi.stubGlobal('navigator',{});expect(chainLimit()).toBe(3);
    vi.stubGlobal('navigator',{connection:{effectiveType:'3g'}});expect(chainLimit()).toBe(1);
    vi.stubGlobal('navigator',{connection:{saveData:true}});expect(chainLimit()).toBe(1);
    vi.stubGlobal('navigator',{});vi.stubGlobal('matchMedia',()=>({matches:true}));expect(chainLimit()).toBe(1);
  } finally { vi.unstubAllGlobals(); }
});
