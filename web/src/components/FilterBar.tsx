import { loadFirstPage, tags } from '../store/files';
import { filters, updateFilters, type Filters } from '../store/ui';
import { Icon } from './Icon';
import { navigate, route } from '../lib/router';

export function FilterBar() {
  const current = filters.value;
  const notes = route.value.view === 'notes';
  function choose(value: Partial<Filters>): void { updateFilters(value); if (notes) navigate('/'); void loadFirstPage(); window.scrollTo({ top: 0, behavior: 'instant' }); }
  return <nav class="filter-bar" aria-label="Filter files"><div class="filter-scroll page-width">
    <div class="filter-group" role="group" aria-label="Content type">{([{ value: 'all', label: 'All' }, { value: 'image', label: 'Images' }, { value: 'pdf', label: 'PDFs' }] as const).map((option) => <button key={option.value} class={!notes && current.type === option.value ? 'chip active' : 'chip'} aria-pressed={!notes && current.type === option.value} onClick={() => choose({ type: option.value })}>{option.label}</button>)}<button class={notes ? 'chip active' : 'chip'} aria-pressed={notes} onClick={() => navigate('/notes')}>Notes</button></div>
    {!notes && <>
    <span class="filter-divider" aria-hidden="true" />
    <div class="filter-group" role="group" aria-label="Upload time">{([{ value: 'today', label: 'Today' }, { value: 'week', label: '7 days' }] as const).map((option) => <button key={option.value} class={current.time === option.value ? 'chip active' : 'chip'} aria-pressed={current.time === option.value} onClick={() => choose({ time: current.time === option.value ? 'all' : option.value })}>{option.label}</button>)}</div>
    <span class="filter-divider" aria-hidden="true" />
    <button class={current.pinned ? 'chip active' : 'chip'} aria-pressed={current.pinned} onClick={() => choose({ pinned: !current.pinned })}><Icon name="pin" size={16} />Pinned</button>
    {tags.value.slice(0, 12).map(({ tag, count }) => <button key={tag} class={current.tag === tag ? 'chip active' : 'chip'} aria-pressed={current.tag === tag} aria-label={`Tag: ${tag}, ${count} files`} onClick={() => choose({ tag: current.tag === tag ? '' : tag })}>{tag}</button>)}
    </>}
  </div></nav>;
}
