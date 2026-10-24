import { toast } from '../store/ui';
import { Icon } from './Icon';

export function Toast() {
  const current = toast.value;
  return <div class="toast-host" aria-live={current?.error ? 'assertive' : 'polite'} aria-atomic="true">
    {current && <div class="toast" key={current.id}><span>{current.message}</span>{current.action && <button onClick={current.action.run}>{current.action.label}</button>}<button aria-label="Dismiss notification" onClick={() => { toast.value = null; }}><Icon name="close" size={16} /></button></div>}
  </div>;
}
