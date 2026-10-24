import { useState } from 'preact/hooks';
import { busy, cancelUpload, clearFinished, queueMessage, retryUpload, uploads } from '../upload/queue';
import { Icon } from './Icon';

export function UploadTray() {
  const [expanded, setExpanded] = useState(false);
  const list = uploads.value;
  if (!list.length) return null;
  const added = list.filter((item) => item.status === 'done').length;
  const duplicates = list.filter((item) => item.status === 'duplicate').length;
  const failed = list.filter((item) => item.status === 'failed').length;
  const finished = list.filter((item) => ['done', 'duplicate', 'cancelled', 'failed'].includes(item.status)).length;
  const total = list.reduce((sum, item) => sum + item.size, 0);
  const progress = total ? list.reduce((sum, item) => sum + item.size * (['done', 'duplicate'].includes(item.status) ? 1 : item.progress), 0) / total : 0;
  const waiting = list.some((item) => item.status === 'waiting');
  const summary = busy.value ? `${waiting ? 'Waiting' : 'Uploading'} ${Math.min(list.length, finished + 1)} of ${list.length} · ${Math.round(progress * 100)}%`
    : `${added} added${failed ? ` · ${failed} failed` : duplicates ? ` · ${duplicates} already in Dump` : ''}`;
  return <section class="upload-tray" aria-label="Uploads">
    <button class="tray-summary" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span aria-live="polite">{summary}</span><Icon name={expanded ? 'close' : 'more'} size={18} /></button>
    <progress class="tray-progress" aria-label="Overall upload progress" max={1} value={progress} />
    {queueMessage.value && <p class="tray-message" role="status">{queueMessage.value}</p>}
    {expanded && <ul class="tray-list">{list.map((item) => <li key={item.localId}>
      {item.previewUrl && item.mime.startsWith('image/') ? <img class="tray-preview" src={item.previewUrl} alt="" /> : <span class="tray-preview"><Icon name={item.mime === 'application/pdf' ? 'file-pdf' : 'image'} /></span>}
      <div class="tray-item-info"><span class="tray-name">{item.name}</span><span class={item.status === 'failed' ? 'upload-error' : ''}>{item.message}</span>{!['done', 'duplicate', 'failed', 'cancelled'].includes(item.status) && <progress aria-label={`Upload progress for ${item.name}`} max={1} value={item.progress} />}</div>
      {item.status === 'failed' ? <button class="text-button" onClick={() => retryUpload(item.localId)}>Retry</button> : !['done', 'duplicate', 'cancelled'].includes(item.status) && <button class="icon-button" aria-label={`Cancel ${item.name}`} onClick={() => cancelUpload(item.localId)}><Icon name="close" size={18} /></button>}
    </li>)}</ul>}
    <div class="tray-actions">{failed > 0 && <button class="text-button" onClick={() => retryUpload()}>Retry all failed</button>}{busy.value && <button class="text-button" onClick={() => cancelUpload()}>Cancel all</button>}<button class="text-button" onClick={clearFinished}>Clear</button></div>
  </section>;
}
