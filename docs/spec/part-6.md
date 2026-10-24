The rules in Part 1 section 0 and the earlier parts apply. FIRST ACTION: save this entire message verbatim to docs/spec/part-6.md, then re-read docs/spec/part-1.md through part-5.md. This is where the app becomes a "folder": select files, COPY them straight into a chat, delete with undo, manage Trash and settings. COPY IS THE MOST IMPORTANT FEATURE OF THE WHOLE PRODUCT (not download): selecting one or many screenshots and pasting them into whatever I am typing in must be fast, obvious and reliable on desktop and on the phone. Backend contracts are in Part 3 section 10. fflate is added in this part (lazy-loaded only).
- Deleting from the gallery moves to Trash with an UNDO toast (no confirmation dialog). Moving to Trash costs no storage operations. Permanent deletion only happens from the Trash view, with a confirmation dialog.
- Clipboard reality (browser limitation, do not fight it): navigator.clipboard.write can hold only ONE image, and only as image/png. So: single image -> one click copies it. Several images -> I get TWO ways to paste many, both inside the same floating Copy Queue bar: (1) "One by one": the first image is copied immediately, and a floating "Copy next (2 of 10)" button copies the next one each time I have pasted; (2) "One image": the selected images are stitched into one tall PNG "sheet" (several sheets if there are many) that pastes as a single picture. PDFs cannot be copied; they use Download/Open/Share.
- Multi-file download = one ZIP built in the browser with fflate (store-only, no compression, since PNG/JPEG are already compressed).
- All confirmations are a custom accessible modal (role="alertdialog", focus trap, Esc closes, focus restored). Never window.confirm/alert.
- Optimistic UI everywhere: update local state first, call the API, roll back and show an error toast on failure.
- Order of multiple images in the copy queue and in stitched sheets is CHRONOLOGICAL (oldest first, newest last), regardless of the order I tapped them, so a series of screenshots reads naturally. Log this in DECISIONS.md.
- Phone first: on a phone (container width < 640 px) the action buttons live in a bottom toolbar within thumb reach (section 3). The + button is hidden while selection mode is active.
```
package.json                     ADD dependency: fflate (exact version, lazy-imported only)
vitest.config.ts                 MODIFY: also include web/test/**/*.test.ts (pure functions only, no DOM, no new dependency)
tsconfig.json                    MODIFY: also include web/test
web/src/store/selection.ts       selection state
web/src/store/actions.ts         trash/restore/purge/pin/tag/rename calls with optimistic updates
web/src/lib/clipboard.ts         image copy helpers, PNG conversion, prefetch cache
web/src/lib/stitch.ts            pure sheet planner + canvas renderer for "One image" copy mode
web/src/lib/zip.ts               lazy fflate wrapper
web/src/lib/share.ts             Web Share helper
web/src/components/SelectionBar.tsx
web/src/components/CopyQueue.tsx
web/src/components/Dialog.tsx    modal + confirm helper
web/src/components/TagDialog.tsx
web/src/components/EditDialog.tsx
web/src/components/Toast.tsx     MODIFY: action button, undo
web/src/components/Viewer.tsx    MODIFY: action buttons
web/src/components/Cell.tsx      MODIFY: selection visuals
web/src/components/Fab.tsx       MODIFY: hidden while selection mode is active
web/src/components/Header.tsx    MODIFY: Select button, menu items Trash, Settings
web/src/views/Trash.tsx          (lazy)
web/src/views/Settings.tsx       (lazy)
web/src/lib/router.ts            MODIFY: routes #/trash, #/settings
web/test/stitch.test.ts          planner unit tests (section 5)
README.md                        MODIFY: usage section
```
- State: selectedIds (a Set signal) and selectMode (a boolean signal). Selection mode is active whenever selectMode is true. It becomes true when: I tap the Select button in the Header (a check-icon button, aria-label="Select", placed next to search; this is the discoverable way to start selecting on a phone), I long-press a cell, I tick a desktop hover checkbox, or I Ctrl/Cmd/Shift-click a cell. It becomes false when the selection is cleared (see below) or I tap Done/Clear. With selectMode true and nothing selected the bar shows "Select items" and the action buttons are disabled.
- Touch: long-press a cell (500 ms, cancelled by movement > 8 px or scroll) enters selection mode and selects it; in selection mode a tap toggles. Suppress the iOS context menu on long-press (contextmenu preventDefault on cells). A light navigator.vibrate(10) where supported.
- Desktop: hovering a cell shows a checkbox in its corner (click toggles; click anywhere toggles once in selection mode); Ctrl/Cmd+click toggles; Shift+click selects the range from the last toggled cell using the current items order; drag-select is not required.
- Selected cells show a check badge and an accent outline with a slight dim of the image.
- Selection is cleared (and selectMode set to false) by: Escape, the Clear/Done button, changing filters/search, signing out, or after a destructive action completes.
- SelectionBar replaces the header while selection mode is active (sticky, same safe-area handling): 
  - Wide screens (container width >= 640 px): one bar with the count ("3 selected"), the Select menu, and the action buttons (icons with labels): Copy, Download, Share (only when navigator.canShare supports files), Pin/Unpin, Tag, Delete, Clear (×).
  - Phones (container width < 640 px): the TOP bar keeps only the count, the Select menu and Clear (×). The actions move to a BOTTOM toolbar fixed above the home indicator (bottom: env(safe-area-inset-bottom), safe-area aware left/right, at least 56 px tall, 44x44 px minimum targets) showing Copy (primary accent button, first), Delete (danger colour), Share (when supported), Download, and a "More" button that opens a popover with Pin/Unpin, Tag and Edit (Edit only when exactly one file is selected). The Copy Queue bar (section 5), the upload tray and toasts stack ABOVE this toolbar.
