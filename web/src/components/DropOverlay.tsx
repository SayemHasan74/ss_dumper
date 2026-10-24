import { useEffect, useState } from 'preact/hooks';
import { enqueue } from '../upload/queue';
import { Icon } from './Icon';

export function DropOverlay() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let depth = 0;
    const files = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
    const enter = (event: DragEvent) => { if (files(event)) { event.preventDefault(); depth++; setVisible(true); } };
    const leave = (event: DragEvent) => { if (files(event) && --depth <= 0) { depth = 0; setVisible(false); } };
    const over = (event: DragEvent) => { if (files(event)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; } };
    const drop = (event: DragEvent) => {
      if (!files(event)) return;
      event.preventDefault(); depth = 0; setVisible(false);
      const entries = [...(event.dataTransfer?.items ?? [])];
      const picked = entries.length ? entries.filter((entry) => entry.kind === 'file' && !entry.webkitGetAsEntry?.()?.isDirectory).map((entry) => entry.getAsFile()).filter((file): file is File => !!file) : [...(event.dataTransfer?.files ?? [])];
      enqueue(picked);
    };
    const blur = () => { depth = 0; setVisible(false); };
    window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave); window.addEventListener('dragover', over); window.addEventListener('drop', drop); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); window.removeEventListener('blur', blur); };
  }, []);
  return visible ? <div class="drop-overlay" role="status"><Icon name="plus" size={44} /><p>Drop to upload to Dump</p></div> : null;
}
