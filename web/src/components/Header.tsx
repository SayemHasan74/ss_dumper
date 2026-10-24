import { useEffect, useRef, useState } from 'preact/hooks';
import { logout } from '../auth';
import { isTouch } from '../lib/env';
import { loadFirstPage, refresh, status } from '../store/files';
import { filters, showToast, updateFilters } from '../store/ui';
import { Icon, type IconName } from './Icon';
import { selectMode } from '../store/selection';
import { navigate } from '../lib/router';

export function Header() {
  const [searching, setSearching] = useState(!!filters.value.q);
  const [draft, setDraft] = useState(filters.value.q);
  const [menu, setMenu] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const header = useRef<HTMLElement>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const query = filters.value.q;
  useEffect(() => { setDraft(query); }, [query]);
  useEffect(() => {
    if (!header.current) return;
    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty('--header-height', `${entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height}px`);
      window.dispatchEvent(new Event('dump:layout'));
    });
    observer.observe(header.current);
    return () => { observer.disconnect(); clearTimeout(debounce.current); };
  }, []);
  useEffect(() => { if (searching && !isTouch()) input.current?.focus(); }, [searching]);
  useEffect(() => { const search = () => { setSearching(true); requestAnimationFrame(() => input.current?.focus()); }; window.addEventListener('dump:search', search); return () => window.removeEventListener('dump:search', search); }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!menuRoot.current?.contains(event.target as Node)) setMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false); more.current?.focus(); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    menuRoot.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [menu]);
  function closeSearch(): void {
    clearTimeout(debounce.current); setSearching(false); setDraft('');
    if (filters.peek().q) { updateFilters({ q: '' }); void loadFirstPage(); window.scrollTo({ top: 0 }); }
  }
  const actions: { label: string; icon: IconName; run: () => void; busy?: boolean }[] = [
    { label: 'Select', icon: 'check', run: () => { selectMode.value = true; } },
    { label: searching ? 'Close search' : 'Search files', icon: 'search', run: () => searching ? closeSearch() : setSearching(true) },
    { label: 'Refresh files', icon: 'refresh', run: () => { void refresh(); }, busy: status.value === 'loading' || status.value === 'loadingMore' },
  ];
  const entries = [{ label: 'Trash', run: () => navigate('/trash') }, { label: 'Settings', run: () => navigate('/settings') }, { label: 'Sign out', run: async () => { try { await logout(); } catch { showToast("Couldn't sign out. Try again.", undefined, true); } } }];
  return <header ref={header} class="app-header"><div class="header-row page-width">
    <h1 class="app-title">Dump</h1>
    <div class="header-actions">
      {actions.map((action) => <button class="icon-button" key={action.label} aria-label={action.label} title={action.label} onClick={action.run} aria-busy={action.busy}><Icon name={action.icon} class={action.busy ? 'spin' : ''} /></button>)}
      <div ref={menuRoot} class="menu-root"><button ref={more} class="icon-button" aria-label="More options" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="more" /></button>
        {menu && <div class="menu" role="menu" aria-label="More options">{entries.map((entry) => <button key={entry.label} role="menuitem" onClick={() => { setMenu(false); void entry.run(); }}>{entry.label}</button>)}</div>}
      </div>
    </div>
  </div>{searching && <div class="search-row page-width"><Icon name="search" /><input ref={input} type="search" aria-label="Search files" placeholder="Search files" value={draft} maxLength={60} onKeyDown={(event) => { if (event.key === 'Escape') closeSearch(); }} onInput={(event) => {
    const value = event.currentTarget.value; setDraft(value); clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { updateFilters({ q: value.trim() }); void loadFirstPage(); window.scrollTo({ top: 0 }); }, 250);
  }} /><button class="icon-button" aria-label="Clear and close search" onClick={closeSearch}><Icon name="close" size={18} /></button></div>}</header>;
}
