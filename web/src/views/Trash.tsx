import { navigate } from '../lib/router';
import { actionBusy, emptyTrash } from '../store/actions';
import { settings } from '../store/files';
import { confirmAction } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { selectMode } from '../store/selection';

export function Trash() {
  return <><header class="app-header"><div class="header-row page-width"><button class="icon-button" aria-label="Back to gallery" onClick={() => navigate('/')}><Icon name="chevron-left" /></button><h1 class="app-title">Trash</h1><button class="icon-button" aria-label="Select" onClick={() => { selectMode.value = true; }}><Icon name="check" /></button><button class="text-button danger-text" disabled={actionBusy.value} onClick={async () => { if (await confirmAction("Empty Trash? This can't be undone.")) void emptyTrash(); }}>Empty Trash</button></div></header><p class="trash-banner page-width">Files are deleted forever {settings.value?.trashDays ?? 7} days after they're moved here.</p></>;
}
