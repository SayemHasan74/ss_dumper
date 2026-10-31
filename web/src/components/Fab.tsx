import { enqueue } from '../upload/queue';
import { Icon } from './Icon';
import { selectMode } from '../store/selection';

export function Fab() {
  if (selectMode.value) return null;
  return <div class="upload-picker"><input id="upload-files" class="upload-input" type="file" aria-label="Add files" multiple onChange={(event) => {
    const input = event.currentTarget;
    const files = [...(input.files ?? [])]; input.value = ''; enqueue(files);
  }} /><label class="upload-fab" htmlFor="upload-files"><Icon name="plus" size={28} /><span class="sr-only">Add files</span></label></div>;
}
