PART 4 of 8 — Frontend shell, virtualized gallery, viewer

The rules in Part 1 section 0 and the security/auth model from Part 2 apply. FIRST ACTION: save this entire message verbatim to docs/spec/part-4.md, then re-read docs/spec/part-1.md through part-3.md. This part builds the signed-in app: layout, theming, data store, a virtualized thumbnail grid, filters, search, and the full-screen viewer. NO upload (Part 5), NO selection or actions (Part 6).

1. Fixed UI decisions
Scrolling: the WINDOW scrolls (not an inner div). Reason: iOS status-bar-tap-to-top and Safari's collapsing toolbar only work with window scroll.
Grid: square cells, object-fit: cover. Phone (container width < 640 px): minimum cell 104 px, gap 3 px. Larger: minimum cell 148 px, gap 6 px. Columns = max(2, floor((W + gap) / (minCell + gap))), cell = floor((W - gap * (cols - 1)) / cols). W is the content width after horizontal padding that respects env(safe-area-inset-left/right).
Newest first only. No date-group headers.
Theme follows the system. Define tokens as CSS custom properties in styles.css and expose them to Tailwind v4 through @theme (so utilities like bg-bg, text-muted exist). Exact values:
light: bg 
#f6f7f9, surface 
#ffffff, text 
#111418, muted 
#667085, border 
#e4e7ec, accent 
#4f46e5, danger 
#d92d20
dark (@media (prefers-color-scheme: dark)): bg 
#0b0d10, surface 
#14171c, text 
#eef0f3, muted 
#98a2b3, border 
#262b33, accent 
#818cf8, danger 
#f97066
color-scheme: light dark. Two <meta name="theme-color"> tags with media for light (
#f6f7f9) and dark (
#0b0d10).
System font stack only. Icons are inline SVG in components/Icon.tsx (one component, a record of path data: search, refresh, more, close, chevron-left, chevron-right, pin, image, file-pdf, plus (used in Part 5), check, trash, copy, download, share, tag, edit, clock).
Global CSS rules for touch devices: -webkit-tap-highlight-color: transparent; touch-action: manipulation on all buttons and links; all interactive targets >= 44x44 px (cells excepted); button { font: inherit }; inputs font-size: 16px minimum (prevents iOS zoom); html { overscroll-behavior-y: none } is NOT used (do not break native pull behaviour); -webkit-touch-callout: none and user-select: none on grid cells; use 100dvh never 100vh; @media (prefers-reduced-motion: reduce) disables all transitions and the skeleton pulse.
Lazy chunks: Viewer is loaded with a dynamic import() on first open and prefetched during idle time after the first page renders (requestIdleCallback with a setTimeout(…, 1500) fallback). The initial bundle must stay under the 40 KB gzip budget.
2. Files to create or modify
shared/types.ts                 (from Part 3, imported by the web app)
web/src/lib/format.ts           bytes, date/time, relative time via Intl (no date library)
web/src/lib/router.ts           hash router
web/src/lib/env.ts              isTouch(), isIOS(), isStandalone()
web/src/store/files.ts          list state + actions
web/src/store/ui.ts             filters, viewer state, toasts
web/src/components/Icon.tsx
web/src/components/Header.tsx
web/src/components/FilterBar.tsx
web/src/components/VirtualGrid.tsx
web/src/components/Cell.tsx
web/src/components/Skeleton.tsx
web/src/components/Viewer.tsx   (lazy)
web/src/components/Toast.tsx    single-line toasts with optional action button
web/src/views/Gallery.tsx
web/src/main.tsx                MODIFY: replace the Part 2 "Signed in" placeholder with the app
web/src/styles.css
web/index.html                  MODIFY: theme-color metas
scripts/seed.mjs                (section 11)
3. Router (lib/router.ts, hand-written, ~40 lines)
A signal route derived from location.hash. Routes: #/ -> gallery, #/v/<id> -> viewer open over the gallery. Unknown hash -> replace with #/. Part 6 will register #/trash and #/settings, so build a tiny route table (pattern -> view) rather than hard-coded ifs.
navigate(path, { replace }) uses location.hash (push) or history.replaceState. Opening the viewer pushes a history entry; closing it calls history.back() when the viewer was opened from inside the app, else replaces with #/. The browser/Android back button and the iOS edge-swipe therefore close the viewer.
The gallery stays mounted underneath the viewer so scroll position and loaded items are preserved.
4. Data store (store/files.ts, signals)

State: items: FileDTO[] (ordered newest first), nextCursor: string | null, status: 'idle' | 'loading' | 'loadingMore' | 'error', errorMessage, tags: {tag,count}[], settings: SettingsDTO | null.

Rules:

loadFirstPage(): aborts any in-flight list request (AbortController), sends GET /api/files?limit=48 plus the active filters, replaces items. First page is 48, later pages 60.
loadMore(): no-op while loading or when nextCursor is null; appends. Never allows two loads at once.
Stale-response protection: every request gets an incrementing token; a response whose token is not the latest is discarded.
refresh(): fetches the first page and MERGES it: every currently loaded item whose id is >= the smallest id in the fetched page is replaced by the fetched set (this adds new files, updates changed ones, removes deleted ones); older loaded items are left alone. If the user has scrolled down more than two rows, do NOT insert new items immediately: keep a pendingNew count and show a pill "N new · Show" at the top of the grid; tapping it applies the merge and scrolls to the top. When scrolled near the top, apply immediately.
Refresh triggers: visibilitychange to visible, window focus, online, and the header refresh button; throttled to once per 5 s. No polling.
On authState -> out: clear all store state. On -> in: loadFirstPage(), load tags and settings (GET /api/tags, GET /api/settings) in parallel; tags reload after filter-relevant mutations (Part 6) and on refresh.
Errors: first-page failure shows an inline error panel with a Retry button (not a toast). loadMore failure shows a small "Couldn't load more · Retry" row at the bottom of the grid.
5. Virtualized grid (VirtualGrid.tsx)

Hand-written, fixed-size cells, so the math is trivial. Algorithm:

Measure container width with ResizeObserver; compute cols, cell, rowHeight = cell + gap.
Total rows = ceil(items.length / cols), plus one extra row of skeleton cells while nextCursor is non-null.
A passive scroll listener throttled with requestAnimationFrame computes firstRow = floor((scrollY - gridTop) / rowHeight) - 3 and lastRow = ceil((scrollY + innerHeight - gridTop) / rowHeight) + 3 (clamped). Only update the signal when firstRow/lastRow/cols actually change.
Render: an outer div with height = totalRows * rowHeight (a spacer) containing an absolutely positioned inner CSS grid at top = firstRow * rowHeight holding only the visible rows' cells, grid-template-columns: repeat(cols, <cell>px), gap. Cells are keyed by file id.
Infinite scroll: when lastRow * cols >= items.length - cols * 4 call loadMore().
Keep contain: layout paint on the grid wrapper. Never read layout properties inside the render path except through the single measured values above (no layout thrash).
Keyboard: the grid is one tab stop; Arrow keys move focus between cells (scrolling the target row into the rendered range first), Enter opens the viewer.
Must stay at 60 fps while flinging through 5,000 items (verified in section 11).
6. Cell (Cell.tsx)

A <button> (aria-label = file name, e.g. "photo.png, 1.2 MB") containing:

<img> for images with a thumbnail: src="/api/files/<id>/thumb?v=<thumbSize>", explicit width/height equal to the cell size, alt="", decoding="async", draggable="false", fade-in on load (opacity 0 -> 1, 120 ms; only on first load).
If thumbSize === 0 or the image errors: a neutral placeholder tile with the image icon (or a "PDF" label for PDFs). Do not retry failed images automatically, with ONE exception: if the file is less than 2 minutes old (Date.now() - createdAt < 120000), retry the image once after 3 seconds (Workers KV can take a short while to show a brand-new object to another device).
Small badges: pin icon top-left when pinned; "PDF" chip bottom-left for PDFs.
Rounded corners 6 px (phone 4 px). :focus-visible shows a 2 px accent ring.
Clicking navigates to #/v/<id>.
7. Skeleton and states
On first mount (status loading, no items) render 30 skeleton cells with the same sizing and a gentle opacity pulse (disabled with reduced motion). This is what the user sees instantly while the first request runs.
Empty state (no items, no filters): icon + "Nothing here yet" + "Tap + to add screenshots." (the + button arrives in Part 5; the text stays).
Empty state with filters/search active: "No matches" + a "Clear filters" button.
Offline (navigator.onLine === false) and the list fails: "You're offline" with Retry.
8. Header and filters

Header (sticky, top, respects env(safe-area-inset-top)): title "Dump"; search icon button that toggles an inline search input (autofocus only when isTouch() is false; Escape or the clear button closes it; typing is debounced 250 ms and trimmed; max 60 chars); refresh icon button (spins while loading); "more" icon button opening a small popover menu containing "Sign out" (calls logout() from Part 2). Part 6 adds more menu items and a Select button, so build the menu as a data-driven list and keep the header actions in an array.

FilterBar (sticky under the header, one horizontally scrollable row, no visible scrollbar, scroll-snap): chips in groups:

Type (single-select): All, Images, PDFs
Time (single-select, off by default): Today (since local midnight), 7 days
Pinned (toggle)
Tags: the top 12 from /api/tags (single-select; a second tap clears) Selecting any chip updates the filter signals and calls loadFirstPage() immediately; scroll returns to top. Active chips use the accent colour. The filter state is NOT persisted.
9. Viewer (Viewer.tsx)

Full-screen overlay (position: fixed; inset: 0), black at 92 % opacity regardless of theme, role="dialog", aria-modal="true", aria-label = file name.

Layout: top bar (close ×, truncated name, "3 / 120" position counter), center media, bottom info bar (size, dimensions, created date/time formatted with Intl, tags as chips, note text). Part 6 adds the action buttons to the top bar.
Images: show the cached grid thumbnail immediately, scaled to fit (instant), then load /api/files/<id>/original in a stacked <img>; when img.decode() resolves, fade it in over the thumbnail. If the thumbnail does not exist, show a spinner. Original failure -> message "Couldn't load image" + Retry. If the original fails with a 404 and the file is less than 2 minutes old, retry automatically once after 3 seconds before showing the message (KV propagation).
Zoom: click/double-tap toggles between "fit" (object-fit: contain) and "actual size" inside a scrollable container (overflow: auto, touch-action: pan-x pan-y pinch-zoom). Esc or tap on the backdrop (when not zoomed) closes.
PDFs: centered card (PDF icon, name, size) with two anchors: "Open" (target="_blank" rel="noopener" to /api/files/<id>/original) and "Download" (...?download=1).
Navigation: ArrowLeft/ArrowRight, on-screen chevron buttons (hidden on touch), and touch swipe (horizontal movement > 48 px and |dx| > 1.5 * |dy| navigates; a downward drag > 80 px closes, with the overlay following the finger). Navigation follows the currently loaded items order; when within 3 items of the end and nextCursor exists, call loadMore(). If the open id is not in items (deep link), fetch it with GET /api/files/<id> and show it without prev/next.
After the current original has decoded, preload the next image's original (images only, size <= 8 MB) with new Image().
Focus: on open focus the close button; trap Tab inside the overlay; on close return focus to the originating cell if still mounted. The page behind does not scroll while the viewer is open (overlay uses touch-action: none on the backdrop and overscroll-behavior: contain).
10. Auth and bootstrapping

main.tsx: while authState is unknown render only the background; out -> Login (Part 2); in -> <Gallery/> with Header, FilterBar, grid, Toast host, lazy Viewer. Any 401 from the API flips to out (Part 2 api.ts) which unmounts the gallery and clears the store.

11. Seed script and performance acceptance

scripts/seed.mjs: node scripts/seed.mjs [count=300] uploads count unique synthetic PNGs (via scripts/lib/png.mjs, different seed each, 64x64 is enough) to SMOKE_BASE_URL using SMOKE_UPLOAD_TOKEN, 4 at a time, with the sha header, printing progress. It is a dev tool only and never runs in CI. (Against a REAL deployment each seeded file spends one KV write from the daily 1,000; the script must refuse to run against an https: base URL unless --force is passed.)

Performance checks (verify and report numbers):

With 1,000+ seeded files (placeholders are fine; real thumbnails arrive in Part 5): flinging the page keeps rendered cell count under 120 and shows no dropped-frame hitches in the Performance panel.
First paint of skeletons < 1 s on a throttled "Fast 3G" profile after the shell is cached.
No layout shift when thumbnails load (explicit sizes).
npm run build budget check still passes; the Viewer chunk is not in the initial bundle.
12. Acceptance criteria
 npm run typecheck, npm test, npm run build pass; initial JS <= 40 KB gzip, CSS <= 10 KB gzip.
 Logged in, the gallery shows skeleton -> grid; filters, search, tags chips work; refresh and the "N new" pill work.
 Viewer: opens from a cell, URL becomes #/v/<id>, Back closes it, arrow keys/swipe navigate, deep link works, PDF card works, focus is trapped and restored.
 Dark/light follow the system; no FOUC; iPhone-sized viewport (390 px) has no horizontal scroll and respects safe areas.
 No inline scripts/styles; browser console shows no CSP violations.
 Spec saved at docs/spec/part-4.md.

STOP after this part. Do not start Part 5. Report using the format in Part 1, section 0, rule 6.