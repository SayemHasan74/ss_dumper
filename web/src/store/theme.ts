import { signal } from '@preact/signals';
export type Theme = 'system' | 'light' | 'dark';
const valid=(value:unknown):value is Theme=>value==='system'||value==='light'||value==='dark';
let initial:Theme='system';try{const saved=localStorage.getItem('dump-theme');if(valid(saved))initial=saved;}catch{/* Preference storage is optional. */}
export const theme=signal<Theme>(initial);
const dark=matchMedia('(prefers-color-scheme: dark)');
function apply():void{const mode=theme.peek()==='system'?(dark.matches?'dark':'light'):theme.peek();document.documentElement.dataset.theme=mode;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',mode==='dark'?'#0b0c0e':'#eee9dd');}
export function setTheme(value:Theme):void{theme.value=value;try{localStorage.setItem('dump-theme',value);}catch{/* Still apply for this tab. */}apply();}
dark.addEventListener('change',apply);
window.addEventListener('storage',event=>{if(event.key==='dump-theme'){theme.value=valid(event.newValue)?event.newValue:'system';apply();}});
apply();
