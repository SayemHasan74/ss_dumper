import type { ComponentType } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { records, pendingCount, queueMessage, enabled, busy, otherRunner, pauseUpload, resumeUpload } from '../upload/queue';
import { finished, type UploadJob } from '../upload/model';
import { copyQueue } from '../lib/clipboard';
import { navigate, route } from '../lib/router';
import { showToast } from '../store/ui';
import { Icon } from './Icon';

export function UploadDock() {
  const list = records.value, count = pendingCount.value;
  const [expanded, setExpanded] = useState(true), [Rows, setRows] = useState<ComponentType<{jobs:UploadJob[]}> | null>(null), [loadError, setLoadError] = useState(false);
  const [activityHeight, setActivityHeight] = useState(0), copying = !!copyQueue.value;
  const previous = useRef(new Set<string>()), root = useRef<HTMLElement>(null), tab = useRef<HTMLButtonElement>(null);
  const hidden = ['uploads', 'viewer'].includes(route.value.view);
  useEffect(() => {
    const ids = new Set(list.filter(job => !finished(job)).map(job => job.id));
    if ([...ids].some(id => !previous.current.has(id))) setExpanded(true);
    previous.current = ids;
  }, [list]);
  function load(): void { setLoadError(false); void import('./UploadRows').then(module => setRows(() => module.DockRows)).catch(() => setLoadError(true)); }
  useEffect(() => { if (count && expanded && !Rows) load(); }, [!!count, expanded]);
  useEffect(() => {
    if (!copying) { setActivityHeight(0); return; }
    setExpanded(false);
    const stack = document.querySelector('.action-stack');
    if (!stack) return;
    const observer = new ResizeObserver(([entry]) => setActivityHeight(entry.target.getBoundingClientRect().height + 12));
    observer.observe(stack); return () => observer.disconnect();
  }, [copying]);
  // Preserve gallery keyboard access: collapse when focus would move behind the overlay.
  useEffect(() => {
    const focus = (event: FocusEvent) => { if (event.target instanceof HTMLElement && !root.current?.contains(event.target) && !event.target.closest('[role="dialog"], [role="alertdialog"], .action-stack')) setExpanded(false); };
    document.addEventListener('focusin', focus); return () => document.removeEventListener('focusin', focus);
  }, []);
  if (!count || hidden) return null;
  const open = expanded;
  const canPause = enabled.value && list.some(job => !finished(job) && job.intent === 'run');
  const canResume = !otherRunner.value && list.some(job => job.submitted && !finished(job) && job.blocker !== 'unsupported' && job.blocker !== 'retry' && !(job.blocker === 'missing' && !job.originalConfirmed) && !(job.blocker === 'local' && job.retention === 'unretained') && (job.intent === 'pause' || job.blocker || !enabled.value));
  const safe = async (action:()=>Promise<unknown>) => { try { await action(); } catch { showToast('This action could not be saved. Keep the page open.', undefined, true); } };
  const collapse = () => { setExpanded(false); requestAnimationFrame(() => tab.current?.focus()); };
  const pending = list.filter(job => !finished(job)), completed = list.filter(job => job.phase === 'completed').length;
  return <section ref={root} id="upload-dock-panel" style={{'--dock-activity':`${activityHeight}px`}} class={open ? 'upload-dock expanded' : 'upload-dock collapsed'} aria-label="Upload controls" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); collapse(); } }}>
    {open ? <><header class="dock-header"><div><h2>Uploads</h2><p role="status">{completed} completed · {count} pending</p></div><button class="icon-button" aria-label="Collapse uploads" aria-expanded={true} aria-controls="upload-dock-panel" onClick={collapse}><Icon name="chevron-right"/></button></header>
      <div class="dock-controls"><button class="text-button" disabled={!canPause} onClick={()=>void safe(()=>pauseUpload())}>Pause all</button><button class="primary-button" disabled={!canResume || busy.value} onClick={()=>void safe(()=>resumeUpload())}>Resume</button></div>
      {otherRunner.value&&<p class="dock-message" role="status">Running in another tab. Pause there before resuming here.</p>}{queueMessage.value&&<p class="dock-message" role="status">{queueMessage.value}</p>}
      {Rows ? <Rows jobs={pending}/> : <div class="dock-message" role="status">{loadError ? <button class="text-button" onClick={load}>Retry queue list</button> : 'Opening queue…'}</div>}
      <footer class="dock-footer"><span>Whole-file restart if interrupted.</span><button class="text-button" onClick={()=>navigate('/uploads')}>Details</button></footer></> : <><button ref={tab} class="dock-tab" aria-label={`Expand uploads, ${count} pending`} aria-expanded={false} aria-controls="upload-dock-panel" onClick={()=>setExpanded(true)}>Uploads <span>{count}</span></button><button class="dock-toggle" disabled={canPause ? false : !canResume} aria-label={canPause ? 'Pause all uploads' : 'Resume uploads'} onClick={()=>void safe(()=>canPause ? pauseUpload() : resumeUpload())}>{canPause ? 'Pause' : 'Resume'}</button></>}
  </section>;
}
