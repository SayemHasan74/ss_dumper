The rules in Part 1 section 0 and the earlier parts apply. FIRST ACTION: save this entire message verbatim to docs/spec/part-5.md, then re-read docs/spec/part-1.md through part-4.md. This part makes uploading feel instant and reliable, especially on iPhone Safari and the installed Home Screen app. The phone flow is the most important flow of the whole product: open the app, tap +, pick screenshots, done. Backend contracts are in Part 3 section 9.
- Entry points: (a) a floating "+" button, (b) drag and drop anywhere on the window (desktop), (c) paste (Ctrl/Cmd+V) of images (desktop), (d) the iOS Shortcut (Part 7, no UI here).
- Max 100 files per selection (more -> toast "Select up to 100 files at once." and nothing is queued). Max 25 MiB per file. Allowed by type or extension: PNG, JPEG, WebP, GIF, PDF. HEIC/HEIF is not accepted (iOS converts to JPEG automatically for this accept list).
- Concurrency: 3 simultaneous uploads (2 when navigator.connection.effectiveType is 2g/slow-2g or saveData is true), 2 simultaneous hash/thumbnail jobs.
- Thumbnails are generated on the uploading device: longest side 480 px, JPEG quality 0.82, transparent pixels flattened onto white. PDFs get no thumbnail.
- Uploads use XMLHttpRequest (for real upload progress), not fetch.
- Every uploaded image costs 2 storage writes on the free plan (original + thumbnail) out of 1,000 per day. Do not add any extra uploads, re-uploads, or "touch" requests beyond what this part specifies.
```
web/src/upload/queue.ts         state machine, concurrency, retry, pause/resume
web/src/upload/hash.ts          sha256Hex(blob)
web/src/upload/thumb.ts         createThumbnail(blob) -> { blob, width, height } | null
web/src/upload/names.ts         naming rules
web/src/upload/backfill.ts      thumbnail backfill job
web/src/upload/xhr.ts           promise wrapper with progress + abort
web/src/components/Fab.tsx
web/src/components/UploadTray.tsx
web/src/components/DropOverlay.tsx
web/src/store/files.ts          MODIFY: local (optimistic) items, preview URLs
web/src/components/Cell.tsx     MODIFY: render local items and progress
web/src/views/Gallery.tsx       MODIFY: mount Fab, tray, drop overlay, paste handler
```
- A round 56 px accent button, fixed bottom-right: right: calc(16px + env(safe-area-inset-right)), bottom: calc(16px + env(safe-area-inset-bottom)), plus icon, aria-label="Add files", visible on every screen size and above the grid (z-index below the viewer).
- Implementation: the button is a <label> bound to a visually hidden <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf">. Do NOT call input.click() from JavaScript (iOS gesture rules); the label opens the picker natively. Hide the input with position:absolute; width:1px; height:1px; opacity:0 (never display:none).
- On change: take input.files, copy to an array, reset input.value = '' (so choosing the same files again works), hand the array to the queue.
- iOS shows its own Photo Library / Take Photo / Choose Files sheet once; after that it is the normal gallery with multi-select. This is the expected behaviour (document in README).
For each file in the order picked:
1. Validate: size <= 25 MiB and type/extension allowed (if file.type is empty, infer from the extension). Invalid -> item failed immediately with a reason ("Too large (max 25 MB)", "Unsupported type").
2. Names (names.ts): if the name is empty or matches ^image\.(png|jpe?g|webp|gif)$ (iOS gives photo-picker files generic names) -> screenshot-YYYYMMDD-HHmmss-NN.<ext> using file.lastModified (fallback: now) in the device's local time; NN = zero-padded index within the batch. Pasted images -> pasted-YYYYMMDD-HHmmss-NN.png. Otherwise keep the name.
3. Optimistic item: immediately insert a local item at the top of the grid (status queued) so the user sees something in under 100 ms. Local items live in a separate signal array prepended to items at render time; they carry a localId, status, progress 0..1, and a preview URL.
4. Hash: crypto.subtle.digest('SHA-256', await file.arrayBuffer()) -> lowercase hex. Skip duplicates inside the same batch (same hash): mark the later one duplicate.
5. Duplicate preflight: after hashing, send all hashes of the batch to POST /api/upload/check in chunks of 50. Files that already exist are marked duplicate (not uploaded) and counted in the summary ("3 already in Dump"). The server's own check in /api/upload remains the final authority.
6. Thumbnail (images only), done right before that file's upload starts and in parallel with other files' uploads: decode with createImageBitmap(file); if unavailable or it throws, fall back to an <img> created from an object URL (revoke it afterwards) and drawImage. Scale so the longest side is <= 480 (never upscale), draw on a canvas filled white, export with canvas.toBlob('image/jpeg', 0.82) (use OffscreenCanvas.convertToBlob when available). Also record the ORIGINAL pixel width/height. On any failure: no thumbnail, upload anyway (backfill retries later). The thumbnail blob also becomes the local item's preview (URL.createObjectURL).
7. Upload original: POST /api/upload with the File as the raw body; headers X-Dump-Client: 1, X-File-Name: encodeURIComponent(name), X-Content-Sha256, X-Width, X-Height (when known), Content-Type: file.type || application/octet-stream. Progress comes from xhr.upload.onprogress. (The browser sets Content-Length automatically for a File body; the server requires it.)
8. Upload thumbnail: on success (not duplicate) POST /api/thumb?id=<id> with the JPEG blob (same headers except name/sha). A thumbnail failure is NOT an upload failure; leave thumbSize = 0 and let the backfill handle it.
9. Finish: replace the local item with the returned FileDTO (inserted at the correct position, which is the top), keep the preview URL as the thumbnail source for this session (previewById[id]) so the grid never flickers (this also hides any short storage propagation delay right after upload), and bump pendingNew handling so the item does not trigger the "N new" pill.
- Retry only for network errors, timeouts, and HTTP 408/429/5xx: up to 3 retries with delays 1 s, 3 s, 8 s plus random jitter of up to 500 ms. Respect Retry-After for 429. Never retry other 4xx. EXCEPTION: a 429 whose error code is DAILY_LIMIT is never retried (see the mapping below).
- Per-request timeout: 30 s + size / (20 KB/s).
- Offline: when navigator.onLine is false (or an XHR fails with a network error while onLine is false), pause the whole queue; items show "Waiting for connection"; resume on the online event.
- HTTP 401 mid-queue: pause everything, let the Part 2 flow show the login form, and resume the SAME queue (File objects are still in memory) when authState becomes in again. Do not drop items.
- Error mapping to messages: STORAGE_FULL -> stop the whole queue with "Storage is nearly full. Empty the Trash or delete files."; DAILY_LIMIT -> stop the whole queue (items stay in the tray as failed, each with Retry) with "Daily upload limit reached. Try again after 06:00 Dhaka time."; PAYLOAD_TOO_LARGE -> "Too large (max 25 MB)"; UNSUPPORTED_TYPE -> "Unsupported file type"; CHECKSUM_MISMATCH -> automatic retry (counts as one retry); SIZE_MISMATCH -> automatic retry (counts as one retry); anything else -> "Upload failed".
- Failed items stay in the tray with a Retry button each and a "Retry all failed" button; "Clear" removes finished/failed items.
- The user can cancel an item (aborts its XHR) or "Cancel all".
- Appears above the + button while the queue is non-empty. Collapsed: one line "Uploading 3 of 10 · 62%" with an overall byte-weighted progress bar. Tap to expand into a list: tiny preview, name, per-file progress/status, Retry/Cancel.
- Completion: "10 added" (or "7 added · 3 already in Dump") auto-dismisses after 3 s; if anything failed it stays until dismissed and says "7 added · 3 failed".
- aria-live="polite" for status changes. Respect safe-area insets.
- DropOverlay: on dragenter with dataTransfer.types including Files, show a full-window overlay "Drop to upload to Dump"; hide on dragleave (counter-based to avoid flicker) and drop. Prevent the browser from navigating to a dropped file. Ignore non-file drags. Files only (no folder traversal).
- Paste: a paste listener on document; if the target is not an input/textarea/contenteditable and clipboardData.files contains images, queue them (named as pasted-...).
- While anything is uploading: warn on tab close (beforeunload), and request a screen wake lock (navigator.wakeLock.request('screen'), feature-detected, released when the queue empties or on visibilitychange hidden; re-acquire when visible again and still busy) so the phone does not lock mid-upload.
- When the page returns to the foreground (visibilitychange visible) and items are in uploading state whose XHR died, treat them as network failures and let the retry logic run.
- Object URLs created for previews are revoked when the item is removed, on sign-out, and never leak across sessions.
Files uploaded by the iOS Shortcut have thumbSize === 0. A background job fixes them from any logged-in browser:
- After the first page renders and the queue is idle, find loaded items that are images with thumbSize === 0, not already attempted this session (max 2 attempts per id).
- Process ONE at a time: GET /api/files/<id>/original as a blob (skip if size > 15 MB), create the thumbnail exactly as in section 4 step 6, POST /api/thumb?id=<id> with X-Width/X-Height, then update that item in the store (thumbSize from the response) so the grid swaps the placeholder for the image.
- Pause while uploads are active, while document.hidden, or while offline; resume afterwards. Use requestIdleCallback (fallback setTimeout) between items. Never block scrolling or input.
- Stop the whole job for the rest of the session on a DAILY_LIMIT response.
- Picking 10 screenshots (~1.5 MB each) shows all 10 optimistic cells within 300 ms, and the main thread is never blocked for more than ~50 ms at a time (hash/thumbnail work is chunked/async).
- Initial JS budget still <= 40 KB gzip (queue, hash, thumb, backfill are small; if the budget is exceeded, lazy-load thumb.ts and backfill.ts).
- Extend scripts/smoke.mjs: upload with the headers exactly as the browser sends them (name percent-encoded, sha, width/height), duplicate-in-batch behaviour, and confirm X-Width/X-Height are stored.
- npm run typecheck, npm test, npm run build pass; budget passes.
-  Desktop Chrome: + button, drag and drop, and Ctrl+V upload work; duplicates are skipped and reported; progress and tray behave as specified.
-  iPhone Safari (real device or the closest available emulator; if neither is available state this explicitly in the report): the + button opens the native picker, multi-select upload works, names are screenshot-…, thumbnails appear.
-  Throttle to offline mid-upload: queue pauses, resumes on reconnect, no duplicates created.
-  Force a 401 mid-queue (clear the cookie): login appears, queue resumes after login.
-  Backfill: upload a file via curl with the upload token (no thumbnail), open the gallery, the thumbnail appears by itself within a few seconds.
-  No memory leaks: preview object URLs are revoked (verify in the Memory panel or by reasoning in the report).
- DAILY_LIMIT handling demonstrated with a mocked 429 DAILY_LIMIT response: the queue stops, shows the message, items offer Retry.
-  Spec saved at docs/spec/part-5.md.
STOP after this part. Do not start Part 6. Report using the format in Part 1, section 0, rule 6.