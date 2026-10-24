import { render } from 'preact';
import { authState, bootAuth, bootError } from './auth';
import { Login } from './views/Login';
import { Gallery } from './views/Gallery';
import './styles.css';
import { Skeleton } from './components/Skeleton';
import { Toast } from './components/Toast';
import { online } from './store/ui';
import './pwa/register';

const root = document.getElementById('app');
if (!root) throw new Error('Application root is missing.');

function View() {
  if (authState.value === 'unknown') return bootError.value ? (
    <main class={online.value ? 'auth-layout' : 'offline-shell page-width'}><section class="text-center" aria-live="polite">
      <h1>{online.value ? "Can't reach the server" : "You're offline"}</h1>
      {!online.value && <p>Reconnect to load your files.</p>}
      <button class="mt-4 min-h-11 rounded-lg bg-indigo-600 px-5 py-3 text-white" onClick={() => void bootAuth()}>Retry</button>
    </section>{!online.value && <div class="offline-skeletons" aria-hidden="true">{Array.from({ length: 30 }, (_, i) => <Skeleton key={i} />)}</div>}</main>
  ) : null;
  if (authState.value === 'out') return <Login />;
  return <Gallery />;
}
function App() { return <><View />{authState.value !== 'in' && <aside class="action-stack" aria-label="Activity"><Toast /></aside>}</>; }
render(<App />, root);
void bootAuth();
