import { busy, pendingCount, queueMessage, records } from '../upload/queue';
import { navigate, route } from '../lib/router';
import { Icon } from './Icon';

export function UploadTray() {
  const list = records.value;
  if (!list.length || route.value.view === 'uploads') return null;
  const confirmed = list.filter(job => job.originalConfirmed).length;
  return <section class="upload-tray" aria-label="Uploads"><button class="tray-summary" aria-label="Open uploads" onClick={() => navigate('/uploads')}><span aria-live="polite">{busy.value ? 'Uploading' : 'Uploads'} · {pendingCount.value} pending · {confirmed} originals confirmed</span><Icon name="chevron-right" size={18} /></button>{queueMessage.value && <p class="tray-message" role="status">{queueMessage.value}</p>}</section>;
}
