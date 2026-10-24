import { render } from 'preact';
import { useState } from 'preact/hooks';
import { authState, bootAuth, bootError, logout } from './auth';
import { Login } from './views/Login';
import './styles.css';

const root = document.getElementById('app');
if (!root) throw new Error('Application root is missing.');

function App() {
  const [logoutError, setLogoutError] = useState(false);
  const [pending, setPending] = useState(false);
  if (authState.value === 'unknown') return bootError.value ? (
    <main class="auth-layout"><section class="text-center" aria-live="polite">
      <p>Can't reach the server</p>
      <button class="mt-4 min-h-11 rounded-lg bg-indigo-600 px-5 py-3 text-white" onClick={() => void bootAuth()}>Retry</button>
    </section></main>
  ) : null;
  if (authState.value === 'out') return <Login />;
  return <main class="auth-layout"><section class="text-center">
    <h1 class="text-2xl font-semibold">Signed in</h1>
    <button class="mt-5 min-h-11 rounded-lg bg-indigo-600 px-5 py-3 text-white disabled:opacity-60" disabled={pending} onClick={async () => {
      setPending(true); setLogoutError(false);
      try { await logout(); } catch { setLogoutError(true); } finally { setPending(false); }
    }}>{pending ? 'Signing out…' : 'Logout'}</button>
    <p class="mt-3" aria-live="polite">{logoutError ? "Couldn't sign out. Try again." : ''}</p>
  </section></main>;
}
render(<App />, root);
void bootAuth();
