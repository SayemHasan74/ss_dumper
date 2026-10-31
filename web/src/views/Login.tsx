import { useEffect, useRef, useState } from 'preact/hooks';
import { login } from '../auth';
import { ApiError } from '../lib/api';

export function Login() {
  const input = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { if (matchMedia('(hover: hover)').matches) input.current?.focus(); }, []);
  useEffect(() => {
    if (!retryAt) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setSeconds(remaining);
      if (!remaining) { setRetryAt(0); setError(''); }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  const disabled = pending || seconds > 0;
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (disabled || !input.current) return;
    const key = input.current.value;
    input.current.value = '';
    setVisible(false);
    setPending(true);
    setError('');
    try { await login(key); }
    catch (failure) {
      if (failure instanceof ApiError && failure.code === 'INVALID_KEY') setError("That key isn't right.");
      else if (failure instanceof ApiError && failure.code === 'RATE_LIMITED') {
        const delay = Math.max(1, failure.retryAfterSec ?? 900);
        setSeconds(delay);
        setRetryAt(Date.now() + delay * 1000);
      } else if (failure instanceof ApiError && failure.code === 'NETWORK') setError("Can't reach the server.");
      else setError('Something went wrong.');
    } finally { setPending(false); }
  }
  return (
    <main class="auth-layout">
      <section class="auth-card" aria-labelledby="login-title">
        <h1 id="login-title" class="text-3xl font-semibold tracking-tight">Dump</h1>
        <p class="mt-2 text-sm auth-description">Your files, within reach. Sign in with your access key.</p>
        <form class="mt-7" onSubmit={submit} aria-busy={pending}>
          <input class="sr-only" type="text" name="username" autoComplete="username" value="dump" tabIndex={-1} readOnly aria-label="Username" />
          <label class="mb-2 block text-sm font-medium" for="access-key">Access key</label>
          <div class="auth-key-field">
            <input ref={input} id="access-key" class="min-w-0 flex-1 rounded-lg bg-transparent px-3 py-3 outline-none" {...(visible ? { type: 'text' as const } : { type: 'password' as const })} name="key" autoComplete="current-password" autoCapitalize="off" autoCorrect="off" spellcheck={false} disabled={disabled} aria-describedby="login-error" />
            <button class="min-h-11 min-w-11 rounded-lg px-3 auth-key-toggle" type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Hide access key' : 'Show access key'} aria-pressed={visible} disabled={disabled}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
                {visible && <path d="m3 3 18 18" />}
              </svg>
            </button>
          </div>
          <p id="login-error" class="mt-3 min-h-10 text-sm danger-text" aria-live="polite" aria-atomic="true">
            {seconds > 0 ? `Too many attempts. Try again in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.` : error}
          </p>
          <button class="primary-button mt-2 disabled:opacity-60" type="submit" disabled={disabled}>{pending ? 'Checking…' : 'Sign in'}</button>
        </form>
      </section>
    </main>
  );
}
