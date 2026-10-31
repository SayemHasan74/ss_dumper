import { authState } from '../auth';
import { acceptUpload, localItems, updateThumbnail, type LocalFile } from '../store/files';
import type { FileDTO, StatsDTO } from '../../../shared/types';
import { records, uploads, busy, queueMessage, foreground, queueReady, enabled, otherRunner, progress } from './state';
import { canonicalFor, chainLimit, dailyReset, eligible, finished, jobLabel, recoverJob, type Fence, type UploadJob } from './model';
import * as db from './persistence';
import { sha256Hex } from './hash';
import { createThumbnail } from './thumb';
import { fileMime, uploadName } from './names';
import { prepare } from './work';
import { recoverRequests, UploadError, xhr } from './xhr';

const owner = crypto.randomUUID(), files = new Map<string, File>(), durable = new Set<string>();
interface Attempt { controller: AbortController; epoch: number; fence?: Fence }
const active = new Map<string, Attempt>();
let initialized: Promise<void> | undefined, session = 0, intakeSession = 0, retaining = false, sequence = Date.now() * 1000;
let fence: Fence | undefined, releaseLock: (() => void) | undefined, claiming = false, backgroundRunning = false, webLocksUnavailable = false;
let tick: ReturnType<typeof setTimeout> | undefined, heartbeat: ReturnType<typeof setInterval> | undefined;
let probing = false, connectionLost = false, probeStep = 0, nextProbe = 0, lastProbe = 0, probeController: AbortController | undefined;
let probePromise: Promise<boolean> | undefined;
let dailyUntil = 0, serverFull = false, channel: BroadcastChannel | undefined;
const signedIn = () => authState.peek() === 'in';
const visible = () => signedIn() && !document.hidden;
const current = (id: string) => records.peek().find(job => job.id === id);
function notify(): void { channel?.postMessage({ owner }); }
function publish(): void {
  if (!signedIn()) return;
  if (!records.peek().some(job => !finished(job)) && /^(Found |Waiting for connection|Daily limit reached|Server storage is)/.test(queueMessage.peek())) queueMessage.value = '';
  uploads.value = records.peek().filter(job => job.submitted).map(job => ({ id: job.id, localId: job.id, name: job.name, mime: job.mime, size: job.size, width: job.width, height: job.height, thumbSize: job.server?.thumbSize ?? 0, note: '', pinned: false, tags: [], createdAt: job.created, deletedAt: null, expiresAt: null, previewUrl: '', progress: progress.peek()[job.id] ?? 0, status: job.phase === 'completed' ? job.duplicate ? 'duplicate' : 'done' : job.intent === 'cancel' ? 'cancelled' : job.blocker === 'retry' || job.blocker === 'unsupported' || job.blocker === 'local' || job.blocker === 'missing' ? 'failed' : job.intent === 'pause' || job.blocker ? 'waiting' : job.phase === 'original' || job.phase === 'thumbnail' ? 'uploading' : 'queued', message: jobLabel(job) } satisfies LocalFile));
  localItems.value = uploads.peek().filter(item => !['done', 'duplicate', 'cancelled'].includes(item.status) && current(item.id)?.submitted);
  busy.value = active.size > 0;
  updateWake();
}
function put(job: UploadJob): void { records.value = records.peek().some(old => old.id === job.id) ? records.peek().map(old => old.id === job.id ? job : old) : [...records.peek(), job]; publish(); }
function assertAttempt(id: string, token: Attempt): void {
  if (!signedIn() || token.epoch !== session || token.controller.signal.aborted || active.get(id) !== token || current(id)?.intent !== 'run') throw new UploadError(0, 'ABORT');
  if (token.fence && (token.fence.generation !== fence?.generation || token.fence.owner !== fence.owner)) throw new UploadError(0, 'ABORT');
}
async function checkpoint(job: UploadJob, change: Partial<UploadJob>, token?: Attempt, blobs: Parameters<typeof db.saveJob>[1] = {}): Promise<UploadJob> {
  if (token) assertAttempt(job.id, token);
  let next = { ...job, ...change };
  if (token && durable.has(job.id) && !token.fence) throw new db.LocalStoreError('ownership', 'Upload ownership was lost.');
  if (durable.has(job.id)) next = await db.saveJob(next, { ...blobs, fence: token?.fence });
  else if (!job.sessionOnly) throw new db.LocalStoreError('unavailable', 'Latest upload state could not be saved. Keep this page open.');
  if (token) assertAttempt(job.id, token);
  if (!signedIn()) throw new UploadError(0, 'ABORT');
  put(next); notify(); return next;
}
async function refreshRecords(): Promise<void> {
  if (!signedIn()) return;
  const generation = intakeSession, loaded: UploadJob[] = [];
  let cursor: number | undefined;
  do { const page = await db.pageJobs(cursor); loaded.push(...page); cursor = page.length === 200 ? page.at(-1)!.order : undefined; } while (cursor !== undefined);
  if (!signedIn() || generation !== intakeSession) return;
  const byId = new Map(loaded.map(job => [job.id, job]));
  for (const job of records.peek()) {
    const stored = byId.get(job.id);
    if (!stored && !durable.has(job.id)) loaded.push(job);
    if (stored && stored.rev < job.rev) { loaded.splice(loaded.indexOf(stored), 1, job); continue; }
    if (stored && stored.rev !== job.rev) active.get(job.id)?.controller.abort();
    if (!stored && durable.has(job.id)) { active.get(job.id)?.controller.abort(); files.delete(job.id); durable.delete(job.id); }
  }
  loaded.forEach(job => { if (byId.has(job.id)) durable.add(job.id); });
  records.value = loaded.sort((a,b) => a.order - b.order); publish();
}
export function initialize(): Promise<void> {
  if (initialized) return initialized;
  initialized = (async () => {
    const generation = intakeSession;
    enabled.value = false;
    try {
      const block = await db.getSetting<{ dailyUntil: number; serverFull: boolean }>('blockers');
      dailyUntil = block?.dailyUntil ?? 0; serverFull = block?.serverFull ?? false;
      const lease = await db.getSetting<Fence>('lease');
      const runningElsewhere = !!lease && lease.owner !== owner && lease.expires > Date.now();
      otherRunner.value = runningElsewhere;
      const rows: UploadJob[] = []; let cursor: number | undefined;
      do { const page = await db.pageJobs(cursor); rows.push(...page); cursor = page.length === 200 ? page.at(-1)!.order : undefined; } while (cursor !== undefined);
      const restored: UploadJob[] = [];
      for (const row of rows) {
        if (!signedIn() || intakeSession !== generation) return;
        durable.add(row.id); sequence = Math.max(sequence, row.order + 1);
        if (finished(row) && row.updated < Date.now() - 30 * 86400000) {
          try { await db.saveJob(row, { remove: true }); durable.delete(row.id); continue; }
          catch (error) { if (!(error instanceof db.LocalStoreError) || error.kind !== 'changed') throw error; }
        }
        let job = row;
        if (!finished(row)) {
          const original = await db.getBlob(row.id), thumbnail = row.thumbnail === 'stored' ? await db.getBlob(row.id, true) : undefined;
          if (!runningElsewhere) job = recoverJob(row, original instanceof Blob && original.size === row.size, thumbnail instanceof Blob && thumbnail.size === row.thumbBytes);
        }
        restored.push(job);
      }
      if (!signedIn() || intakeSession !== generation) return;
      records.value=restored; publish();
      if (typeof BroadcastChannel !== 'undefined') { channel ??= new BroadcastChannel('dump-uploads'); channel.onmessage = event => { if (event.data?.owner !== owner && signedIn()) void refreshRecords().then(() => schedule()).catch(localFailure); }; }
      const count = records.peek().filter(job => !finished(job)).length;
      if (count) queueMessage.value = `Found ${count} unfinished uploads on this device. Resume when you’re ready.`;
      await cleanup();
    } catch { queueMessage.value = 'Local recovery storage is unavailable or blocked. Keep this page open; open Uploads for recovery choices.'; }
    finally { if (signedIn() && generation === intakeSession) { queueReady.value = true; publish(); } }
  })();
  return initialized;
}
function localFailure(error: unknown): void {
  queueMessage.value = error instanceof db.LocalStoreError ? error.message : 'Local upload state could not be saved. Keep this page open.';
}
export async function enqueue(selection: File[], pasted: boolean): Promise<void> {
  await initialize(); if (!signedIn()) return;
  const generation = intakeSession;
  const review = selection.length > 100, group = crypto.randomUUID();
  for (const [index, file] of selection.entries()) {
    if (!signedIn() || generation !== intakeSession) return;
    const mime = fileMime(file), invalid = file.size > 25 * 1024 * 1024 || !mime;
    const job: UploadJob = { id: crypto.randomUUID(), group, order: sequence++, rev: 0, originalName: file.name, name: uploadName(file, index, pasted), mime: mime ?? file.type, size: file.size, modified: file.lastModified, created: Date.now(), updated: Date.now(), submitted: !review, selected: true, intent: 'run', phase: 'pending', retention: 'saving', blocker: invalid ? 'unsupported' : '', sessionOnly: false, hash: '', originalConfirmed: false, thumbnail: mime?.startsWith('image/') ? 'needed' : 'none', thumbBytes: 0, width: null, height: null, uncertain: false, thumbUncertain: false, duplicate: false, attempt: 0, nextRetry: 0, error: invalid ? 'Unsupported type or file larger than 25 MiB.' : '', cleanup: false };
    files.set(job.id, file); put(job);

  }
  enabled.value = true; notify(); void retainNext(); schedule();
}
async function retainNext(): Promise<void> {
  if (retaining || !signedIn()) return;
  retaining = true; const generation = intakeSession;
  try {
    for (;;) {
      const job = records.peek().find(row => row.retention === 'saving' && !finished(row) && files.has(row.id));
      if (!job || !signedIn() || generation !== intakeSession) break;
      const file = files.get(job.id)!;
      try {
        let initial = job;
        if (!durable.has(job.id)) {
          initial = await db.saveJob({ ...job, order:await db.reserveOrder() }, { create: true });
          if (!signedIn() || generation !== intakeSession) break;
          const latest = current(job.id);
          if (!latest || finished(latest)) { await db.saveJob(initial, { remove:true }); continue; }
          durable.add(job.id);
          initial = { ...initial, intent:latest.intent, submitted:latest.submitted, selected:latest.selected, group:latest.group };
          put(initial);
        }
        const saved = await db.retain(initial, file);
        if (!signedIn() || generation !== intakeSession) break;
        files.delete(job.id); put(saved); notify(); schedule();
      } catch (error) {
        if (!signedIn() || generation !== intakeSession) break;
        if (!current(job.id) || finished(current(job.id)!)) continue;
        if (error instanceof db.LocalStoreError && error.kind === 'changed') { await refreshRecords().catch(localFailure); continue; }
        if (signedIn() && generation === intakeSession) {
          for (const remaining of records.peek()) if (remaining.retention === 'saving' && !finished(remaining)) put({ ...remaining, retention:'unretained', blocker:'local', error:'Not saved locally. Keep this page open or select this file again later.' });
          break;
        }
      }
    }
  } finally { retaining = false; if (generation !== intakeSession && signedIn()) void retainNext(); }
}
function abortAll(): void { session++; probeController?.abort(); for (const token of active.values()) token.controller.abort(); }
async function relinquish(): Promise<void> {
  if (heartbeat) clearInterval(heartbeat); heartbeat = undefined;
  const old = fence; fence = undefined;
  if (old) await db.releaseLease(old).catch(localFailure);
  releaseLock?.(); releaseLock = undefined;
}
async function claim(): Promise<boolean> {
  if (backgroundRunning) return false;
  if (fence && fence.expires > Date.now()) return true;
  if (claiming || backgroundRunning || !visible()) return false;
  claiming = true;
  try {
    const acquire = async () => {
      fence = await db.acquireLease(owner);
      otherRunner.value = !fence;
      if (fence && !heartbeat) heartbeat = setInterval(() => { if (!visible()) return; void db.acquireLease(owner).then(next => { if (!next || next.generation !== fence?.generation) { abortAll(); fence = undefined; otherRunner.value = true; void relinquish(); } else fence = next; }).catch(() => { abortAll(); void relinquish(); }); }, 10000);
      return !!fence;
    };
    if (navigator.locks && !webLocksUnavailable && !releaseLock) {
      return await new Promise<boolean>((resolve, reject) => {
        void navigator.locks.request('dump-uploads-runner', { ifAvailable: true }, async lock => {
          if (!lock) { otherRunner.value = true; resolve(false); return; }
          const held = new Promise<void>(release => { releaseLock = release; });
          try { resolve(await acquire()); if (fence) await held; } catch (error) { reject(error); } finally { releaseLock = undefined; }
        }).catch(reject);
      });
    }
    return await acquire();
  } catch {
    if (navigator.locks && !webLocksUnavailable) { webLocksUnavailable=true;claiming=false;return await claim(); }
    // A purely session-only job has no shared durable bytes or recoverable runner.
    return records.peek().some(job => job.sessionOnly && !durable.has(job.id));
  } finally { claiming = false; }
}
function schedule(delay = 0): void { clearTimeout(tick); if (visible() && enabled.peek()) tick = setTimeout(() => { void pump(); }, delay); }
async function pump(): Promise<void> {
  if (!visible() || !enabled.peek()) return;
  const hasIntent = records.peek().some(job => job.submitted && job.intent === 'run' && !finished(job) && !['restored','retry','unsupported','local','missing','server-full'].includes(job.blocker));
  if (!hasIntent && !active.size) { await relinquish(); busy.value = false; return; }
  if (dailyUntil > Date.now() || serverFull) { publish(); if (!active.size) await relinquish(); if (!serverFull) schedule(Math.min(60000, Math.max(1000, dailyUntil - Date.now()))); return; }
  if (connectionLost || !navigator.onLine) { if (!probing && Date.now() >= nextProbe) void probe(); schedule(1000); return; }
  if (dailyUntil) { dailyUntil = 0; for (const job of records.peek()) if (job.blocker === 'daily') await control(job, { blocker: '', nextRetry: 0 }); await saveBlockers(); }
  const runnable = records.peek().filter(job => eligible(job, Date.now()) && !active.has(job.id));
  if (!runnable.length && !active.size) { busy.value = false; await relinquish(); schedule(1000); return; }
  if (!await claim()) { schedule(3000); return; }
  for (const job of runnable) {
    if (active.size >= chainLimit()) break;
    const dependency = job.canonical ? current(job.canonical) : undefined;
    if (dependency && !finished(dependency) && dependency.intent === 'run' && !dependency.blocker) continue;
    const token: Attempt = { controller: new AbortController(), epoch: session, fence:fence?{...fence}:undefined }; active.set(job.id, token); void runJob(job.id, token);
  }
  publish(); schedule(1000);
}
async function remote<T>(path: string, token: Attempt, body: Blob | null = null, headers?: Record<string,string>, onProgress?: (value: number) => void): Promise<T> {
  if (body && token.fence) await db.checkOwnership(token.fence);
  if (token.controller.signal.aborted || !visible()) throw new UploadError(0, 'ABORT');
  return xhr<T>(path, body, { signal: token.controller.signal, method: body ? 'POST' : 'GET', headers, progress: onProgress });
}
async function runJob(id: string, token: Attempt): Promise<void> {
  let job = current(id)!;
  try {
    assertAttempt(id, token);
    // Reconciliation always precedes another original request, including lost JSON responses.
    if (!job.originalConfirmed) {
      let original: File | undefined;
      if (!job.hash) {
        job = await checkpoint(job, { phase: 'hashing' }, token);
        const blob = files.get(id) ?? await db.getBlob(id);
        if (!blob || blob.size !== job.size) throw new db.LocalStoreError('missing', 'Original file needed.');
        original = new File([blob], job.originalName, { type: job.mime, lastModified: job.modified });
        const hash = await prepare(async () => { assertAttempt(id, token); return sha256Hex(original!); });
        job = await checkpoint(job, { hash }, token);
      }
      const canonical = canonicalFor(job, records.peek());
      if (canonical && !canonical.originalConfirmed) { job = await checkpoint(job, { canonical: canonical.id, phase: 'checking' }, token); return; }
      job = await checkpoint(job, { phase: 'checking', canonical: undefined }, token);
      const checked = await remote<{ existing: Record<string,string> }>('/api/upload/check', token, new Blob([JSON.stringify({ hashes: [job.hash] })]), { 'Content-Type':'application/json' });
      assertAttempt(id, token);
      if (checked.existing[job.hash]) {
        const metadata = await remote<{ file: FileDTO }>(`/api/files/${checked.existing[job.hash]}`, token);
        job = await checkpoint(job, { originalConfirmed: true, uncertain: false, server: metadata.file, duplicate: true, phase: 'thumbnail', thumbnail: !metadata.file.mime.startsWith('image/') ? 'none' : metadata.file.thumbSize ? 'confirmed' : job.thumbnail }, token);
      } else {
        const blob = original ?? files.get(id) ?? await db.getBlob(id);
        if (!blob || blob.size !== job.size) throw new db.LocalStoreError('missing', 'Original file needed.');
        const file = blob instanceof File ? blob : new File([blob], job.originalName, { type: job.mime, lastModified: job.modified });
        if (job.thumbnail === 'needed') job = await makeThumb(job, file, token);
        job = await checkpoint(job, { phase: 'original', uncertain: true }, token);
        const response = await remote<{ file: FileDTO; duplicate: boolean }>('/api/upload', token, file, { 'Content-Type':job.mime || 'application/octet-stream', 'X-File-Name':encodeURIComponent(job.name), 'X-Content-Sha256':job.hash, ...(job.width && job.height ? { 'X-Width':String(job.width), 'X-Height':String(job.height) } : {}) }, value => { if (active.get(id) === token && !token.controller.signal.aborted) { progress.value = { ...progress.peek(), [id]:value }; } });
        if (!response.file?.id || typeof response.file.size !== 'number') throw new UploadError(0,'INTERNAL');
        job = await checkpoint(job, { originalConfirmed: true, uncertain: false, server: response.file, duplicate: response.duplicate, phase: 'thumbnail', thumbnail: !response.file.mime.startsWith('image/') ? 'none' : response.file.thumbSize ? 'confirmed' : job.thumbnail, attempt: 0 }, token);
      }
    }
    if (job.thumbnail === 'stored' && job.retention === 'retained') job = await checkpoint(job, { retention:'released' }, token, { dropOriginal:true });
    if (job.thumbnail !== 'none' && job.thumbnail !== 'confirmed') {
      let metadata: FileDTO;
      try { metadata = (await remote<{ file: FileDTO }>(`/api/files/${job.server!.id}`, token)).file; }
      catch (error) { if (error instanceof UploadError && error.status === 404) { await complete(job, token, 'Previously uploaded; file no longer available'); return; } throw error; }
      if (metadata.deletedAt !== null) { await complete(job, token, 'Previously uploaded; file no longer available'); return; }
      if (metadata.thumbSize) job = await checkpoint(job, { thumbnail:'confirmed', thumbUncertain:false, server:metadata }, token);
      else {
        if (job.thumbnail === 'needed') {
          const blob = files.get(id) ?? await db.getBlob(id);
          if (!blob) throw new db.LocalStoreError('missing','Original file needed.');
          job = await makeThumb(job, blob, token);
        }
        const thumbnail = await db.getBlob(id, true).catch(() => undefined) ?? volatileThumbs.get(id);
        if (!thumbnail || job.thumbnail !== 'stored') throw new UploadError(0,'THUMBNAIL');
        job = await checkpoint(job, { phase:'thumbnail', thumbUncertain:true }, token);
        const response = await remote<{ thumbSize:number }>(`/api/thumb?id=${job.server!.id}`, token, thumbnail, { 'Content-Type':'image/jpeg', ...(job.width && job.height ? { 'X-Width':String(job.width),'X-Height':String(job.height) } : {}) });
        if (!Number.isFinite(response.thumbSize) || response.thumbSize <= 0 || response.thumbSize > 150 * 1024) throw new UploadError(0,'NETWORK');
        job = await checkpoint(job, { thumbnail:'confirmed', thumbUncertain:false, server:{ ...job.server!, thumbSize:response.thumbSize } }, token);
        updateThumbnail(job.server!.id, response.thumbSize, job.width ?? 0, job.height ?? 0);
      }
    }
    await complete(job, token);
  } catch (error) {
    if (token.epoch !== session || token.controller.signal.aborted || active.get(id) !== token) return;
    job = current(id) ?? job;
    if (error instanceof db.LocalStoreError) {
      if (error.kind === 'ownership' || error.kind === 'changed') { token.controller.abort(); await refreshRecords().catch(localFailure); }
      else { put({ ...job, blocker:error.kind === 'missing' ? 'missing':'local', retention:error.kind === 'missing' ? 'missing':job.retention, error:error.message }); }
    } else if (error instanceof UploadError) {
      if (error.status === 401) { authState.value = 'out'; return; }
      if (['UNSUPPORTED_TYPE','PAYLOAD_TOO_LARGE','EMPTY_FILE'].includes(error.code)) { await failCheckpoint(job,{blocker:'unsupported',error:'Unsupported or oversized file. Remove it and choose a supported file.'},token); return; }
      if (error.code === 'DAILY_LIMIT' || error.code === 'STORAGE_FULL') {
        dailyUntil = error.code === 'DAILY_LIMIT' ? dailyReset(Date.now()) : dailyUntil; serverFull ||= error.code === 'STORAGE_FULL'; await saveBlockers();
        queueMessage.value = error.code === 'DAILY_LIMIT' ? 'Daily limit reached. Resets at 00:00 UTC / 06:00 Dhaka. Originals remain on this device.' : 'Server storage is full. Free space in Trash or Settings, then Resume.';
        await failCheckpoint(job, { blocker:error.code === 'DAILY_LIMIT' ? 'daily':'server-full', nextRetry:dailyUntil, error:queueMessage.peek() }, token);
        for (const [other, attempt] of active) if (other !== id) attempt.controller.abort();
      } else {
        const transient = !error.status || error.status === 408 || error.status === 429 || error.status >= 500 || ['SIZE_MISMATCH','CHECKSUM_MISMATCH'].includes(error.code);
        const attempt = job.attempt + 1;
        await failCheckpoint(job, { attempt, nextRetry: transient && attempt <= 3 ? Date.now() + Math.max([1000,3000,8000][Math.min(attempt-1,2)] + Math.random()*500,error.retryAfter):0, blocker: transient && attempt <= 3 ? (!error.status && error.code !== 'THUMBNAIL' ? 'connection':''):'retry', error: transient && attempt <= 3 ? 'Retrying unfinished work.' : job.originalConfirmed ? 'Uploaded — thumbnail pending. Retry thumbnail work.' : 'Upload failed. Retained files can be retried.' }, token);
        if (!error.status && error.code !== 'THUMBNAIL') lostConnection();
      }
    } else await failCheckpoint(job, { blocker:'retry', error:'Upload failed. Your retained original is unchanged.' }, token);
  } finally {
    if (active.get(id) === token) active.delete(id);
    publish(); schedule(100);
  }
}
const volatileThumbs = new Map<string,Blob>();
async function makeThumb(job: UploadJob, blob: Blob, token: Attempt): Promise<UploadJob> {
  job = await checkpoint(job, { phase:'preparing' }, token);
  const thumbnail = await prepare(async () => { assertAttempt(job.id,token); return createThumbnail(blob); });
  assertAttempt(job.id,token);
  if (!thumbnail) return job;
  if (!durable.has(job.id)) volatileThumbs.set(job.id,thumbnail.blob);
  return checkpoint(job, { thumbnail:'stored', thumbBytes:thumbnail.blob.size, width:thumbnail.width, height:thumbnail.height }, token, { thumbnail:thumbnail.blob });
}
async function complete(job: UploadJob, token: Attempt, error = ''): Promise<void> {
  job = await checkpoint(job, { phase:'completed', blocker:'', error, cleanup:true, attempt:0, nextRetry:0 }, token);
  files.delete(job.id); volatileThumbs.delete(job.id);
  if (job.server) acceptUpload(job.server);
  try { await checkpoint(job, { cleanup:false, retention:'released', thumbBytes:0 }, token, { dropOriginal:true,dropThumbnail:true }); }
  catch { queueMessage.value = 'Upload completed. Local cleanup will be retried; the original will not be uploaded again.'; }
}
async function failCheckpoint(job: UploadJob, change: Partial<UploadJob>, token: Attempt): Promise<void> {
  try { await checkpoint(job,change,token); } catch (error) { if (!token.controller.signal.aborted && token.epoch === session) { put({ ...job,blocker:'local',error:'Latest upload state could not be saved. Keep this page open.' }); localFailure(error); } }
}
async function saveBlockers(): Promise<void> { await db.setSetting('blockers',{ dailyUntil,serverFull }).catch(localFailure); }
function lostConnection(): void {
  connectionLost = true; queueMessage.value = 'Waiting for connection. Retained uploads can resume here.';
  for (const token of active.values()) token.controller.abort();
  nextProbe = Date.now() + [5000,15000,30000,60000][Math.min(probeStep,3)];
  schedule(1000);
}
function probe(force = false): Promise<boolean> { return probePromise ??= doProbe(force).finally(() => { probePromise=undefined; }); }
async function doProbe(force = false): Promise<boolean> {
  if (probing || !visible() || (!force && Date.now() < nextProbe)) return false;
  if (force && Date.now()-lastProbe<1500) return !connectionLost;
  lastProbe=Date.now();
  probing = true; const generation = session; probeController = new AbortController();
  try {
    const response = await xhr<{ scope:string }>('/api/auth/session',null,{method:'GET',signal:probeController.signal,timeout:8000});
    if (!signedIn() || generation !== session) return false;
    if (response.scope !== 'full') { authState.value = 'out'; return false; }
    connectionLost = false; probeStep = 0; nextProbe = 0;
    for (const job of records.peek()) if (job.blocker === 'connection' && job.intent === 'run') await control(job,{blocker:'',error:''});
    if (!dailyUntil && !serverFull) queueMessage.value = '';
    return true;
  } catch (error) {
    if (generation !== session || probeController.signal.aborted) return false;
    if (error instanceof UploadError && error.status === 401) authState.value = 'out';
    else { connectionLost = true; probeStep++; nextProbe = Date.now()+[5000,15000,30000,60000][Math.min(probeStep,3)]; }
    return false;
  } finally { probing = false; schedule(); }
}
async function control(job: UploadJob, change: Partial<UploadJob>, remove = false): Promise<void> {
  try {
    let next = { ...job, ...change };
    if (durable.has(job.id)) {
      for (let attempt = 0; ; attempt++) {
        const stored = await db.getJob(job.id);
        if (!stored) { records.value = records.peek().filter(row => row.id !== job.id); return; }
        if (!finished(job) && finished(stored) && !remove) { put(stored); return; }
        try { next = await db.saveJob({ ...stored,...change }, {remove,dropOriginal:remove,dropThumbnail:remove}); break; }
        catch (error) { if (attempt >= 3 || !(error instanceof db.LocalStoreError) || error.kind !== 'changed') throw error; }
      }
    }
    active.get(job.id)?.controller.abort();
    if (remove) { records.value=records.peek().filter(row=>row.id!==job.id); durable.delete(job.id); files.delete(job.id); volatileThumbs.delete(job.id); }
    else put(next);
    notify();
  } catch (error) { active.get(job.id)?.controller.abort(); put({ ...job, blocker:'local', error:'This action could not be saved locally. Keep this page open.' }); localFailure(error); throw error; }
}
export async function pause(id?: string): Promise<void> {
  if (!id) { enabled.value = false; abortAll(); await relinquish(); }
  else active.get(id)?.controller.abort();
  for (const job of [...records.peek()]) if (!finished(job) && (!id || id===job.id)) await control(job,{intent:'pause'});
  publish(); if (!active.size) await relinquish();
}
export async function resume(id?: string, retry = false): Promise<void> {
  await initialize();
  if (!await probe(true)) return;
  if (serverFull) {
    try { const stats=await xhr<StatsDTO>('/api/stats',null,{method:'GET',timeout:8000}); if(stats.bytes+stats.trashBytes>=stats.capBytes){queueMessage.value='Server storage is still full. Free space in Trash or Settings.';return;} serverFull=false;await saveBlockers(); } catch (error) { if(error instanceof UploadError&&error.status===401)authState.value='out';else lostConnection();return; }
  }
  if(dailyUntil>Date.now()){queueMessage.value='Daily limit reached. Wait until 06:00 Dhaka.';return;}
  enabled.value=true;
  if (!await claim()) { queueMessage.value = 'Uploads are running in another tab. Resume here after that runner stops.'; return; }
  for(const job of [...records.peek()]) if(job.submitted&&!finished(job)&&(!id||job.id===id)&&job.blocker!=='unsupported') {
    if (retry && !id && job.blocker !== 'retry') continue;
    if((job.blocker==='missing'&&!job.originalConfirmed)||(job.blocker==='local'&&job.retention==='unretained')||(job.blocker==='retry'&&!retry&&!id))continue;
    await control(job,{intent:'run',blocker:'',error:'',retention:job.retention,phase:job.phase,attempt:retry?0:job.attempt,nextRetry:0});
  }
  enabled.value=true;schedule();
}
export async function cancel(id?: string): Promise<void> {
  if (!id) { enabled.value=false;abortAll();await relinquish(); }
  else active.get(id)?.controller.abort();
  for(const job of [...records.peek()]) if(!finished(job)&&(!id||job.id===id)) {
    await control(job,{intent:'cancel',phase:'cancelled',error:'Cancelled. An already accepted upload may still appear in the gallery.',cleanup:true});
    await cleanJob(current(job.id)!);
  }
  publish();schedule();
}
async function cleanJob(job: UploadJob): Promise<void> {
  try { const next=durable.has(job.id)?await db.saveJob({...job,cleanup:false,retention:'released',thumbBytes:0},{dropOriginal:true,dropThumbnail:true}):{...job,cleanup:false,retention:'released' as const};files.delete(job.id);volatileThumbs.delete(job.id);put(next);notify(); }
  catch { queueMessage.value='Local cleanup failed. Completed/cancelled work will not restart; cleanup can be retried.'; }
}
async function cleanup(): Promise<void> { for(const job of [...records.peek()])if(finished(job)&&job.cleanup)await cleanJob(job); }
export async function clearCompleted(): Promise<void> { for(const job of [...records.peek()])if(finished(job))await control(job,{},true);await cleanup(); }
export async function removePending(): Promise<void> { enabled.value=false;intakeSession++;abortAll();await relinquish();for(const job of [...records.peek()])if(!finished(job))await control(job,{},true); }
export async function remove(id:string):Promise<void>{const job=current(id);if(job)await control(job,{},true);}
export async function retryRetention(id:string):Promise<void>{const job=current(id);if(!job||!files.has(id))return;await control(job,{retention:'saving',blocker:'',error:''});void retainNext();}
export async function sessionOnly(id:string):Promise<void>{const job=current(id);if(!job||!files.has(id))return;await control(job,{sessionOnly:true,retention:'unretained',blocker:'',error:''});enabled.value=true;schedule();}
export async function reselect(id:string,file:File,confirmed=false):Promise<void>{const job=current(id);if(!job)return;if(file.size!==job.size||fileMime(file)!==job.mime)throw new Error('Choose the same file type and size.');if(job.hash){const hash=await prepare(()=>sha256Hex(file));if(hash!==job.hash)throw new Error('This is a different file. Choose the original.');}else if(!confirmed)throw new Error('File identity is unproven. Confirm replacement using its name, size and date.');files.set(id,file);await control(job,{retention:'saving',blocker:'restored',error:'',sessionOnly:false});void retainNext();}
async function changeSelection(ids:string[],change:(job:UploadJob,index:number)=>UploadJob):Promise<void>{
  for(let offset=0;offset<ids.length;offset+=100){
    const part=ids.slice(offset,offset+100),stored=part.filter(id=>durable.has(id));
    const changed=stored.length?await db.changeJobs(stored,change):[];
    const byId=new Map(changed.map(job=>[job.id,job]));
    records.value=records.peek().map(job=>byId.get(job.id)??(part.includes(job.id)&&!durable.has(job.id)?change(job,part.indexOf(job.id)):job));
    publish();notify();
  }
}
export async function submit(ids:string[],all=false):Promise<void>{
  const selected=records.peek().filter(job=>!job.submitted&&!finished(job)&&ids.includes(job.id)).slice(0,all?undefined:100);
  for(let offset=0;offset<selected.length;offset+=100){const group=crypto.randomUUID();await changeSelection(selected.slice(offset,offset+100).map(job=>job.id),job=>({...job,submitted:true,intent:'run',group,blocker:job.blocker==='restored'?'':job.blocker}));}
  enabled.value=true;schedule();
}
export async function selectReview(ids:string[],selected:boolean):Promise<void>{await changeSelection(ids,(job)=>job.submitted?job:{...job,selected});}export async function discardLocal(id:string):Promise<void>{const job=current(id);if(!job?.originalConfirmed)return;await control(job,{phase:'completed',thumbnail:'none',error:'Uploaded; thumbnail deferred to backfill.',cleanup:true});await cleanJob(current(id)!);}
export async function background(work:(verify:()=>Promise<void>)=>Promise<void>):Promise<void>{
  await initialize();if(backgroundRunning||records.peek().some(job=>!finished(job))||active.size||!visible()||dailyUntil>Date.now()||serverFull)return;
  if(!await claim())return;backgroundRunning=true;const owned=fence?{...fence}:undefined,generation=session;
  const verify=async()=>{if(!visible()||generation!==session||records.peek().some(job=>!finished(job)))throw new UploadError(0,'ABORT');if(owned)await db.checkOwnership(owned);};
  try{await work(verify);}finally{backgroundRunning=false;await relinquish();schedule();}
}
export function signedOut():void{enabled.value=false;intakeSession++;abortAll();clearTimeout(tick);void relinquish();records.value=[];uploads.value=[];localItems.value=[];busy.value=false;updateWake();queueReady.value=false;queueMessage.value='';progress.value={};files.clear();volatileThumbs.clear();durable.clear();initialized=undefined;}
window.addEventListener('offline',()=>{if(signedIn())lostConnection();});
const canProbe = () => enabled.peek() && visible() && !serverFull && dailyUntil <= Date.now() && records.peek().some(job => job.submitted && job.intent === 'run' && !finished(job) && (!job.blocker || job.blocker === 'connection' || job.blocker === 'daily'));
window.addEventListener('online',()=>{if(canProbe()){nextProbe=0;void probe(true);}});
window.addEventListener('focus',()=>{if(canProbe()&&Date.now()-nextProbe> -2000)void probe(true);});
document.addEventListener('visibilitychange',()=>{foreground.value=!document.hidden;if(document.hidden){abortAll();void relinquish();publish();}else if(enabled.peek()){recoverRequests();if(canProbe())void probe(true).then(() => schedule());else schedule();}});
let wake:WakeLockSentinel|undefined,wakePending=false;
function updateWake():void{const needed=busy.peek()&&visible();if(!needed){void wake?.release();wake=undefined;}else if('wakeLock'in navigator&&!wake&&!wakePending){wakePending=true;void navigator.wakeLock.request('screen').then(lock=>{if(!busy.peek()||!visible())void lock.release();else{wake=lock;lock.addEventListener('release',()=>{if(wake===lock)wake=undefined;});}}).catch(()=>{}).finally(()=>{wakePending=false;});}}
let lastCleanup=0, refreshing=false;
setInterval(()=>{if(!visible())return;updateWake();if(enabled.peek())schedule();if(queueReady.peek()&&!refreshing&&(!channel||otherRunner.peek()||records.peek().some(job=>!finished(job)||job.cleanup))){refreshing=true;void (async()=>{try{const lease=await db.getSetting<Fence>('lease');otherRunner.value=!!lease&&lease.owner!==owner&&lease.expires>Date.now();if(!channel)await refreshRecords();if(!active.size&&Date.now()-lastCleanup>60000){lastCleanup=Date.now();await cleanup();}}catch{/* Storage errors remain visible on affected rows. */}finally{refreshing=false;}})();}},10000);
