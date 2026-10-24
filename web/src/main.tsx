import { render } from 'preact';
import { authState, bootAuth, bootError } from './auth';
import { Login } from './views/Login';
import { Gallery } from './views/Gallery';
import './styles.css';

const root = document.getElementById('app');
if (!root) throw new Error('Application root is missing.');

function App() {
  if (authState.value === 'unknown') return bootError.value ? (
    <main class="auth-layout"><section class="text-center" aria-live="polite">
      <p>Can't reach the server</p>
      <button class="mt-4 min-h-11 rounded-lg bg-indigo-600 px-5 py-3 text-white" onClick={() => void bootAuth()}>Retry</button>
    </section></main>
  ) : null;
  if (authState.value === 'out') return <Login />;
  return <Gallery />;
}
render(<App />, root);
void bootAuth();
