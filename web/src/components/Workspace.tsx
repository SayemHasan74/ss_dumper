import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { StatsDTO } from '../../../shared/types';
import { bytes } from '../lib/format';
import { navigate, route } from '../lib/router';
import { filters, updateFilters } from '../store/ui';
import { loadFirstPage } from '../store/files';
import { pendingCount } from '../upload/queue';
import { Icon, type IconName } from './Icon';
import { Dialog } from './Dialog';

export function Workspace({children,stats}:{children:ComponentChildren;stats:StatsDTO|null}) {
  const [navigation,setNavigation]=useState(false),[draft,setDraft]=useState(filters.value.q);
  const input=useRef<HTMLInputElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const view=route.value.view,current=filters.value;
  useEffect(()=>{setDraft(filters.value.q);},[filters.value.q]);
  useEffect(()=>{const focus=()=>input.current?.focus();const shortcut=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();focus();}};window.addEventListener('dump:search',focus);window.addEventListener('keydown',shortcut);return()=>{clearTimeout(timer.current);window.removeEventListener('dump:search',focus);window.removeEventListener('keydown',shortcut);};},[]);
  function collection(type:'all'|'file'='all',pinned=false):void{clearTimeout(timer.current);setNavigation(false);updateFilters({type,pinned,q:'',time:'all',tag:''});navigate('/');void loadFirstPage();scrollTo({top:0,behavior:'instant'});}
  const links:{name:string;icon:IconName;active:boolean;run:()=>void;count?:number}[]=[
    {name:'Gallery',icon:'grid',active:view==='gallery'&&!current.pinned&&current.type!=='file',run:()=>collection(),count:stats?.count},
    {name:'Pinned',icon:'pin',active:view==='gallery'&&current.pinned,run:()=>collection('all',true)},
    {name:'Files',icon:'file',active:view==='gallery'&&current.type==='file'&&!current.pinned,run:()=>collection('file')},
    {name:'Uploads',icon:'share',active:view==='uploads',run:()=>navigate('/uploads'),count:pendingCount.value||undefined},
    {name:'Trash',icon:'trash',active:view==='trash',run:()=>navigate('/trash'),count:stats?.trashCount},
    {name:'Settings',icon:'settings',active:view==='settings',run:()=>navigate('/settings')},
  ];
  const navigationLinks=()=>links.map(link=><button key={link.name} class={link.active?'workspace-link active':'workspace-link'} aria-current={link.active?'page':undefined} onClick={()=>{setNavigation(false);link.run();}}><Icon name={link.icon} size={18}/><span>{link.name}</span>{link.count!==undefined&&<span class="workspace-count">{link.count}</span>}</button>);
  const used=stats?stats.bytes+stats.trashBytes:0;
  return <><a class="workspace-skip" href="#workspace-content">Skip to content</a><header class="workspace-topbar"><div class="workspace-identity"><button class="workspace-brand" aria-label="Dump home" onClick={()=>collection()}>D</button><div class="workspace-label">Personal<span> workspace</span><small>FREE</small></div><span class="workspace-crumb" aria-hidden="true">/</span><span class="workspace-crumb"><Icon name="file" size={17}/>Dump</span></div><div class="workspace-top-actions"><button class="icon-button workspace-menu-button" aria-label="Open navigation" onClick={()=>setNavigation(true)}><Icon name="menu"/></button><label class="workspace-search"><Icon name="search" size={17}/><input ref={input} type="search" aria-label="Search files" placeholder="Search files…" value={draft} maxLength={60} onKeyDown={event=>{if(event.key==='Escape'){clearTimeout(timer.current);setDraft('');updateFilters({q:''});void loadFirstPage();input.current?.blur();}}} onInput={event=>{const q=event.currentTarget.value;setDraft(q);clearTimeout(timer.current);timer.current=setTimeout(()=>{updateFilters({q:q.trim()});if(route.peek().view!=='gallery')navigate('/');void loadFirstPage();scrollTo({top:0,behavior:'instant'});},250);}}/><kbd aria-hidden="true">⌘ K</kbd></label></div></header><div class="workspace-layout"><aside class="workspace-sidebar" aria-label="Workspace navigation"><p class="workspace-eyebrow">Project</p><nav>{navigationLinks()}</nav><div class="workspace-account"><div class="workspace-storage"><span>Storage</span><span>{stats?`${bytes(used)} / ${bytes(stats.capBytes)}`:'See Settings'}</span>{stats&&<progress aria-label="Workspace storage used" value={used} max={stats.capBytes}/>}</div><button class="workspace-profile" onClick={()=>navigate('/settings')}><span class="workspace-avatar"><Icon name="lock" size={14}/></span><span><strong>Personal account</strong><small>Private workspace</small></span></button></div></aside><div class="workspace-panel" id="workspace-content">{children}</div></div>{navigation&&<Dialog title="Navigation" onClose={()=>setNavigation(false)}><nav class="workspace-mobile-links">{navigationLinks()}</nav><button class="text-button" onClick={()=>setNavigation(false)}>Close navigation</button></Dialog>}</>;
}
