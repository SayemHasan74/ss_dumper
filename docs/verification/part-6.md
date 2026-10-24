# Part 6 verification

Verified on Windows on 2026-10-24 using production assets, isolated local Wrangler D1/KV stores, generated QA credentials, bundled Playwright and installed Edge Chromium. No deployment, paid service, remote seeding or external message/share delivery occurred. The project's `.dev.vars` was compared before/after and stayed unchanged. QA credentials were deleted and local QA servers stopped.

## Acceptance checklist

| Spec item | Result and evidence |
| --- | --- |
| Typecheck/tests/build/budget | PASS: strict frontend/Worker typechecks, 83 tests in 16 files, production build and gzip budget checks |
| Single copy and JPEG conversion | PASS in Chromium: real ClipboardItem write/read returns PNG for a JPEG original; native Ctrl+V delivers it to a local chat-like contenteditable target |
| Three-image copy queue | PASS in Chromium: entry one copied immediately; Copy next writes entries two and three through the real clipboard; queue completes |
| Combined images | PASS: eight screenshots produce two PNG sheets, 6+2 images; measured 600×552 and 600×200; pixel comparison verifies oldest screenshot is first despite reversed selection |
| Mode switch/persistence | PASS: switching from One by one to One image rebuilds/copies immediately; saved sheet mode survives reload |
| Phone selection/actions | PASS at 390×844 with touch emulation: Select starts mode, FAB disappears, bottom toolbar sits within the viewport, Copy/Delete/Undo work; long-press selects |
| Delete/Undo/Trash | PASS: optimistic delete, six-second Undo restore, lazy Trash restore/permanent deletion, custom confirmation cancellation with Escape and successful confirmation |
| Download | PASS: single download suggests the real name; multi-download ZIP was saved and opened with unzipSync, containing distinct `series.png` and `series (2).png` entries |
| Selection gestures/filter changes | PASS: Ctrl-click and Shift-range select; touch long-press; changing type filter clears mode/selection |
| Settings/security | PASS: auto-delete and Trash-retention changes persist after reload; Sign out everywhere invalidates a second local browser context immediately |
| Rollback | PASS: simulated 503 on delete returns the item and retains selection with an error toast; successful retry and Undo work |
| Empty Trash DAILY_LIMIT | PASS: mocked 429 DAILY_LIMIT produces the specified message and stops after one call; unmocked Empty Trash completes |
| Spec saved | PASS: `docs/spec/part-6.md` matches the supplied attachment verbatim |
| Desktop Chrome/Safari/device coverage | PARTIAL: installed Edge Chromium and touch emulation tested; separate Chrome, Safari and a physical iPhone were not available. No Safari or actual external chat-app test is claimed |

## Additional checks

- Matching selection is bounded at 2,000 IDs and reports the cap. Controlled metadata responses exercised ten sequential 200-ID pin requests, with maximum one request in flight. A 250-file purge used 100/100/50 sequential chunks.
- Real backend/API operations verified pin badges, normalized tag addition/removal, name extension correction, note editing and dialog focus trapping. Deep-linked viewer edits and pinning remain visible without adding previous/next navigation for unloaded files.
- Share is feature-gated using fetched, named File objects and correct MIME types. A transport stub verified those objects reach navigator.share without sending to another app. Actual share-sheet delivery/cancellation still needs a real device check.
- The expanded upload tray, Copy Queue and toast were shown together at phone size: their bounding rectangles do not overlap each other or the bottom toolbar. The activity stack remains within a short landscape viewport and scrolls if necessary.
- Production CSP and page-error instrumentation reported no violations/exceptions during both normal and fault paths. Inline script/style elements were not introduced; dimensions/positions use permitted CSSOM properties.
- Runtime dependency audit (`npm audit --omit=dev --json`) reported zero runtime vulnerabilities. Only the allowed exact `fflate` dependency was added; no Worker/API changes or new external services were needed.

## Bundle and unit evidence

| Measurement | Result |
| --- | --- |
| Initial JavaScript gzip, including shared modulepreload | 31,489 / 40,960 bytes |
| CSS gzip | 7,423 / 10,240 bytes |
| Lazy fflate chunk | `browser-D4EssyxD.js`, 5.08 kB raw; referenced through dynamic import, absent from initial HTML imports |
| Other lazy chunks | Viewer, Trash and Settings |
| Planner tests | Six pure tests: one image, 6+1 split, tall-image scaling, area split, width clamp/default, chronological ordering |
| Existing backend/security tests | All previous 77 tests continue to pass |

The initial HTML imports the entry module and its shared Dialog module; both are included in the JS budget above. fflate's store-only ZIP code is loaded on multi-download, following its [streaming ZIP documentation](https://github.com/101arrowz/fflate#usage). Clipboard construction passes a PNG promise directly to ClipboardItem inside the gesture handler, as supported by the [ClipboardItem API](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem/ClipboardItem).

## Failure and ownership review

Copy preparation caches at most two entries. Use/skip, mode switch and close evict cache entries; close/auth-out abort original requests, and cancelled conversions cannot publish a prepared result. Each sheet draws and closes one bitmap at a time, frees its canvas after encoding and stays below the specified area/height limits. ZIP object URLs are revoked after triggering download. The existing upload/viewer preview cleanup remains in effect.

Bulk mutations apply optimistic changes, preserve completed chunks and roll back failed/unsubmitted loaded rows. Non-destructive failures retain selection. DAILY_LIMIT during purge does not restore D1 rows already removed; later chunks stop. Empty Trash reloads any remaining D1 rows after quota exhaustion. Authentication generations prevent late bulk/edit/settings responses from repopulating signed-out state. Undo does not wait for the delete's follow-up list read before accepting restore.

No functional scope beyond Part 6 was implemented. The approved Part 3 quota amendment remains authoritative. Part 7 has not started. Safari/iPhone and another app's own paste/share behavior remain external verification limits, not passing checks.
