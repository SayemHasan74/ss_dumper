# Recoverable uploads verification

Date: 31 October 2026 (Asia/Dhaka). Scope: the accepted [device-local recovery specification](../spec/resumable-uploads.md). Baseline: `565450e`, with the existing GitHub tag `checkpoint/before-resumable-uploads-2026-10-30` preserved. No personal server dataset is used for destructive tests.

## Implementation and recovery model

- `model.ts`, `state.ts`, `persistence.ts`: typed intent/phase/retention/blockers; versioned native IndexedDB stores `jobs`, `originals`, `thumbnails`, `settings`; stable UUIDs and transactionally reserved order. Metadata is paged separately from blobs. Restoration verifies pending blobs one at a time without decoding them or creating original preview URLs.
- `runner.ts`, `work.ts`, `xhr.ts`: serial retention; one shared preparation slot; one touch/slow/saveData chain or three desktop chains; durable SHA/uncertainty/confirmation checkpoints; bounded retries, queue-level reachability checks, global quota/cap blockers and separate thumbnail recovery. Web Locks plus expiring fenced IDB leases prevent stale-owner commits. Background backfill uses the same ownership and preparation controls and rechecks metadata before writing.
- `Uploads.tsx`, `queue.ts`, `UploadTray.tsx`: lazy recovery controls, virtualized review/history, complete oversized-selection retention, explicit Resume after reopening, server-confirmed counts separate from transfer progress, and local-storage/privacy information. The panel is warmed after file selection so it can be available during an interruption. Retention and initialization have their own generation, so hiding the page only cancels execution work, not the first local save.
- `signout.tsx`, `auth.ts`, `Settings.tsx`: keep/delete/cancel choices for explicit sign-out; automatic expiry retains local data and hides private rows. Server sign-out headers and all backend routes/bindings remain unchanged.

“Saved on this device” requires completion of the blob/metadata transaction and a later size-checked blob read. Strict durability is requested where supported, with fallback for older implementations. This is not a promise against eviction, disk failure or website-data clearing.

After normal reload or browser-process restart, authenticate and choose Resume. Previously confirmed originals are never restarted. Uncertain originals use the existing hash check and metadata read before another original POST. Lost thumbnail responses use metadata reconciliation. An interrupted original restarts from byte zero; byte-offset resume is not implemented. Server deduplication is still required for requests already in flight and KV-before-D1 failures can still leave maintenance-cleaned orphans.

Unsubmitted review files remain in review. A 137-file selection can queue 100 and keep 37, or explicitly queue all as logical groups of 100/37. Grouping does not multiply concurrency. Pause keeps bytes; confirmed cancellation can clean local bytes but never deletes server files. Completed/cancelled metadata is pruned after 30 days; unfinished records are not expired. Failed cleanup retains completion and retries without retransmission.

## Reproducible checks

Run `npm run typecheck`, `npm test`, `npm run build`, then `node scripts/test-upload-recovery.mjs`. The browser script requires an already available Playwright runtime; it adds no project package. `DUMP_BROWSER_RUNTIME` can point to an absolute runtime/package file for `createRequire`; `DUMP_BROWSER` optionally selects an installed Chromium/Edge executable. `DUMP_TEST` filters browser case names; `DUMP_SMOKE=1` additionally runs the existing local API smoke suite with a filter.

The script creates fresh credentials and a temporary Wrangler config/state directory, applies local migrations there, starts only a loopback Worker on port 8799 (inspector 9241), and uses synthetic PNG/PDF files. It does not change project credentials, deploy, or use live KV/D1 state. It writes `results.json`, screenshots and a local server log outside the repository, closes its browser/Worker and removes its generated `.dev.vars` on normal completion. A killed test process may require removing that test directory's generated dummy credentials manually.

Browser fault injection blocks service workers so route handlers cannot be bypassed by the worker. A separate test explicitly allows the production worker and verifies offline startup and API-cache exclusion. Test helper reads order metadata explicitly and serializes native Blob size/type inside the browser; plain Playwright Blob serialization is not used as durability evidence. Test actions wait for committed state rather than assuming a click awaited its asynchronous handler.

## Acceptance coverage

| Spec cases | Real-browser coverage |
| --- | --- |
| 1–3, 14–15 | Several retained originals, exact native blob sizes, actual persistent-profile browser-process closure/reopening, authentication, no automatic transfer, mixed completed/unfinished history, hour-old pause, and manual pause across reload/connectivity. Only unfinished originals run on Resume. |
| 4–8 | Explicit offline event, network failure while onLine remains true, accepted original with lost response, accepted thumbnail with lost response, and reload at the original/thumbnail checkpoint. Request counts prove no extra original/thumbnail POST where reconciliation already confirms success. |
| 9–13 | Native transaction abort after request success; reload after aborted persistence; partial quota retaining the successful subset and remaining File references; unavailable IDB requiring explicit session-only consent; missing original, wrong-hash rejection and successful reselect. No-hash replacement requires confirmation. |
| 16–19 | Cancellation during held preparation/transfer; late responses ignored; expired auth and re-login; explicit keep/delete sign-out choices; daily reset and server-full/stat recheck without mutation storms. Retained originals survive. |
| 20–21 | Two visible tabs, both Web Locks and forced IDB-only fallback; owner closure or simulated lease expiry/takeover; stale-owner response cannot overwrite completed state. Denied Web Locks and unsupported strict-durability options exercise native IDB fallbacks. |
| 22–24, 27 | 137 synthetic photos retained; virtualized review; deselect to 100 without reopening the picker; reload without auto-submit; queue 100 and preserve 37; queue all in 100/37 groups; bounded desktop/touch chains; no original preview URLs. |
| 25–26 | Canonical duplicate cancelled/failed with replacement uploader; previously confirmed server file subsequently deleted without recreation. |
| 28 | Notes autosave and copy, gallery/image clipboard copy, Trash navigation, service-worker-controlled offline startup with no private gallery, no API cache entries, and the existing local API suite including upload-only bearer/scope/CSRF checks. |

