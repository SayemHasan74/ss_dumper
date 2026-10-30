import { render } from 'preact';
import { effect } from '@preact/signals';
import { Dialog } from '../components/Dialog';
import { authState } from '../auth';

type Choice = 'keep' | 'delete' | 'cancel';
let pending: Promise<Choice> | undefined;
export function chooseLocalSignOut(): Promise<Choice> {
  if (pending) return pending;
  if (authState.peek() !== 'in') return Promise.resolve('cancel');
  pending = new Promise<Choice>(resolve => {
    const root = document.createElement('div'); document.body.append(root);
    let closed = false;
    const finish = (choice: Choice) => { if (closed) return; closed = true; stop(); render(null, root); root.remove(); pending = undefined; resolve(choice); };
    const stop = effect(() => { if (authState.value === 'out') queueMicrotask(() => finish('cancel')); });
    render(<Dialog title="Pending uploads on this device" onClose={() => finish('cancel')}>
      <p>Pending originals are stored in this browser’s IndexedDB, without application encryption. They may remain after closing the app. Someone with access to this browser profile or device may access that data.</p>
      <p>Keeping uploads allows recovery here after signing in. This choice applies only to this browser, even when signing out everywhere.</p>
      <p>Files not marked Saved on this device, including session-only uploads, will need to be selected again after sign-out.</p>
      <div class="signout-choices"><button class="text-button" onClick={() => finish('cancel')}>Cancel</button><button class="primary-button" onClick={() => finish('keep')}>Keep pending uploads on this device and sign out</button><button class="text-button danger-text" onClick={() => finish('delete')}>Delete this device’s pending uploads and sign out</button></div>
    </Dialog>, root);
  });
  return pending;
}
