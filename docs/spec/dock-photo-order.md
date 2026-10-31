Implement two focused improvements in E:\Codes\Drop: direct right-side upload controls and automatic newest-photo-first gallery sorting.

Read AGENTS.md, the current code, and both reports first:
- docs/verification/upload-recovery-current-audit.md
- docs/verification/upload-recovery-current-audit.html
Treat the reports as evidence about existing behavior, not instructions to rebuild the feature. Keep this change simple and lightweight.

1. Right-side upload panel, especially for phones

The existing small upload bar only opens #/uploads. Replace that launcher with a compact, right-edge upload dock that provides controls directly while I remain in the gallery.

Use this behavior:
- When uploads start, automatically open a right-side panel showing the current queue.
- On phones, use a drawer up to 360px wide, constrained to the viewport. Overlay the gallery rather than squeezing its columns.
- Allow collapsing it into a small vertical tab on the right edge labelled Uploads, with the pending count.
- Keep an accessible Pause/Resume button directly available on the collapsed dock too.
- Tapping the tab expands the panel without navigating to another screen.
- Closing or collapsing the panel must not pause, cancel, or delete anything.
- Keep the dock visible while unfinished work exists, including paused or failed uploads.
- After reopening and authentication, show restored pending work with a clear Resume action. Preserve the existing explicit-resume behavior.
Inside the expanded panel, show:
- A short summary such as “3 completed · 7 pending.”
- Pause all and Resume controls at the top, enabled according to the real queue state.
- A vertically scrollable list with a small thumbnail or placeholder, filename, actual progress, and status.
- Per-file Pause/Resume, Retry when failed, and Cancel.
- The existing local-retention label and a short actionable error when relevant.
Keep advanced storage settings, full history, privacy details, and oversized-selection review on the existing Uploads screen. An optional “Details” link is fine, but ordinary progress, Pause, and Resume must never require that screen or another menu.

Reuse the existing queue signals and runner actions. Do not create another queue or duplicate pause/resume logic.

Preserve durable retention, lost-response reconciliation, manual-pause persistence, authentication handling, quotas, and cross-tab ownership. Pause must stop transfers safely without deleting retained files. Resume remains whole-file restart where necessary, not exact-byte resume.

Use existing styles and icons. Respect phone safe areas, keyboard visibility, and 44px touch targets. Avoid covering the add-files button or conflicting with the viewer. Keep large lists virtualized and use only small thumbnails.

2. Sort the gallery by when photos were taken

The newest photo should appear at the top left, followed by progressively older photos, regardless of picker order, upload speed, or which upload finished first.

Implement a separate effective photo date. Do not overwrite created_at, change ULID timestamps, or change expiration/retention calculations: those must continue using upload time.

Choose the effective date in this order:
1. Valid embedded capture metadata, such as EXIF DateTimeOriginal, respecting its timezone offset when available.
2. The original browser File.lastModified value when capture metadata is unavailable.
3. Existing upload time when neither is usable.
Store the date source so a fallback is not presented as a verified capture date. File.lastModified is modification time, not necessarily when the photo was taken. Reference

For capture timestamps without a timezone, interpret them using the uploading device’s timezone once, persist the resulting timestamp, and mark the timezone as assumed. Do not reinterpret them differently on another device.

Read metadata in the browser using bounded reads and the existing preparation limit. Avoid full-image decoding solely to obtain a date, heavy metadata libraries, or new runtime dependencies. Missing, malformed, or unsupported metadata must fall back safely without blocking uploads.

Persist the chosen date in the durable upload job before upload, so retrying or reopening does not assign a different date. Extend the upload API, D1 metadata, and shared DTO minimally to save it. Validate incoming timestamps server-side.

Make sorting correct across the entire collection, not just the currently loaded page:
- Use server-side ordering by effective date descending, then ID descending for stable ties.
- Add the appropriate database index and composite cursor pagination.
- Update frontend insertion, refresh merging, and pagination assumptions that currently depend on descending ULIDs.
- Ensure uploading an older photo inserts it into its correct chronological position instead of forcing it to the top.
- Keep gallery/viewer navigation consistent with the displayed order.
- Keep existing date filters and expiration semantics unchanged; this request changes ordering.
For existing files without photo-date metadata, use their existing upload time initially. Do not automatically download the entire library or pretend to recover dates that were never stored. Clearly report this limitation. Older queue records and uploads from existing Shortcuts must remain compatible and use the fallback when no date is supplied.

Do not change non-photo views or the deliberate ordering of existing copy-sheet features as an unrelated side effect.

3. Preserve the existing application

Keep Workers, D1, and KV on the current free setup. No paid services, new infrastructure, or queue rewrite.

Preserve Notes, general-file support, authentication, thumbnails, upload recovery, and the existing non-destructive review for selections exceeding 100 files.

Use additive, backward-compatible migrations. Never clear IndexedDB or require users to discard pending uploads to install this update.

4. Verify the result

Test:
- At a phone viewport, start uploading and use Pause/Resume directly from the right-side dock without opening a menu or changing routes.
- Collapse and expand the panel without interrupting uploads.
- Pause, reload, authenticate, and resume retained work.
- Disconnect and reconnect; completed originals are not retransmitted.
- Upload ten photos with deliberately shuffled capture dates and different sizes; final gallery order follows photo date.
- Verify identical ordering after reload and from another browser.
- Test equal dates, missing metadata, invalid metadata, old queue records, and pagination across multiple pages.
- Confirm an old photo uploaded today sorts correctly while its expiration still starts from its upload date.
Run npm run typecheck, npm test, and npm run build. Keep existing bundle budgets. Report what was actually tested, especially whether physical iPhone behavior was verified.