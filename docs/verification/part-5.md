# Part 5 verification

Verified locally on Windows on 2026-10-24, using production assets and isolated Wrangler local D1/KV with temporary credentials. No remote deployment, paid product, live upload quota or new dependency was used. The existing project secrets were compared before/after and remained unchanged; temporary QA secrets were removed.

## Acceptance

| Check | Result |
| --- | --- |
| Spec saved | PASS: `docs/spec/part-5.md`, verbatim attachment |
| Typecheck, tests, build | PASS: strict frontend/Worker typecheck, 77 tests / 15 files, production build with budget enforcement |
| Picker and mobile-sized upload | PASS in touch-emulated Edge Chromium: native label opens the file chooser, multiple files upload, generic names become screenshot names, thumbnails appear |
| Desktop entry points | PASS: native input, nested file-drag events/overlay and image clipboard-paste event; pasted name verified through API |
| Duplicates | PASS: same-batch and existing-file duplicates reported with no original or thumbnail upload requests |
| Limits | PASS: 101-file selection queues nothing and shows the specified toast; HEIC and oversized files fail with reasons |
| Progress/concurrency | PASS: XHR progress-backed tray, original and thumbnail completion; maximum three upload chains, reduced to two with slow/save-data connection emulation; at most two hash/bitmap preparations |
| Offline | PASS: queued offline work waits; an active XHR interrupted under throttling resumes after reconnect and creates exactly one file |
| Authentication loss | PASS: forced 401 shows login, all tracked preview URLs are revoked, re-login resumes the same in-memory File and creates exactly one file |
| Daily quota | PASS: mocked 429 DAILY_LIMIT stops current/pending work without automatic retries; all four items offer Retry, and Retry all succeeds after removing the mock |
| Retry/cancel | PASS: simulated 500 retries after at least one second; ordinary 429 respects a two-second Retry-After; Cancel all aborts work and removes optimistic cells |
| Backfill | PASS: upload-token original with no thumbnail gains one automatically from the logged-in gallery |
| Image fallback/thumbnail failure | PASS: disabled ImageBitmap/OffscreenCanvas paths use img/HTML canvas successfully; a rejected thumbnail leaves the original added, then backfill repairs it without re-uploading the original |
| Wake lock | PASS with feature stub: requested while busy and released when idle; lifecycle also gates release/reacquisition on visibility/auth in code |
| Memory | PASS: instrumented object URL set is empty after auth-out; ownership review below |
| CSP/layout | PASS: no production CSP violations or browser exceptions; 390 px portrait and 844×390 landscape have no page overflow; expanded quota tray and controls stay within viewport bounds |
| Browser-shaped API smoke | PASS: ten existing smoke steps, extended with cookie-authenticated raw upload headers, percent-encoded Unicode name, SHA/dimensions and duplicate preflight checks |
| Viewer correction | PASS: actual-size overlay now allows pan/pinch (Chromium serializes this as `manipulation`); fit overlay retains gesture suppression |

Desktop tests used installed Edge Chromium through bundled Playwright. Clipboard/drop tests dispatched standard browser events; the operating-system clipboard was not overwritten. There is no physical iPhone, Safari or iOS simulator available. Touch emulation checks the closest available browser flow; native iOS sheet wording, conversion, background suspension and physical pinch gestures are not claimed as device-tested.

## Performance and bundle

Ten distinct real on-disk PNG files, each approximately 1.54 MB (800×640), were selected through the native chooser. All ten local cells appeared in 4.4 ms after change in the final run; the target is 300 ms. No tasks over 50 ms were recorded after selection by the Long Tasks observer in this local run. Native file paths were used to avoid timing the automation harness's large base64-to-File conversion. These local numbers are not guarantees for every phone.

- Initial JavaScript gzip: 22,613 bytes / 40,960 allowed.
- CSS gzip: 6,458 bytes / 10,240 allowed.
- Viewer remains a separate dynamic chunk; thumbnail/backfill code fits within the initial budget without extra lazy-loading or dependencies.

## Ownership and bounded work review

Local previews are owned by queue jobs until completion. Replacing one with a thumbnail, cancelling, clearing or signing out revokes it. On success, ownership transfers to `previewById` for session-long thumbnail display; replacing that entry or signing out revokes it. Clearing a successful tray entry intentionally retains this completed-file preview until sign-out. Canvas fallback URLs and ImageBitmaps are released in `finally`; viewer blobs retain their existing close/navigation cleanup. Queue File references are removed by Clear or automatic successful completion dismissal.

Retry paths are bounded to three retries, except DAILY_LIMIT/STORAGE_FULL, authentication pauses, cancellation and non-retryable 4xx. XHR timeout scales with body size. Foreground recovery checks live XHR state; online/auth changes resume waiting work. Backfill runs one request chain at a time, yields through idle callbacks/timeouts, aborts on upload activity/hidden/offline/auth-out, skips originals over 15 MiB, and stops for the session after DAILY_LIMIT. It never re-uploads an accepted original.

Part 6 has not been started. The previously documented Part 4 shell-ready versus full-navigation timing caveat remains.
