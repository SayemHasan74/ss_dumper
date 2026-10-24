import { effect, signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import type { FileDTO } from '../../../shared/types';
import { bulkAction, normalizeTag } from '../store/actions';
import { tags } from '../store/files';
import { Dialog } from './Dialog';
import { authState } from '../auth';

const request = signal<FileDTO[] | null>(null);
effect(() => { if (authState.value === 'out') request.value = null; });
export function openTag(files: FileDTO[]): void { request.value = files; }
export function TagDialog() { return request.value ? <TagForm files={request.value} /> : null; }
function TagForm({ files }: { files: FileDTO[] }) {
  const [mode, setMode] = useState<'tag_add' | 'tag_remove'>('tag_add'), [value, setValue] = useState(''), [saving, setSaving] = useState(false);
  const tag = normalizeTag(value), valid = /^[a-z0-9-]{1,24}$/.test(tag);
  const close = () => { request.value = null; };
  const existing = [...new Set(files.flatMap((file) => file.tags))].sort();
  return <Dialog title="Tags" onClose={close}><form onSubmit={async (event) => { event.preventDefault(); if (!valid || saving) return; setSaving(true); if (await bulkAction(mode, files, tag)) close(); else setSaving(false); }}>
    <label>Action<select aria-label="Action" value={mode} onChange={(event) => { setMode(event.currentTarget.value as typeof mode); setValue(''); }}><option value="tag_add">Add tag</option><option value="tag_remove">Remove tag</option></select></label>
    {mode === 'tag_add' ? <><label>Tag<input autoFocus list="tag-suggestions" value={value} onInput={(event) => setValue(event.currentTarget.value)} maxLength={60} /></label><datalist id="tag-suggestions">{tags.value.map(({ tag }) => <option key={tag} value={tag} />)}</datalist><p class="form-hint">Lowercase letters, numbers and hyphens; up to 24 characters.</p></> : <label>Tag<select aria-label="Tag" value={value} onChange={(event) => setValue(event.currentTarget.value)}><option value="">Choose a tag</option>{existing.map((tag) => <option key={tag}>{tag}</option>)}</select></label>}
    <div class="dialog-actions"><button type="button" class="text-button" onClick={close}>Cancel</button><button class="primary-button" disabled={!valid || saving}>{saving ? 'Saving…' : 'Save'}</button></div>
  </form></Dialog>;
}
