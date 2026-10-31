# Upload dock and effective photo dates

Implemented and checked on 31 October 2026 against [the accepted request](../spec/dock-photo-order.md). The earlier recovery audit describes the previous launcher; this release replaces that launcher without rebuilding the queue.

## What changed

- Removed `UploadTray.tsx`, its Gallery mount and obsolete tray styles.
- Added a right-edge dock. New pending jobs open it automatically. It overlays the gallery, is at most 360px wide, avoids the add-files button and hides during the viewer/full Uploads screen.
- Expanded controls include summary, Pause all, Resume and virtualized pending rows with small thumbnails/placeholders, filenames, real transfer progress, status, retention, errors and existing per-file controls. Storage remedies and oversized-selection review link to Details.
- Collapse/expand stays on the current route and never changes upload intent or retained bytes. The vertical Uploads tab shows pending count and has its own directly available Pause/Resume button.
- Restored work remains stopped until Resume. Completed originals are reconciled instead of retransmitted. Transfers restart from byte zero when required; this is not byte-offset resume.
- Reused the existing Uploads rows/actions through `UploadRows.tsx`. Full history, local storage settings, privacy choices, review and sign-out behavior remain on Uploads. The list is virtualized; the dock never creates original-file preview URLs.
- Dock styles use the existing dark/cream tokens, safe-area and keyboard inset values, and 44px controls. Escape collapses; focusing gallery controls collapses the overlay to avoid hiding keyboard focus. Copy Queue gets its own space. Collapse itself does not focus or navigate into Uploads.

## Photo-date contract

Images use `photoDate: { at, source, timezoneAssumed }`, separate from `createdAt` and `expiresAt`.

1. Valid EXIF DateTimeOriginal, respecting OffsetTimeOriginal and optional subseconds.
2. Original browser File.lastModified, explicitly labelled modification time.
3. Existing server upload time, explicitly labelled upload time.

Without an EXIF offset, the uploader resolves local time once and saves its epoch plus `timezoneAssumed: true`. Another browser never reinterprets it. Dates outside 1800 through 24 hours ahead, impossible calendar values and malformed offsets fall back safely.

Metadata reads support JPEG APP1 EXIF, PNG eXIf and WebP EXIF, with at most 256 KiB read total and 64 segments/chunks. Unsupported metadata uses the fallback. There is no heavy library or full-image decode solely for a date. The existing preparation semaphore bounds work. The chosen candidate is checkpointed in the durable job before sending the original. For the upload fallback, intake time is provisional locally until the authoritative upload timestamp is returned; the accepted DTO is then adopted into the job. Existing hash reconciliation still runs first.

`POST /api/upload` accepts optional `X-Photo-Date` (integer epoch milliseconds), `X-Photo-Date-Source` (`capture`, `modified`, or `upload`) and `X-Photo-Timezone-Assumed` (`0`/`1`). The server validates these before writing bytes. Only sniffed images receive photo metadata. An explicit upload source uses actual server upload time rather than trusting a client upload timestamp. Missing headers remain compatible with existing Shortcuts.

The new UI requests `GET /api/files?sort=photo` for All/Images. D1 orders by `COALESCE(photo_date, created_at) DESC, id DESC`, backed by `idx_files_photo_active`. Its next cursor is `p1.<epoch-ms>.<ULID>`. Pagination, accepted-upload insertion, refresh merging and viewer navigation use this ordering. Refresh rereads the already loaded span in metadata pages, allowing an older insertion below page one to be discovered without downloading originals. All mixes image dates with upload times for nonphotos. Dedicated PDFs/Files/Trash and API requests without sort=photo keep their prior ID ordering. Copy-sheet chronological ordering is unchanged.

Migration `0003_photo_dates.sql` adds three columns and an index. It does not rewrite upload timestamps, clear IndexedDB, change IDs or download existing originals. Existing saved files initially use upload time; capture dates never previously saved cannot be recovered without reading their files. Existing jobs acquire metadata only if they still need an original upload. Duplicate uploads retain the existing server file's date.

## Verification performed

- `npm run typecheck`: passed.
- `npm test`: 126 tests across 27 files passed, including the security boundary checks.
- `npm run build`: passed. Initial gzip JS **34,948 / 40,960 bytes**, CSS **8,872 / 10,240 bytes**. No runtime dependency or paid resource added.
- Native Chromium/Edge with real IndexedDB, isolated local Worker/D1/KV and synthetic fixtures:
  - 375×844 touch viewport: automatic opening, Pause/Resume from expanded and collapsed dock, no route changes, collapse/expand during a held original without changing transfer intent.
  - Dock bounds stay within the phone viewport and above the add-files button.
  - Pause persisted through reload and reauthentication; no request restarted before explicit Resume.
  - Lost original response reconciled with exactly one original request. Lost thumbnail response plus reload rewrote neither the original nor accepted thumbnail.
  - Ten shuffled dates and different image sizes produced the expected order, including a capture without a timezone. Reload and a fresh browser context in America/Los_Angeles kept the same order.
  - An older durable job without photoDate resumed using its saved modification time and preserved retained bytes.
  - Both existing 137-file review cases passed: selective 100 then remaining 37; explicit Queue all in 100/37 groups. No selections dropped.
  - Existing local API/Shortcut/security smoke suite passed.
- Unit checks exercise malformed/future/missing metadata, explicit/assumed offsets, bounded reads, timestamp/cursor validation, migrated legacy rows, 74-row composite pagination, stable ties, real SQLite index use, upload-time date filters and expiration.
- Frontend store check covers accepted old-photo insertion, pagination, another-device insertion below page one, removal on refresh and preserved nonphoto query behavior.

No physical iPhone/Safari, iOS process termination, OS-level storage eviction or real mobile network test was performed. Touch emulation and intercepted network failures are the verified scope. Local recovery remains specific to this browser/device and retained website data.

## Release

The pre-change local checkpoint is `checkpoint/before-dock-photo-order-2026-10-31` at `be8320c`. Deployment and live verification are recorded below after release.
