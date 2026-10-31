import { useEffect, useRef, useState } from 'preact/hooks';
import { logout } from '../auth';
import { refresh, status } from '../store/files';
import { filters, showToast } from '../store/ui';
import { Icon, type IconName } from './Icon';
import { selectMode } from '../store/selection';
import { navigate } from '../lib/router';
import { pendingCount } from '../upload/queue';

export function Header({ notes = false }: { notes?: boolean }) {
  const [menu, setMenu] = useState(false);
  const header = useRef<HTMLElement>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!header.current) return;
    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty('--header-height', `${entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height}px`);
      window.dispatchEvent(new Event('dump:layout'));
    });
    observer.observe(header.current);
    return () => { observer.disconnect(); };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!menuRoot.current?.contains(event.target as Node)) setMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false); more.current?.focus(); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    menuRoot.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [menu]);
  const actions: { label: string; icon: IconName; run: () => void; busy?: boolean }[] = [
    { label: 'Select', icon: 'check', run: () => { selectMode.value = true; } },
    { label: 'Refresh files', icon: 'refresh', run: () => { void refresh(); }, busy: status.value === 'loading' || status.value === 'loadingMore' },
  ];
  const entries = [{ label: pendingCount.value ? `Uploads (${pendingCount.value} pending)` : 'Uploads', run: () => navigate('/uploads') }, { label: 'Trash', run: () => navigate('/trash') }, { label: 'Settings', run: () => navigate('/settings') }, { label: 'Sign out', run: async () => { try { await logout(); } catch { showToast("Couldn't sign out. Try again.", undefined, true); } } }];
  return <header ref={header} class="app-header"><div class="header-row page-width">
    <div><h1 class="app-title">{notes?'Dump':filters.value.pinned?'Pinned':filters.value.type==='file'?'Files':'Dump'}</h1><p class="workspace-subtitle">{!notes&&filters.value.type==='file'?'Documents, code, and everything else.':'A little less scattered.'}</p></div>
    <div class="header-actions">{pendingCount.value>0&&<button class="workspace-upload-status" onClick={()=>navigate('/uploads')}>{pendingCount.value} uploads pending</button>}
      {!notes && actions.map((action) => <button class="icon-button" key={action.label} aria-label={action.label} title={action.label} onClick={action.run} aria-busy={action.busy}><Icon name={action.icon} class={action.busy ? 'spin' : ''} /></button>)}
      <div ref={menuRoot} class="menu-root"><button ref={more} class="icon-button" aria-label="More options" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="more" /></button>
        {menu && <div class="menu" role="menu" aria-label="More options">{entries.map((entry) => <button key={entry.label} role="menuitem" onClick={() => { setMenu(false); void entry.run(); }}>{entry.label}</button>)}</div>}
      </div>
    </div>
  </div></header>;
}