- Select menu: "All loaded", "Everything matching the current filters", "Today", "Last 7 days", "Images only". "Everything matching" pages through GET /api/files?limit=200 with the active filters up to a hard cap of 2,000 ids, showing "Selecting… 400" progress, and reports if the cap was hit. The other options only use items already loaded (and say so if more pages exist).
All bulk operations use POST /api/files/bulk in chunks of 200 ids, sequentially, EXCEPT purge, which uses chunks of 100 ids (PURGE_MAX_PER_CALL in Part 3).
- Delete -> trash. Items vanish from the grid immediately. Toast: "Moved 3 to Trash · Undo" for 6 s; Undo calls restore for the same ids and re-inserts them (refresh the list). If the server reports affected < requested show "N skipped".
- Pin/Unpin -> pin/unpin; toggles badges immediately. The menu item shows "Unpin" only when ALL selected are pinned.
- Tag: opens TagDialog. Two modes: "Add tag" (text input with suggestions from /api/tags, normalizes like the server: lowercase, spaces to -, 1-24 chars of [a-z0-9-]) and "Remove tag" (lists tags present on the selected items). Uses tag_add / tag_remove. If some files would exceed 5 tags the response shows "N skipped (5-tag limit)". After success refresh tags.
- Rename/note/tags for ONE file: EditDialog (from the viewer's Edit button or the selection bar when exactly one is selected) with fields name (preserves/auto-corrects extension as the server does), note (280 chars, live counter), tags (chips, max 5), calls PATCH /api/files/:id.
- Failures roll back and show "Couldn't <action>. Try again." Network failures keep the selection.
- Eligibility: only images (image/png|jpeg|gif|webp). If the selection has none, disable Copy with a tooltip "PDFs can't be copied. Use Download." If the selection mixes images and PDFs, Copy uses only the images and the toast says "Copied N images (PDFs skipped)".
- copyImage(file): calls navigator.clipboard.write([new ClipboardItem({ 'image/png': promiseOfPngBlob })]) where the value is a PROMISE that fetches the original and, if it is not already PNG, converts it (decode with createImageBitmap, draw on a canvas, toBlob('image/png')). Passing a promise keeps the user-activation on Safari and lets the clipboard call start instantly. Copy runs inside the click/keydown handler. The same function accepts a sheet (see below) because both resolve to a PNG blob promise.
- Single image: click Copy (or Ctrl/Cmd+C) -> toast "Copied. Paste it into your chat."
- Multiple images: Copy opens the Copy Queue: a floating bar (above the FAB position, or above the bottom toolbar on phones; safe-area aware) with: the current thumbnail, a status line, a primary "Copy next" button, "Skip", a mode switch with two options "One by one" and "One image", and a close ×. Opening the queue copies entry 1 immediately (that click is the gesture); each subsequent click on "Copy next" copies the next entry; after the last it shows "All copied" and closes. Space/Enter trigger "Copy next" when the bar is focused; Escape closes. "Skip" moves forward without copying. 
  - "One by one" mode: entries are the individual images in chronological order. Status line: "Image 2 of 10 · copied 1".
  - "One image" mode: entries are SHEETS: the selected images stitched vertically into one PNG each. Status line: "Sheet 1 of 3 · 6 images". Switching the mode (a click, so it is a gesture) rebuilds the queue from the beginning and immediately copies entry 1 of the new mode. The chosen mode is remembered in localStorage key dump.copyMode (values one | sheet; wrap in try/catch; default one).
  - Stitching rules (lib/stitch.ts): 
    - Constants: SHEET_MAX_WIDTH = 1440, SHEET_DEFAULT_WIDTH = 1170, SHEET_MIN_WIDTH = 600, SHEET_PAD = 24, SHEET_GAP = 24, SHEET_MAX_IMAGES = 6, SHEET_MAX_AREA = 14,000,000 px (stays below iOS Safari's 16,777,216 canvas limit), SHEET_MAX_HEIGHT = 16,000 px. Background is solid white. Images are stacked top to bottom in chronological order, centred horizontally.
    - sheetWidth for one copy operation = clamp(widest known image width among the selected images, SHEET_MIN_WIDTH, SHEET_MAX_WIDTH); if no widths are known use SHEET_DEFAULT_WIDTH. Each image is drawn at width min(naturalWidth, sheetWidth - 2 * SHEET_PAD) with its aspect ratio kept (never upscaled).
    - planSheets(dims: {w: number; h: number}[], sheetWidth): { indices: number[]; height: number }[] is a PURE function (no DOM) that greedily fills sheets in order: start a new sheet when adding the next image would exceed SHEET_MAX_IMAGES, SHEET_MAX_AREA or SHEET_MAX_HEIGHT. An image that alone is taller than SHEET_MAX_HEIGHT (or whose area alone exceeds the area cap) is scaled down uniformly to fit and gets its own sheet. Dimensions come from FileDTO.width/height; where they are null, measure them by fetching the original and calling createImageBitmap (then close() it).
    - renderSheet(sheet, loadBitmap) allocates the canvas for that sheet only (OffscreenCanvas when available), decodes and draws images ONE AT A TIME (calling bitmap.close() after each draw so memory stays low), and resolves to a PNG Blob.
  - Tests (web/test/stitch.test.ts, pure functions only): 1 image -> 1 sheet; 7 small images -> 2 sheets (6 + 1); a very tall image gets its own sheet and is scaled to the height cap; area cap splits large images; sheetWidth clamping; chronological ordering helper (input in any order -> oldest first).
- Prefetch: while I paste, fetch and convert the NEXT entry in the background into an in-memory blob cache (keep at most 2 blobs; evict on use, on mode switch, or when the queue closes). For sheets, pre-render the next sheet. Prefetched conversions make "Copy next" instant.
- Failures: if ClipboardItem/clipboard.write is unavailable or denied -> toast "Copy isn't available here. Use Download." Never fail silently.
- Keyboard shortcut (desktop): Ctrl/Cmd+C with a non-empty selection and focus not in an input behaves like the Copy button. In the viewer, Ctrl/Cmd+C copies the current image.
- Reads cost nothing against the write quota; a copy is one KV read per original (and none when the browser has the file cached). Use the same URL form as the viewer so the browser cache is reused.
- Download: one file -> an <a href="/api/files/<id>/original?download=1" download> click. Several -> ZIP: const { Zip, ZipPassThrough } = await import('fflate'); fetch each original sequentially, push into the zip with ZipPassThrough (store only), collect output chunks in an array, build a Blob, trigger a download through an object URL (revoked afterwards). Names are de-duplicated with " (2)", " (3)". Archive name dump-YYYYMMDD-HHmm.zip. Show a progress toast "Zipping 4 of 10". Refuse (toast) if the combined size exceeds 300 MB.
- Share (only rendered when navigator.canShare({ files }) is true for the real File objects): fetch originals as Files (correct name and MIME type) and call navigator.share({ files }). Treat AbortError (user cancelled) as a no-op. Limit to 10 files per share. (On iPhone this is the way to send many screenshots into another app at once.)
Top bar gains: Copy, Download, Share (when supported), Pin/Unpin, Edit, Delete (moves to Trash, shows the undo toast, then advances to the next item or closes if none). Keyboard in the viewer: Delete/Backspace = trash, c with Ctrl/Cmd = copy, p = pin. Show an "Expires in N days" line in the info bar when expiresAt is within 14 days (and "Pinned — never expires" when pinned and auto-expire is on).
- Same virtual grid and cells, data from GET /api/files?trash=1. A banner explains "Files are deleted forever N days after they're moved here" (N from settings). Each cell shows "N d left" computed from deletedAt + trashDays * 86400000.
- Selection mode in Trash offers: Restore, Delete forever (confirmation dialog: "Delete 3 files forever? This can't be undone."), Clear. Toolbar button "Empty Trash" (confirmation) which calls POST /api/trash/empty repeatedly while remaining > 0, with a progress toast. If the server answers 429 DAILY_LIMIT during Delete forever or Empty Trash, stop and show the toast "Daily limit reached. The rest will be cleaned up automatically tomorrow." (the files are already gone from the list; the orphan sweep in Part 8 removes any leftover storage).
- Restore reports skipped duplicates ("2 restored · 1 skipped (already exists)").
- Header: back arrow to the gallery, title "Trash". Viewing a trashed item in the viewer shows Restore and Delete forever instead of the normal actions.
Sections:
1. Storage: usage bar from GET /api/stats (for example "312 MB of 900 MB · 342 files; Trash 120 MB"), turns amber above 80 % and red above 95 %. Under it a small muted note: "Free plan: about 400 uploads per day. The daily limit resets at 06:00 Dhaka time."
2. Auto-delete: select "Never / 7 / 14 / 30 / 60 / 90 days" -> PATCH /api/settings (explain: unpinned files move to Trash that many days after upload).
3. Trash retention: select 1/3/7/14/30 days.
4. Security: "Sign out" and "Sign out everywhere" (confirmation; calls POST /api/auth/logout-all, then shows the login screen).
5. About: build version and date (Vite define constants __APP_VERSION__ from package.json and __BUILD_DATE__). Part 7 adds "Install" and "iPhone Shortcut" sections; Part 8 adds "Run cleanup now".
Ctrl/Cmd+A select all loaded (when not in an input); Esc clears selection or closes dialogs/viewer (innermost first); Delete trashes selection; / focuses search; arrows in the viewer. All buttons have accessible names; dialogs are focus-trapped; toasts are aria-live="polite" (errors assertive).
- npm run typecheck, npm test, npm run build pass; initial JS <= 40 KB gzip; fflate appears only in a lazy chunk (verify by listing dist/assets and the budget script output).
-  Desktop Chrome and Safari: select one screenshot -> Copy -> paste into a chat input works. Select 3 -> Copy queue works in "One by one" mode, image 2 and 3 copy on "Copy next" and paste correctly. JPEG source pastes as an image (PNG conversion works).
-  "One image" mode: selecting 8 screenshots produces 2 sheets (6 + 2), each pastes as one image in chronological order; switching modes mid-queue works; the mode survives a reload.
-  Phone viewport (390 px, touch emulation): the Select button starts selection; the bottom toolbar shows Copy and Delete within thumb reach and clears the home indicator; the + button is hidden while selecting; Copy and Delete both work from the toolbar.
-  Delete -> Undo restores; Trash view restores and deletes forever; Empty Trash works with confirmation.
-  Multi-download produces a valid ZIP (open it) with correct names; single download keeps the real file name.
-  Shift-click range, Ctrl/Cmd-click, long-press (touch emulation) selection behave; filter change clears selection.
-  Settings changes persist (reload) and the "Sign out everywhere" button invalidates a second logged-in browser (within the 30 s cache window noted in Part 2).
-  A rolled-back failure path is demonstrated (e.g. stop the API and delete -> item returns with an error toast).
-  A mocked 429 DAILY_LIMIT during Empty Trash shows the specified toast and stops cleanly.
-  Spec saved at docs/spec/part-6.md.
STOP after this part. Do not start Part 7. Report using the format in Part 1, section 0, rule 6.