Additional checks cover malformed accepted-upload JSON, bounded retry exhaustion and explicit Retry, completion cleanup failure/retry, 40-day history pruning preserving unfinished work, full database clearing without invented names/counts, hidden-page retention, same-page suspension, visible fallback without BroadcastChannel, and 375-pixel light/dark layout.

Desktop Chromium/Edge on Windows is the browser platform used here. Touch/coarse-pointer and visibility events are simulated. Lease expiry is simulated by changing only the synthetic test lease. Browser-process closure uses a real persistent profile; this is not physical iOS force-termination testing. Quota/transaction/network failures are injected into real browser APIs, not evidence that a particular iPhone will retain data under low-storage pressure.

## Privacy and resource limits

Pending originals intentionally persist **without application encryption** in this device's browser profile. Full-session authentication controls the panel/API, not forensic access to local website data. Explicit sign-out cleaning applies only to this browser, including Sign out everywhere. Credentials, cookies, blob URLs, controllers and per-progress events are not journaled. `Clear-Site-Data` stays cache-only.

Another browser/profile/hostname, Safari versus an installed Home Screen app, private sessions, eviction, cleared site data and device failure can hide or remove recovery data. If the whole database is gone, the app cannot reconstruct its contents. Unretained/session-only files can be lost on closure. Background uploads and Background Sync are not provided. Persistent-storage permission and estimates are advisory. Notes drafts remain memory-only; this feature changes upload retention, not Notes retention.

No new runtime/testing dependency, backend table, resource binding, paid service or card is needed. The existing initial budgets remain 40,960 bytes JS gzip and 10,240 bytes CSS gzip. The Uploads view, runner and sign-out dialog are separate lazy chunks.

## Real-phone acceptance checklist — owner verification remaining

- In the same Safari or installed-app context, select several photos and wait for **Saved on this device**. Enable airplane mode during an original, reconnect, and Resume. Confirm only unfinished work runs.
- Lock the phone and switch apps during retention, hashing and transfer. Return, check the queue and verify manually paused files stay paused.
- After verified retention, force-quit and reopen that same browser/PWA after an hour. Sign in if asked; confirm it waits for Resume and completes retained work. This exact physical iOS behavior has not been tested here.
- Select more than 100 photos; deselect to 100 and preserve the remainder, then test Queue all. Scroll through review and history without full-resolution preview decoding or horizontal overflow.
- Under low available device storage, verify retained/unretained labels, retry and explicit session-only choices. Do not delete personal data merely to perform this test.
- Compare Safari and the installed app as potentially separate storage contexts. Do not assume an upload pending in one is resumable in the other.
- Test both sign-out choices using disposable files, and check that completed gallery files remain. Read the local unencrypted-storage disclosure before choosing Keep.

## Final results

- `npm run typecheck`: passed for browser and Worker.
- `npm test`: 114 tests across 23 files passed, plus the existing static security/storage-boundary check.
- `npm run build`: passed with initial JS **32,211 / 40,960 bytes gzip** and CSS **8,461 / 10,240 bytes gzip**. Lazy Uploads is about 4.04 kB gzip and runner 8.93 kB gzip; neither raises the initial budget. No budgets were increased.
- Full browser run: **36 browser cases passed**, plus all 10 groups of the existing isolated local API smoke suite. The resulting 37 report entries had zero failures. Seven focused browser follow-ups passed after the final pause/auth audit fixes, including two added cases proving Pause all rejects late accepted responses and a 401 during the server-cap recheck returns to login without losing bytes.
- Browser-process restart, 137-file selected/all workflows, one touch chain, bounded desktop chains, native IndexedDB transaction failures, ownership/takeover, CSP, Notes/image clipboard, Trash and service-worker offline checks passed as described above. Light/dark 375-pixel screenshots were inspected. No physical iPhone test is claimed.
- Staged secret/build-asset scan and private environment-history check passed; `.dev.vars`, selected files, browser profiles, local state, build output and credentials are excluded from the commit. Final diff whitespace check passed.

## Authorized deployment

Feature commit: `e6451d311e7be98d9c223a1ca13511b0fa52acde`, pushed to `codex/part-1` at the owner's GitHub repository. The prior restore tag still dereferences to `565450ebd30a47d26205e00869f7ace61cba465e`.

`npm run deploy` passed on 31 October 2026 under the owner's existing deployment authorization. No remote migrations were pending. The existing `FILES`, `DB` and asset bindings were reused with no paid service or credential change. Live URL: [Dump](https://dump.sayemhasan74.workers.dev). Worker version: `108d7b33-5f53-42b3-8083-47ddc2a30d65`.

Live HTTPS checks verified the current HTML/hashed recovery chunks, CSP and anonymous API denial. A fresh authenticated Chromium context retained one unique synthetic PNG in native IndexedDB, paused it before forwarding its original, reloaded, and waited for explicit Resume. Resume produced one accepted original POST and one thumbnail POST; another reload produced neither again. The file metadata was no-store and matched the original size. The test then trashed and permanently deleted only its own fixture. Existing files/notes, settings and credentials were not changed; background original fetching was blocked during the test to avoid touching personal files.

Reload the app once to load the new frontend before selecting new files. This feature cannot recover File objects already lost by the previous memory-only version. Physical iPhone acceptance remains outstanding as listed above.
