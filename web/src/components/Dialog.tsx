import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { effect, signal } from '@preact/signals';
import { authState } from '../auth';

export const dialogCount = signal(0);
export function Dialog({ title, children, onClose, alert = false }: { title: string; children: ComponentChildren; onClose: () => void; alert?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    dialogCount.value++;
    const origin = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const focusables = () => [...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"]')].filter((el) => el.getClientRects().length);
    (root.current?.querySelector<HTMLElement>('[autofocus]') ?? focusables()[0] ?? root.current)?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose(); }
      if (event.key === 'Tab') {
        const controls = focusables(), first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || !root.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && (document.activeElement === last || !root.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
        event.stopPropagation();
      }
    };
    document.addEventListener('keydown', key, true);
    const focus = (event: FocusEvent) => { if (!root.current?.contains(event.target as Node)) focusables()[0]?.focus(); };
    document.addEventListener('focusin', focus);
    return () => { dialogCount.value--; document.body.style.overflow = previous; document.removeEventListener('keydown', key, true); document.removeEventListener('focusin', focus); if (origin?.isConnected) origin.focus({ preventScroll: true }); };
  }, []);
  if (authState.value !== 'in') return null;
  return <div class="dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={root} class="dialog-card" role={alert ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="dialog-title" tabIndex={-1}><h2 id="dialog-title">{title}</h2>{children}</div></div>;
}
const confirmation = signal<{ text: string; resolve: (value: boolean) => void } | null>(null);
effect(() => { if (authState.value === 'out') { confirmation.peek()?.resolve(false); confirmation.value = null; } });
export function confirmAction(text: string): Promise<boolean> { return new Promise((resolve) => { confirmation.peek()?.resolve(false); confirmation.value = { text, resolve }; }); }
export function ConfirmHost() {
  const current = confirmation.value;
  if (!current) return null;
  const close = (value: boolean) => { confirmation.value = null; current.resolve(value); };
  return <Dialog title={current.text} alert onClose={() => close(false)}><div class="dialog-actions"><button class="text-button" onClick={() => close(false)}>Cancel</button><button class="primary-button danger-button" onClick={() => close(true)}>Confirm</button></div></Dialog>;
}
