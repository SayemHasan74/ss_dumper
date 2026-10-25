import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { galleryItems as items, loadMore, loadMoreError, nextCursor, status } from '../store/files';
import { gridMetrics } from '../store/ui';
import { openViewer, route } from '../lib/router';
import { Cell } from './Cell';
import { Skeleton } from './Skeleton';
import { selectMode, toggleSelection } from '../store/selection';

interface Layout { cols: number; cell: number; gap: number; first: number; last: number; rowHeight: number }
export function VirtualGrid() {
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const measured = useRef({ width: 0, top: 0 });
  const current = useRef<Layout>({ cols: 2, cell: 104, gap: 3, first: 0, last: 10, rowHeight: 107 });
  const [layout, setLayout] = useState(current.current);
  const [focused, setFocused] = useState(0);
  const keyboard = useRef(false);
  const count = items.value.length;
  const loading = status.value === 'loading' && !count;
  const skeletonCount = loading ? 30 : nextCursor.value ? layout.cols : 0;
  const totalRows = Math.ceil((loading ? 30 : count) / layout.cols) + (!loading && nextCursor.value ? 1 : 0);
  const rows = useRef(totalRows); rows.current = totalRows;
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    function update(): void {
      frame.current = 0;
      if (route.peek().view === 'viewer') return;
      const width = measured.current.width;
      if (!width) return;
      const gap = width < 640 ? 3 : 6;
      const minimum = width < 640 ? 104 : 148;
      const cols = Math.max(2, Math.floor((width + gap) / (minimum + gap)));
      const cell = Math.floor((width - gap * (cols - 1)) / cols);
      const rowHeight = cell + gap;
      const first = Math.max(0, Math.min(rows.current, Math.floor((scrollY - measured.current.top) / rowHeight) - 3));
      const last = Math.max(first, Math.min(rows.current, Math.ceil((scrollY + innerHeight - measured.current.top) / rowHeight) + 3));
      const value = { cols, cell, gap, first, last, rowHeight };
      const previous = current.current;
      if (previous.cols !== cols || previous.cell !== cell || previous.first !== first || previous.last !== last) { current.current = value; setLayout(value); }
      const metrics = gridMetrics.peek();
      if (metrics.cols !== cols || metrics.cell !== cell || metrics.gridTop !== measured.current.top) gridMetrics.value = { cols, cell, rowHeight, gridTop: measured.current.top };
      if (last * cols >= items.peek().length - cols * 4 && nextCursor.peek() && !loadMoreError.peek()) void loadMore();
    }
    function schedule(): void { if (!frame.current) frame.current = requestAnimationFrame(update); }
    function measure(): void {
      const box = element!.getBoundingClientRect();
      measured.current = { width: box.width, top: box.top + scrollY };
      schedule();
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', measure);
    window.addEventListener('dump:layout', measure);
    measure();
    update();
    return () => { observer.disconnect(); cancelAnimationFrame(frame.current); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', measure); window.removeEventListener('dump:layout', measure); };
  }, []);
  useEffect(() => { window.dispatchEvent(new Event('dump:layout')); }, [totalRows, count, loading]);
  useEffect(() => { if (keyboard.current) document.getElementById(`cell-${items.peek()[focused]?.id}`)?.focus({ preventScroll: true }); }, [focused, layout.first, layout.last]);
  const first = layout.first * layout.cols;
  const end = Math.min(count + skeletonCount, layout.last * layout.cols);
  const cells = loading ? Array.from({ length: 30 }, (_, index) => <Skeleton key={`s${index}`} />) : Array.from({ length: Math.max(0, end - first) }, (_, index) => {
    const file = items.value[first + index];
    return file ? <Cell key={file.id} file={file} size={layout.cell} /> : <Skeleton key={`s${first + index}`} />;
  });
  return <div ref={root} class="virtual-grid" role="group" aria-label="Files. Use arrow keys to browse and Enter to open." tabIndex={0} style={{ height: `${totalRows * layout.rowHeight}px` }} onFocus={(event) => { if (event.target === event.currentTarget) keyboard.current = true; }} onPointerDown={() => { keyboard.current = false; }} onKeyDown={(event) => {
    const files = items.peek();
    if (!files.length) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-file-id]');
    const index = target ? files.findIndex((file) => file.id === target.dataset.fileId) : Math.min(focused, files.length - 1);
    if (event.key === 'Enter') { event.preventDefault(); const file = files[index]; if (!('localId' in file)) { if (selectMode.peek()) toggleSelection(file); else openViewer(file.id, target ?? event.currentTarget); } return; }
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -layout.cols, ArrowDown: layout.cols };
    if (moves[event.key] === undefined) return;
    event.preventDefault(); keyboard.current = true;
    const next = Math.max(0, Math.min(files.length - 1, index + moves[event.key]));
    setFocused(next);
    const metrics = gridMetrics.peek();
    const y = metrics.gridTop + Math.floor(next / layout.cols) * layout.rowHeight;
    const sticky = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) + 60;
    if (y < scrollY + sticky) scrollTo({ top: Math.max(0, y - sticky), behavior: 'instant' });
    else if (y + layout.cell > scrollY + innerHeight) scrollTo({ top: y + layout.cell - innerHeight, behavior: 'instant' });
  }}><div class="grid-window" style={{ top: `${layout.first * layout.rowHeight}px`, gridTemplateColumns: `repeat(${layout.cols}, ${layout.cell}px)`, gap: `${layout.gap}px` }}>{cells}</div></div>;
}
