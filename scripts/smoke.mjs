import { createHash, randomBytes } from 'node:crypto';
import { makePng } from './lib/png.mjs';

const base = (process.env.SMOKE_BASE_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const production = new URL(base).protocol === 'https:' || process.argv.includes('--prod');
if (new URL(base).protocol === 'https:' && !process.argv.includes('--prod')) {
  console.error('HTTPS requires --prod; refusing the destructive local suite.'); process.exit(1);
}
const access = process.env.SMOKE_ACCESS_KEY;
const token = process.env.SMOKE_UPLOAD_TOKEN;
if (!access || !token) {
  console.error('Set SMOKE_ACCESS_KEY and SMOKE_UPLOAD_TOKEN before running the local smoke test.');
  process.exit(1);
}
let cookie = '';
let savedSettings;
let seed = randomBytes(4).readUInt32BE();
const prefix = `smoke-${randomBytes(8).toString('hex')}`;
const created = new Set();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function check(condition, label) { if (!condition) throw new Error(label); }
async function request(path, { method = 'GET', json, bytes, headers = {}, bearer = false, anonymous = false, csrf = true } = {}) {
  const response = await fetch(base + path, {
    method, headers: {
      ...(csrf ? { 'x-dump-client': '1' } : {}),
      ...(anonymous ? {} : bearer ? { Authorization: `Bearer ${token}` } : cookie ? { Cookie: cookie } : {}),
      ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(bytes === undefined ? {} : { 'Content-Length': String(bytes.byteLength) }), ...headers,
    }, body: json === undefined ? bytes : JSON.stringify(json),
  });
  return response;
}
async function json(path, options, status = 200) {
  const response = await request(path, options);
  check(response.status === status, `Unexpected HTTP status during smoke check (expected ${status}, got ${response.status}).`);
  return response.json();
}
async function add(name, bytes = makePng(64, 64, ++seed), mime = 'application/octet-stream') {
  const response = await json('/api/upload', { method:'POST', bytes, bearer:true, headers:{'Content-Type':mime,'X-File-Name':encodeURIComponent(name),'X-Content-Sha256':sha(bytes),'X-Width':'64','X-Height':'64'} },201);
  check(response.ok && !response.duplicate, 'Unique upload rejected.');
  created.add(response.file.id);
  return { file:response.file, bytes };
}
async function bulk(action, ids, tag) { return json('/api/files/bulk', { method:'POST', json:{action,ids,...(tag ? {tag} : {})} }); }
async function step(label, work) { await work(); console.log(`PASS ${label}`); }

try {
  const login = await request('/api/auth/login', { method:'POST',json:{key:access},anonymous:true });
  check(login.status === 200, 'Login failed.');
  cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  check(Boolean(cookie), 'No session cookie returned.');
  if (production) {
    console.log('Production safe subset: one tiny unique PNG; about 3 KV operations (1 write, 1 read, 1 delete). No settings changes or Empty Trash.');
    const item = await add(`${prefix}.png`);
    await step('production list only the test file', async () => check((await json(`/api/files?q=${prefix}`)).files.some(file => file.id === item.file.id), 'Test upload missing from list.'));
    await step('production authenticated fetch', async () => { const response = await request(`/api/files/${item.file.id}/original`); check(response.ok && Buffer.from(await response.arrayBuffer()).equals(item.bytes), 'Original fetch failed.'); });
    await step('production trash and purge only the test file', async () => { await json(`/api/files/${item.file.id}`, { method: 'DELETE' }); await json(`/api/files/${item.file.id}/permanent`, { method: 'DELETE' }); created.delete(item.file.id); });
  } else {
  savedSettings = await json('/api/settings');
  let first;
  let second;
  let third;
  await step('1 upload and duplicate detection', async () => {
    first = await add(`${prefix}-one space-ছবি.png`, undefined, 'image/png');
    check(first.file.width === 64 && first.file.height === 64 && first.file.name === `${prefix}-one space-ছবি.png`, 'Browser dimensions or encoded name were not stored.');
    const browserHeaders = { 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent(first.file.name), 'X-Content-Sha256': sha(first.bytes), 'X-Width': '64', 'X-Height': '64' };
    const batchHashes = [first.bytes, first.bytes].map(sha);
    const uniqueHashes = [...new Set(batchHashes)];
    const batchCheck = await json('/api/upload/check', { method: 'POST', json: { hashes: uniqueHashes } });
    check(uniqueHashes.length === 1 && batchCheck.existing[uniqueHashes[0]] === first.file.id, 'Duplicate-in-batch preflight failed.');
    const duplicate = await json('/api/upload',{method:'POST',bytes:first.bytes,headers:browserHeaders});
    check(duplicate.duplicate && duplicate.file.id === first.file.id, 'Duplicate detection failed.');
  });
  await step('2 preflight and rejected upload validation', async () => {
    const existing = await json('/api/upload/check',{method:'POST',bearer:true,json:{hashes:[sha(first.bytes)]}});
    check(existing.existing[sha(first.bytes)] === first.file.id, 'Preflight failed.');
    const before = await json('/api/stats');
    for(const [name,bytes] of [[`${prefix}.svg`,Buffer.from('<svg><script>throw 1</script></svg>')],[`${prefix}.bin`,Buffer.from([255,216,255])]]){
      const file=await add(name,bytes,'text/html');
      check(file.file.mime==='application/octet-stream'&&file.file.name===name,'General file type/name not preserved safely.');
      const response=await request(`/api/files/${file.file.id}/original`);
      check(response.headers.get('Content-Type')==='application/octet-stream'&&response.headers.get('Content-Disposition').startsWith('attachment;')&&response.headers.get('Content-Security-Policy')==="default-src 'none'; sandbox",'General file was not an inert download.');
      check(Buffer.from(await response.arrayBuffer()).equals(bytes),'General file bytes changed.');
      await json(`/api/files/${file.file.id}`,{method:'DELETE'});await json(`/api/files/${file.file.id}/permanent`,{method:'DELETE'});created.delete(file.file.id);
    }
    check((await json('/api/stats')).count === before.count,'Rejected upload changed stats.');
    check((await request('/api/upload',{method:'POST',bearer:true,bytes:Buffer.alloc(26*1024*1024)})).status === 413,'Oversized upload accepted.');
  });
  await step('3 JPEG thumbnail upload', async () => {
    const thumb = await json(`/api/thumb?id=${first.file.id}`,{method:'POST',bearer:true,bytes:Buffer.from([255,216,255,224,0,16,74,70,73,70,0,0])});
    check(thumb.thumbSize > 0,'Thumbnail missing.');
    check((await request(`/api/thumb?id=${first.file.id}`,{method:'POST',bearer:true,bytes:first.bytes})).status === 415,'PNG thumbnail accepted.');
  });
  await step('4 newest-first lists, cursor and filters', async () => {
    second = await add(`${prefix}-two.png`); third = await add(`${prefix}-three.png`);
    const list = await json(`/api/files?q=${prefix}`);
    check(list.files.length === 3 && list.nextCursor === null,'Initial list incorrect.');
    check(list.files.every((file,index,array)=>!index||array[index-1].id>file.id),'Ordering incorrect.');
    check(list.files.every(file=>Array.isArray(file.tags)&&file.tags.length===0),'Unexpected tags.');
    const found=[]; let cursor;
    do { const page=await json(`/api/files?q=${prefix}&limit=1${cursor ? '&cursor='+cursor : ''}`); found.push(...page.files.map(file=>file.id)); cursor=page.nextCursor; } while(cursor);
    check(found.length===3&&new Set(found).size===3,'Pagination incorrect.');
    check((await json(`/api/files?q=${prefix}&type=image`)).files.length===3,'Image filter incorrect.');
    check((await json(`/api/files?q=${prefix}&type=pdf`)).files.length===0,'PDF filter incorrect.');
    const since=first.file.createdAt, until=third.file.createdAt;
    check((await json(`/api/files?q=${prefix}&since=${since}&until=${until}`)).files.length===3,'Date filters incorrect.');
    check((await json(`/api/files?q=${prefix}&until=${since-1}`)).files.length===0,'Upper date filter incorrect.');
    const pdf=await add(`${prefix}-certificate.pdf`,Buffer.from('%PDF-1.7\n%%EOF\n'),'text/plain');
    check(pdf.file.mime==='application/pdf','Sniff did not override claimed type.');
    check((await json(`/api/files?q=${prefix}&type=pdf`)).files.length===1,'PDF filter missing PDF.');
  });
  await step('5 whole-file serving, ETags and download headers', async () => {
    const path=`/api/files/${first.file.id}/original`;
    const response=await request(path);
    check(response.status===200&&Buffer.from(await response.arrayBuffer()).equals(first.bytes),'Original bytes changed.');
    check(response.headers.get('Content-Type')==='image/png','Wrong original MIME.');
    check(Number(response.headers.get('Content-Length'))===first.bytes.length,'Wrong length.');
    check(response.headers.get('Accept-Ranges')==='none','Wrong range policy.');
    check(response.headers.get('Cache-Control')==='private, max-age=31536000, immutable','Wrong cache policy.');
    const range=await request(path,{headers:{Range:'bytes=0-9'}});
    check(range.status===200&&Buffer.from(await range.arrayBuffer()).equals(first.bytes),'Range request was not served whole.');
    check((await request(path,{headers:{'If-None-Match':response.headers.get('ETag')}})).status===304,'Conditional response failed.');
    check((await request(path,{method:'HEAD'})).status===200,'HEAD failed.');
    const download=await request(path+'?download=1'); check(download.headers.get('Content-Disposition').startsWith('attachment;'),'Download disposition failed.'); await download.body.cancel();
    const thumb=await request(`/api/files/${first.file.id}/thumb`); check(thumb.headers.get('Content-Type')==='image/jpeg','Wrong thumbnail MIME.'); await thumb.body.cancel();
  });
  await step('6 metadata edits and extension enforcement', async () => {
    const edited=await json(`/api/files/${first.file.id}`,{method:'PATCH',json:{name:'renamed',note:'one\ntwo',tags:['Work','my tag'],pinned:true}});
    check(edited.file.name==='renamed.png'&&edited.file.tags.join(',')==='my-tag,work'&&edited.file.pinned&&edited.file.expiresAt===null,'Metadata edits failed.');
    check((await request(`/api/files/${first.file.id}`,{method:'PATCH',json:{tags:['a','b','c','d','e','f']}})).status===400,'Six tags accepted.');
    check((await json('/api/files?pinned=1')).files.some(file=>file.id===first.file.id),'Pinned filter failed.');
    check((await json('/api/files?tag=my-tag')).files.some(file=>file.id===first.file.id),'Tag filter failed.');
  });
  await step('7 Trash, duplicate restore conflicts, and permanent deletion', async () => {
    const id=first.file.id;
    check((await request(`/api/files/${id}/permanent`,{method:'DELETE'})).status===409,'Active file permanently deleted.');
    await json(`/api/files/${id}`,{method:'DELETE'});
    check(!(await json('/api/files')).files.some(file=>file.id===id),'Trashed file stayed active.');
    check((await json('/api/files?trash=1')).files.some(file=>file.id===id),'Trash list omitted file.');
    const replacement=await add(`${prefix}-replacement.png`,first.bytes);
    check((await request(`/api/files/${id}/restore`,{method:'POST'})).status===409,'Duplicate restore conflict missed.');
    await json(`/api/files/${replacement.file.id}`,{method:'DELETE'}); await json(`/api/files/${replacement.file.id}/permanent`,{method:'DELETE'}); created.delete(replacement.file.id);
    await json(`/api/files/${id}/restore`,{method:'POST'});
    await json(`/api/files/${id}`,{method:'DELETE'}); await json(`/api/files/${id}/permanent`,{method:'DELETE'}); created.delete(id);
    check((await request(`/api/files/${id}/original`)).status===404,'Purged original still served.');
    check((await request(`/api/files/${id}/thumb`)).status===404,'Purged thumbnail still served.');
  });
  await step('8 bulk actions and purge bounds', async () => {
    const extra=await add(`${prefix}-four.png`); const ids=[second.file.id,third.file.id,extra.file.id];
    for(const action of ['trash','restore','pin','unpin','tag_add','tag_remove']) check((await bulk(action,ids,action.startsWith('tag_')?'bulk-tag':undefined)).affected===3,'Bulk affected count incorrect.');
    await bulk('trash',ids); check((await bulk('purge',ids)).affected===3,'Bulk purge failed.'); ids.forEach(id=>created.delete(id));
    const tooMany=Array.from({length:101},(_,index)=>'0'.repeat(10)+index.toString(16).toUpperCase().padStart(16,'0'));
    check((await request('/api/files/bulk',{method:'POST',json:{action:'purge',ids:tooMany}})).status===400,'101-file purge accepted.');
  });
  await step('9 tags, stats and settings', async () => {
    check(Array.isArray((await json('/api/tags')).tags),'Tags response invalid.');
    check((await json('/api/stats')).capBytes===900000000,'Storage cap incorrect.');
    await json('/api/settings',{method:'PATCH',json:{autoExpireDays:7,trashDays:3}});
    const settings=await json('/api/settings'); check(settings.autoExpireDays===7&&settings.trashDays===3,'Settings cache not refreshed.');
    check((await request('/api/settings',{method:'PATCH',json:{autoExpireDays:8}})).status===400,'Invalid retention accepted.');
    const pdf=[...created][0]; await json(`/api/files/${pdf}`,{method:'DELETE'}); const empty=await json('/api/trash/empty',{method:'POST'}); check(empty.purged>=1,'Empty Trash did not purge.'); created.delete(pdf);
  });
  await step('10 scope and CSRF boundaries', async () => {
    check((await request('/api/files',{bearer:true})).status===403,'Bearer read access allowed.');
    check((await request('/api/files',{anonymous:true})).status===401,'Anonymous access allowed.');
    check((await request('/api/settings',{method:'PATCH',json:{trashDays:7},csrf:false})).status===403,'Mutation without CSRF header allowed.');
    check((await request('/api/settings',{method:'PATCH',json:{trashDays:7},headers:{Origin:'https://wrong.example'}})).status===403,'Wrong Origin allowed.');
    check((await request('/api/settings',{method:'PATCH',json:{trashDays:7},headers:{'Sec-Fetch-Site':'cross-site'}})).status===403,'Cross-site mutation allowed.');
    check((await request('/api/files',{headers:{'Sec-Fetch-Site':'cross-site'}})).status===403,'Cross-site read allowed.');
  });
  }
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : 'Smoke test failed.'}`);
  process.exitCode=1;
} finally {
  if(cookie) {
    try {
      const ids=[...created];
      if(ids.length) { await bulk('trash',ids); for(let offset=0;offset<ids.length;offset+=100) await bulk('purge',ids.slice(offset,offset+100)); }
      if(savedSettings) await json('/api/settings',{method:'PATCH',json:{autoExpireDays:savedSettings.autoExpireDays,trashDays:savedSettings.trashDays}});
    } catch { console.error('FAIL smoke cleanup; inspect local test state.'); process.exitCode=1; }
  }
}
