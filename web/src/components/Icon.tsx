const paths = {
  grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
  menu: 'M4 6h16M4 12h16M4 18h16', settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M10 2l-.5 3-2 1-3-1-2 4 2.5 2v2L2.5 15l2 4 3-1 2 1 .5 3h4l.5-3 2-1 3 1 2-4-2.5-2v-2l2.5-2-2-4-3 1-2-1L14 2Z',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5Z',
  'file': 'M14 2H5v20h14V7l-5-5v5h5',
  search: 'm21 21-5-5M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14',
  refresh: 'M20 7a8 8 0 1 0 1 8M20 3v5h-5',
  more: 'M5 12h.01M12 12h.01M19 12h.01', close: 'm6 6 12 12M6 18 18 6',
  'chevron-left': 'm15 5-7 7 7 7', 'chevron-right': 'm9 5 7 7-7 7',
  pin: 'm9 3 6 0-1 6 4 4v2H6v-2l4-4-1-6M12 15v6',
  image: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm-1 13 5-5 4 4 3-3 6 6M8 7h.01',
  'file-pdf': 'M14 2H5v20h14V7l-5-5v5h5M8 12h8M8 16h6',
  plus: 'M12 5v14M5 12h14', check: 'm5 12 4 4L19 6', trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  copy: 'M9 9h12v12H9ZM3 15V3h12', download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  share: 'M12 16V3m-5 5 5-5 5 5M5 12v9h14v-9', tag: 'M3 3h8l10 10-8 8L3 11V3Zm4 4h.01',
  edit: 'm15 4 5 5M4 15 16 3l5 5L9 20l-6 1 1-6', clock: 'M12 8v5l3 2M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
};
export type IconName = keyof typeof paths;
export function Icon({ name, size = 20, class: className = '' }: { name: IconName; size?: number; class?: string }) {
  return <svg class={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
