import { effect, signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import type { FileDTO } from '../../../shared/types';
import { editFile, normalizeTag } from '../store/actions';
import { Dialog } from './Dialog';
import { authState } from '../auth';

const request = signal<FileDTO | null>(null);
effect(() => { if (authState.value === 'out') request.value = null; });
export function openEdit(file: FileDTO): void { request.value = file; }
export function EditDialog() { return request.value ? <EditForm key={request.value.id} file={request.value} /> : null; }
function EditForm({ file }: { file: FileDTO }) {
  const [name, setName] = useState(file.name), [note, setNote] = useState(file.note), [tags, setTags] = useState(file.tags), [draft, setDraft] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const close = () => { request.value = null; };
  function addTag(): void { const tag = normalizeTag(draft); if (!/^[a-z0-9-]{1,24}$/.test(tag) || tags.length >= 5) { setError('Use a valid tag; maximum 5 tags.'); return; } setTags([...new Set([...tags, tag])]); setDraft(''); setError(''); }
  return <Dialog title="Edit file" onClose={close}><form onSubmit={async (event) => { event.preventDefault(); if (saving) return; if (draft.trim()) { setError('Add or clear the tag before saving.'); return; } setSaving(true); if (await editFile(file, { name, note, tags })) close(); else setSaving(false); }}>
    <label>Name<input autoFocus value={name} maxLength={200} onInput={(event) => setName(event.currentTarget.value)} /></label>
    <label>Note<textarea value={note} maxLength={280} onInput={(event) => setNote(event.currentTarget.value)} /></label><p class="form-hint">{note.length} / 280</p>
    <div class="edit-tags">{tags.map((tag) => <button type="button" class="chip" key={tag} aria-label={`Remove tag ${tag}`} onClick={() => setTags(tags.filter((value) => value !== tag))}>{tag} ×</button>)}</div>
    <label>New tag<input value={draft} onInput={(event) => setDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }} /></label><button type="button" class="text-button" onClick={addTag} disabled={tags.length >= 5}>Add tag</button><p role="status">{error}</p>
    <div class="dialog-actions"><button type="button" class="text-button" onClick={close}>Cancel</button><button class="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
  </form></Dialog>;
}
