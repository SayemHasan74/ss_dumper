# Upload recovery — detailed implementation and current-state audit

**Date:** 31 October 2026, Asia/Dhaka.
**Code inspected:** `5de8578c6d75100e5e59e0ffddfc091a49f79fac`.
**Purpose:** explain what was implemented, what changed, where the phone controls actually are, and how to verify recovery without assuming the reported phone problem is resolved.

## 1. First: the small bar on your phone

Your observation is consistent with the current compact bar: **it does not contain Pause or Resume buttons.** It is a button that opens a separate Uploads screen.

The bar reads approximately `Uploading · N pending · M originals confirmed`, with a right arrow. Its accessible name is **Open uploads**. Tapping the entire bar should navigate to `#/uploads`. The compact bar disappears on that route, and the full recovery panel supplies the controls.

There are three ways to reach that panel in the current app:

1. Tap the small upload bar itself.
2. On the phone, tap the top navigation/menu icon, then **Uploads**.
3. In the gallery, use **More options → Uploads**. On desktop, the sidebar also has Uploads.

The direct address is [the Uploads screen](https://dump.sayemhasan74.workers.dev/#/uploads). Use the **same browser/profile or installed-app context** that originally received the files. Opening the address in Safari does not prove access to a queue originally retained inside the installed Home Screen app.

**Finding:** this is a discoverability weakness in the shipped interface. The compact bar gives no visible Pause/Resume action and does not explicitly say “Tap to manage uploads.” A separate header shortcut is also hidden by CSS on smaller screens. The full panel exists; that does not establish that it opens correctly in your actual phone session.

**If tapping the bar or using the menu does not open the full panel, or the full panel lacks these controls, treat that as a real unresolved issue.** Do not interpret this report as a dismissal of your observation.

Do not clear website data, reinstall the app, or sign out with deletion as a troubleshooting shortcut while you need pending local files. First inspect whether they say **Saved on this device**. A reload can lose files that have not been retained yet.

## 2. What should be visible on the full Uploads screen

The heading should say `Uploads` or `Uploads · N pending`. Below the device-local explanation and any notices, these global controls are rendered on phones and desktops:

| Control | What the current code does | When it can be disabled or ineffective |
| --- | --- | --- |
| Resume eligible uploads | Rechecks authentication, server blockers and ownership; enables eligible submitted work. | Disabled when there are no pending jobs. It does not repair missing originals, unsupported/oversized files, or all exhausted failures. |
| Pause all | Disables scheduling, aborts active attempts, releases ownership and records paused intent for unfinished jobs. | Disabled when this page's queue is not enabled, including after a normal restoration before Resume. |
| Retry failed uploads | Resets retry state for jobs classified as exhausted request failures. | This specifically targets the `retry` blocker; missing bytes and local-storage failures need their own remedies. |
| Cancel pending uploads | Asks for confirmation, records cancellation and attempts local cleanup. | Disabled when no pending jobs exist. An already accepted server upload can still appear in the gallery. |

Below the buttons, the screen shows original confirmations and confirmed bytes, then **Queue and history**. Individual submitted rows expose Pause, Resume, Retry or recovery choices according to their state, plus Cancel where applicable.

Other panel sections include oversized-selection review when relevant, local storage, persistent-storage status, clear completed history, explicitly confirmed local removal, Trash/Settings links and a local-privacy explanation.

Important details:

- A row's checkbox does **not** limit Pause all, Resume eligible uploads, Retry failed uploads or Cancel pending uploads to that selection. Those are global actions. Use a row's own action for one file.
- Review checkboxes choose which files to submit. Queue/history checkboxes instead select local rows for **Remove selected local files**. These are separate selections.
- Row actions can require scrolling the queue list or the row on a small display. The queue list itself is scrollable and virtualized.
- On a restored queue, **disabled Pause all can be correct**: it is not running yet. Resume is the relevant action.
- The compact bar can remain after everything completes because history remains available. Its confirmation count is not a live total of cloud files.

## 3. Fresh checks performed for this report

This audit made **no application-code change and no deployment**. It used a disposable local Worker/database/storage dataset and a new Chromium context with touch input at **375 × 844**.

| Fresh audit check | Result |
| --- | --- |
| Gallery with a retained, interrupted upload shows the compact bar | Passed. |
| Compact gallery bar has no inline Pause all control | Confirmed; this is how the component is written. |
| Tapping Open uploads changes the route to `#/uploads` | Passed. |
| The compact bar hides on the full Uploads screen | Passed. |
| Resume eligible uploads, Pause all, Retry failed uploads and Cancel pending uploads are visible | Passed. |
| Pause all is physically inside the 375 × 844 viewport | Passed by bounding-box check. |
| Pause all persists `intent: pause` in native IndexedDB | Passed. |
| Reload preserves the paused job and its retained original without starting another request | Passed. |
| Explicit Resume completes the pending PDF after reload | Passed. |

One original attempt was deliberately held before forwarding it to the local Worker. After Pause/reload, Resume sent the whole file. The test counted two browser attempts, but only the resumed request was forwarded for server acceptance. This is **not** a byte-offset resume test.

The local test generated three screenshots: compact bar, full controls and restored paused queue. The readable HTML edition of this report embeds the first two. They contain only a synthetic PDF fixture, not your personal files.

Public live-asset verification also passed: the deployed entry JS, Uploads chunk, runner chunk and CSS matched the local built files byte-for-byte. The deployed Uploads code contains all four control labels. This was a public read-only check, not an inspection of your phone or its IndexedDB.

**Evidence boundary:** touch-sized Chromium on Windows is not physical iPhone Safari, an installed iOS PWA, or an actual OS force-kill. Your exact phone-side failure remains unconfirmed by this audit.

## 4. Before versus after the recovery update

| Area | Previous memory-only queue | Current implementation |
| --- | --- | --- |
| Pending originals | JavaScript File references in the current page | Blob records in native IndexedDB after verified retention; File references kept until then |
| Reload/closure | Unfinished File references could be lost | Retained jobs can restore in the same storage context, subject to remaining browser data |
| First durable save | None | Starts after the page receives the selection, before the default original upload |
| Recovery interface | Temporary tray | Persistent Uploads route with review, controls, storage and history |
| Selection above 100 | Could reject the returned selection | Retains the whole returned selection and opens review |
| Original versus thumbnail | Less durable stage knowledge | Independently checkpointed completion and uncertainty |
| Lost success response | Could lead to a repeated request without durable stage knowledge | Hash/metadata reconciliation before another original; metadata check before a thumbnail retry |
| Manual pause | No durable cross-reload intent | Persisted per-job intent |
| Local-storage failure | Not applicable to file retention | Explicit unretained state, retry, removal or opt-in session-only upload |
| Tab coordination | No durable shared runner ownership | Web Locks plus transactional expiring IDB lease and fencing |
| Phone preparation/concurrency | Earlier preparation/chain allowances were higher | One shared preparation task and one touch/slow/saveData upload chain |
| Sign-out privacy | Pending file bytes were memory-only | Explicit choice to keep or delete this browser's pending retained data |
| Completed history | Tray could disappear shortly afterward | Completed/cancelled rows retained until cleared or aged out |

## 5. What “resume” actually means

This feature is **device-local queue recovery with whole-file retries**.

It does not implement chunked uploads, multipart assembly, a server-side upload-session protocol, byte offsets, or Background Sync.

Example:

1. You select ten files and they become retained locally.
2. Four originals complete. A fifth loses its connection halfway through.
3. You close the app and reopen the same storage context later.
4. After authentication, the app restores local records and offers Resume.
5. The four durably confirmed originals are not uploaded again. Any unfinished thumbnail work can still run.
6. The uncertain fifth original is checked by hash. If an active server file is already recorded, its metadata is adopted. If the check succeeds and finds no active file, that file can restart from byte zero.
7. The remaining eligible files continue afterward.

There can be an overlapping request already running at the Worker when a browser aborts. Server deduplication remains the final guard. Neither exactly one network transfer nor exactly one KV write is guaranteed. A KV write followed by failure before D1 insertion can leave an orphan for existing maintenance to clean up.

A browser reporting online is not proof that the API is reachable. A failed lookup is not treated as proof that a file is absent.

## 6. Local retention: what is saved and when

Database name: **dump-uploads**. Current schema version: **1**.

| Store | Contents | Why it is separate |
| --- | --- | --- |
| jobs | Small per-file metadata and durable state | Read/paginate the journal without loading every original |
| originals | Original Blob values keyed by local UUID | Survive normal page closure when the browser retains website data |
| thumbnails | Optional small generated JPEG blobs | Finish thumbnail work without keeping a large original unnecessarily |
| settings | Queue blockers, ordering and ownership/lease records | Coordinate scheduling and tabs |

Retention sequence:

1. Keep the returned File reference in memory.
2. Create its local metadata/order.
3. Write the original Blob and corresponding metadata in a short transaction.
4. Wait for the **transaction's completion**, not merely one successful put request.
5. Read the Blob record back and verify its size.
6. Persist retained status; show **Saved on this device**.
7. Drop the unnecessary File reference from memory.

Strict transaction durability is requested where supported, with a fallback. Transactions do not span network calls, hashing, decoding or timers. Writes are serial, one retained original at a time.

This verifies existence and size. It is not a promise of cryptographic at-rest integrity, encryption, protection from website-data clearing, or protection against every device/storage failure.

For the default durable path, an original is not sent before retention. Session-only upload is an explicit exception chosen by the user.

For large selections, some files can be retained before later writes fail. The saved subset is kept. Unretained File references remain usable only while the current page still has them. Do not assume that every unprocessed filename or byte has reached durable storage merely because the picker returned it.

## 7. State that the queue records

The state is split so that user intent is not confused with a network phase.

| Category | Recorded values or meaning |
| --- | --- |
| Identity/order | Stable job UUID, group UUID, persisted order and revision |
| File metadata | Original/upload names, MIME, size, last-modified time and created/updated timestamps |
| Review | Submitted flag and persisted review selection |
| User intent | run, pause, cancel |
| Phase | pending, hashing, checking, preparing, original, thumbnail, completed, cancelled |
| Retention | saving, retained, unretained, missing, released |
| Blocker | restored, connection, auth, local, missing, retry, daily, server-full, unsupported, or none |
| Identity/reconciliation | SHA-256, original-confirmed flag, server FileDTO/ID, duplicate/canonical association |
| Thumbnail checkpoint | needed, stored, confirmed or none; dimensions and retained thumb size |
| Uncertainty | Original and thumbnail request outcomes tracked separately |
| Retry/cleanup | Attempt counter, next eligible time, error explanation and pending cleanup flag |

Controllers, XHR objects, decoded images, blob URLs, credentials and every individual progress event are not journaled. Queue/history checkbox selection in the current component is transient; the review's submission selection is persisted.

There is no unexpiring isUploading flag. Per-attempt epochs, revision comparisons and captured ownership generations reject stale callbacks after cancellation, sign-out or takeover.

## 8. Restore, connection loss and suspension

| Event | Intended/current behavior |
| --- | --- |
| Normal reload or new browser session | Check full authentication, read metadata in pages, verify relevant pending blobs serially, show restored work and wait for explicit Resume |
| Reopen while offline | Public offline shell can appear, but private queue UI waits for authentication; reconnect first |
| Same page becomes hidden | Stop scheduling new execution work, abort active requests as needed and release ownership; locally retaining selected files has a separate generation |
| Same page becomes visible again | Previously enabled, runnable work can continue after a session/reachability check; manually paused jobs remain paused |
| Explicit offline event | Stop scheduling, abort/settle active requests, retain local data and show Waiting for connection |
| Network failure while onLine is true | Enter the same connection recovery path instead of trusting the browser's online flag |
| Request stuck without progress | XHR has a 45-second inactivity watchdog, plus a size-based overall timeout; probes use an 8-second timeout |
| Browser process killed | Recovery depends on what already committed and what storage the browser still has; no final unload save is required for the first durable copy |

One queue-level reachability/authentication probe is shared. Repeated failure backs off around 5, 15, 30 and 60 seconds while visible runnable work exists. Online/focus can request an earlier throttled check. Request retries are bounded, using approximately 1/3/8-second delays with jitter and Retry-After.

After retry exhaustion the job stays available for explicit Retry; its retained original is not deliberately erased to reset the retry counter.

## 9. Original and thumbnail recovery are separate

The normal path is:

```text
selection -> local retention -> hash -> server duplicate check
          -> prepare optional JPEG -> persist original uncertainty -> POST original
          -> persist original confirmation/server ID
          -> reconcile/upload thumbnail if still needed
          -> persist completion -> clean unnecessary local blobs
```

The existing APIs are reused:

| API | Recovery use |
| --- | --- |
| POST /api/upload/check | Look up active server files for saved SHA-256 values; current runner checks one hash per chain, below the 50-hash request maximum |
| POST /api/upload | Whole original upload when needed |
| GET /api/files/:id | Adopt known metadata, check thumbnail status and handle missing/trashed confirmed files |
| POST /api/thumb?id=... | Upload only an unfinished image thumbnail |
| GET /api/auth/session | Reachability/full-session check |
| GET /api/stats | Explicit server-cap recheck |

If the original has durable confirmation but a thumbnail response is lost, metadata is checked before another thumbnail write. If the thumbnail is recorded, no rewrite is needed. A retained thumbnail can allow the large original to be released after original confirmation.

If thumbnail generation still needs the original, that original stays until thumbnail work completes or the user explicitly discards its local copy. Existing backfill can handle some deferred thumbnails later; it is independently bounded and is not a guarantee for every file.

A previously confirmed file later trashed/deleted is not automatically recreated by that job. Recovery may finish with **Previously uploaded; file no longer available**.

The bar's confirmed counts and bytes are sums over local jobs with confirmation. Duplicate jobs can refer to the same server file, so these numbers are not unique gallery counts or server storage usage. A transfer reaching 100% is also not acceptance by itself.

## 10. Exact control semantics

| Action | Durable/network effect |
| --- | --- |
| Pause one | Abort that attempt and record paused intent; other jobs can continue |
| Pause all | Disable this runner, abort its attempts, release the lease/lock and record paused intent for unfinished jobs |
| Resume one | Recheck blockers/session/ownership and continue that eligible job |
| Resume eligible uploads | Enable eligible submitted jobs across the queue; it is not scoped by history checkboxes |
| Retry failed uploads | Target exhausted request failures; preserve original confirmation and bytes |
| Retry saving locally | Use the still-available File reference to attempt retention again |
| Upload this time without local recovery | Confirmation-required session-only opt-in; closure/sign-out can lose those bytes |
| Choose file again | Match size/type and known SHA; without a saved hash, require explicit identity-unproven replacement confirmation |
| Cancel | Record cancellation before cleanup; do not delete a server file; warn about already accepted requests |
| Remove | Remove that local record/data; unfinished removal is confirmed; server files remain |
| Discard local copy | Only offered after original confirmation; allows thumbnail recovery to be deferred |
| Clear completed history | Remove completed/cancelled local history, not unfinished pending jobs |

**Pause is a network/execution pause, not a promise to stop all local saving immediately.** Already selected files can continue being retained locally so that closing later is safer. Keep the page open until their retention status is clear.

If storage cannot record a requested action, the UI can show an action-save error rather than claiming a durable state change. A disabled control or a blocker needs its own diagnosis, not repeated tapping of Resume.

## 11. Oversized selections and duplicate files

For 100 or fewer returned files, submission can begin immediately through the durable pipeline. Above 100, the full selection is retained and a virtualized review opens.

Review provides counts/total size, select/deselect, Select first 100, Queue selected up to 100, Queue all in groups of 100, and removal. Submitting 100 of 137 keeps the other 37 in review. Reloading restores retained review jobs without submitting them automatically. Files still inside the OS picker have not reached the app and cannot be recovered by this queue.

Local duplicate jobs retain their own recovery state until confirmation. They can wait on a canonical job; cancellation/failure of that canonical job must not itself mark the duplicate successful or destroy its only bytes. The runner can choose a replacement uploader and the backend retains its active-SHA duplicate guard.

## 12. Resource controls and multiple tabs

- One serial retention loop.
- One shared hash/image-preparation slot, also used by backfill.
- One active upload chain on touch/coarse-pointer devices, 3G-or-slower connections or saveData; three on an ordinary desktop.
- A chain includes its original and thumbnail work; these do not get independent concurrency pools.
- Small optional JPEG thumbnails: quality 0.82, longest side at most 480 pixels, white background for transparency.
- No full-resolution original preview URLs in the gallery or upload list; decoded resources/canvases are released.
- Bounded virtualized review/history and metadata pagination rather than mounting every file.
- Optional wake lock while actual work is active; support/permission is not assumed.

Tabs prefer Web Locks, with a transactional IDB lease lasting about 30 seconds and a visible-runner heartbeat about every 10 seconds. A fencing generation protects journal writes from stale owners. Denied/unavailable Web Locks can fall back to IDB. BroadcastChannel notifications are advisory, with visible-page polling when unavailable.

A second runner can show **Uploads are running in another tab**. Closing/hiding an owner or expiry/takeover requires reconciliation before another original is sent. These mechanisms cannot retract an HTTP request already received by the Worker.

Foreground pending recovery takes priority over thumbnail backfill. Backfill shares ownership, rechecks metadata and verifies ownership before mutation. Bounded work reduces memory pressure but cannot promise that a phone OS will never terminate a large-photo operation.

## 13. Quotas, missing data, cleanup and privacy

| Situation | Current response |
| --- | --- |
| DAILY_LIMIT | Persist a queue-level block/next eligible time; stop new queue mutations; explain 00:00 UTC / 06:00 Dhaka reset |
| STORAGE_FULL | Keep pending data; ask for server space to be freed; recheck stats on explicit Resume |
| Local quota/storage failure | Separate local warning; keep available File references; offer local retry, explicit session-only choice or removal |
| Missing original with surviving metadata | Show Original file needed and a reselect flow |
| Entire upload database removed | Cannot reconstruct missing filenames/counts; no invented recovery data |
| Cleanup fails after completion | Keep completion and a cleanup flag; retry cleanup rather than retransmit the original |
| Completed/cancelled history ages out | Prune after 30 days based on metadata timestamps; unfinished jobs have no automatic local expiry |
| HTTP 401/expired session | Stop network work and hide private UI; retain IDB; restore after login with explicit Resume |
| Explicit sign-out | Ask Keep pending / Delete this device's pending / Cancel; unretained data may still need reselect |
| Sign out everywhere | Revoke server sessions; chosen local cleanup applies only to this browser |

Pending blobs are **not application-encrypted**. Authentication hides the app's panel but does not cryptographically protect website data from someone with access to the browser profile/device. Clear-Site-Data remains cache-only. Credentials, bearer tokens and cookies are not stored in the queue database.

Safari, another browser, another profile, private mode, another hostname and an installed Home Screen app may use different storage contexts. Eviction, cleared data, low storage and device failure can prevent recovery. Persistent-storage permission and usage estimates are advisory, not guarantees.

The service worker caches the public shell/assets and bypasses API requests. It does not upload pending files in the background. Notes draft persistence was not added by the upload feature.

## 14. Every file changed in the original recovery feature

The original implementation commit was `e6451d311e7be98d9c223a1ca13511b0fa52acde`: 25 files changed. This is the complete file inventory for that commit, with current responsibilities.

| File | Change/responsibility |
| --- | --- |
| web/src/upload/model.ts | New typed job states, restoration planning, eligibility, duplicate dependency, chain limit and labels |
| web/src/upload/persistence.ts | New native IndexedDB schema, transactions, Blob retention/read-back, revision checks and lease/fencing |
| web/src/upload/state.ts | New shared queue signals, counts, readiness, progress and storage status |
| web/src/upload/work.ts | New shared single preparation slot |
| web/src/upload/runner.ts | New durable scheduler, reconciliation, control actions, retries, quotas, ownership, cleanup and lifecycle handling |
| web/src/upload/signout.tsx | New local privacy/sign-out choice dialog |
| web/src/views/Uploads.tsx | New full Uploads/review/history/storage/privacy interface |
| web/src/upload/queue.ts | Replaced memory queue with intake/lazy runner facade, retention permission and sign-out/unload coordination |
| web/src/upload/xhr.ts | GET support, explicit abort settlement, timeout and inactivity handling |
| web/src/upload/thumb.ts | Explicit canvas/resource release while preserving thumbnail output rules |
| web/src/upload/backfill.ts | Shared preparation/ownership and foreground priority; metadata recheck |
| web/src/components/Header.tsx | Uploads entry and pending count in navigation |
| web/src/components/UploadTray.tsx | Persistent compact launcher to the full panel; no inline Pause/Resume |
| web/src/lib/router.ts | Added /uploads route |
| web/src/views/Gallery.tsx | Lazy panel integration and keyboard handling that excludes upload controls |
| web/src/styles.css | Upload list/review/storage/dialog layout and responsive styling |
| web/src/auth.ts | Explicit logout goes through local pending-data choices |
| web/src/views/Settings.tsx | Sign out everywhere uses the same cleanup choice flow |
| web/test/upload-state.test.ts | State, recovery, retry/dependency, concurrency and fencing unit tests |
| web/test/upload-queue.test.ts | Retention/batch/original-byte/preview regression test |
| scripts/test-upload-recovery.mjs | Native-browser isolated persistence/failure/restart/selection/ownership/regression checks |
| docs/spec/resumable-uploads.md | Saved accepted feature specification |
| docs/verification/resumable-uploads.md | Original verification/release evidence and physical-phone checklist |
| README.md | User recovery, selection, privacy, sign-out and storage limits |
| DECISIONS.md | Accepted architecture and privacy changes |

**No Worker route, D1 table, KV binding, paid product or runtime package was added by the original recovery feature.** It reused the existing API and free Cloudflare stack.

## 15. Later changes that affect the current state

| Revision | Relevant effect |
| --- | --- |
| 565450e | Stable baseline before durable recovery |
| e6451d3 | Core recovery implementation |
| 200bff1 | Recorded original live recovery verification |
| b78d5b9 | New workspace navigation/themes and general-file support; the upload engine now treats server-classified non-images as needing no thumbnail |
| 5de8578 | Recorded the latest workspace/general-file live verification; audit baseline |

The latest workspace change added the mobile navigation dialog and sidebar paths to Uploads. It did **not** add inline Pause/Resume to the compact bar. CSS hides the separate header pending shortcut at widths up to 1100 pixels; the compact bar/menu paths remain the expected phone routes.

General files now use the same retention/recovery pipeline. The 25 MiB original limit and free-plan limits remain. Source-preview size limits are unrelated to queue retention limits.

Historical deployment records:

- Original recovery Worker version: `108d7b33-5f53-42b3-8083-47ddc2a30d65`.
- Latest recorded workspace/general-file Worker version: `5fa2bad8-ee58-4208-8a59-c9968fbeddef`.
- Fresh audit matched the live public JS/CSS to the current local built artifacts, including the full controls chunk.
- Restore tags remain `checkpoint/before-resumable-uploads-2026-10-30` and `checkpoint/before-workspace-files-2026-10-31`.

These release identifiers and asset matches do not prove that an already-open phone tab has loaded the newest frontend. An old page can keep its JavaScript until navigation/reload. Do not reload unretained work just to test that hypothesis.

## 16. What was tested previously, versus what is still unknown

| Evidence | Scope and limit |
| --- | --- |
| Original release unit suite | 114 tests / 23 files at that release; not all of these tests are upload-specific |
| Original full browser verification | 36 browser cases plus 10 local API smoke groups; seven focused follow-ups after pause/auth fixes |
| Latest workspace release unit suite | 119 tests / 24 files, including unrelated app coverage and new general-file safety |
| Latest focused browser regression | 16 cases plus API smoke; includes lost responses, auth/sign-out, 137-file paths, touch concurrency, Notes/copy/Trash/offline and native fallbacks |
| Historical live recovery check | Disposable PNG retained, paused, reloaded, resumed and confirmed without replay; only its fixture was deleted |
| Latest historical live workspace check | Recovery retested, plus a disposable HTML file and theme checks; no personal file modification |
| This report's new check | One native-IDB phone-sized control/pause/reload/Resume case, plus public live-asset equality checks |
| Your actual phone | Not accessed or inspected; current reported symptom not conclusively diagnosed |
| Physical iOS force-quit / one-hour return / real low storage | Owner acceptance remains outstanding; desktop emulation does not establish these behaviors |

The full app test suite was not rerun merely to write this report. No claim is made that every browser/phone combination has passed every scenario.

## 17. Gaps and items that deserve follow-up

1. **Confirmed UX gap:** no direct Pause/Resume on the compact bar, and no explicit “Manage uploads” wording. This can make the implemented controls effectively undiscoverable.
2. **Your phone remains unverified:** the full-screen path passed emulation, not your installed browser/app instance. A failed tap/navigation, missing lazy chunk, disabled state or another context must be distinguished from missing backend recovery.
3. **Offline cold opening of the panel is not guaranteed:** warming the lazy panel after selection is best effort. If its code was never fetched/cached, a first attempt to open it offline can fail. Local retention and UI availability are different questions.
4. **Some storage-read failures affect initialization as a whole:** missing records returned normally are handled per job, but an actual thrown IDB read failure is caught by the outer initializer and can show the generic unavailable/blocked journal notice rather than one repaired row. This is a source-inspection limitation, not an observed cause on your phone.
5. **Recovery guarantees are conditional:** unretained/session-only data, evicted/cleared storage and device failures remain loss cases. No background or byte-offset transfer guarantee exists.
6. **Counters need interpretation:** pending includes failed/paused/review work; confirmed job counts can include duplicates and history. These are not proof of currently active transfer or unique cloud file totals.

No application fix was made during this reporting task. These findings separate what the code implements from what still needs a decision or device reproduction.

## 18. Phone verification procedure

Use a few disposable files whose originals you still have. Test one behavior at a time.

| Test | Steps | Pass condition |
| --- | --- | --- |
| Find the controls | Start a small upload, tap the compact bar or menu → Uploads | Full panel opens and shows all four global control labels |
| Retention | Inspect each unfinished row | It says Saved on this device, or clearly says it is not retained |
| Pause | Tap Pause all during transfer | Active network work stops; rows become paused; local saving may finish |
| Manual pause persistence | After retention is verified, close/reopen the same context | Paused rows return after authentication; nothing uploads until explicitly resumed |
| Normal Resume | Tap Resume eligible uploads | Eligible submitted work continues; completed originals do not deliberately restart |
| Connection failure | Enable airplane mode during a disposable original; reconnect | Retained state stays; runnable work reconciles/continues; manually paused jobs remain paused |
| App suspension | Switch apps or lock the phone, then return | Previously runnable work can recover without turning manually paused jobs back on |
| Actual termination | After retention, force-quit and return after an hour | Same-context queue restores; waits for Resume; verifies retained data still exists |
| Thumbnail-only recovery | Interrupt after original confirmation | Original stays confirmed; only missing thumbnail work is attempted |
| Review above 100 | Select 137; queue 100 | The other 37 stay in review; alternatively Queue all retains logical 100/37 grouping |
| Cancel | Cancel a disposable retained pending job and confirm | Local pending bytes can be removed; an already accepted server file is not deleted as a side effect |
| Sign-out choices | Test Keep, then Delete using disposable pending files | Keep allows same-context restoration; Delete removes only this browser's pending data |

Do not deliberately fill your device or delete personal data for a quota test. Use the existing isolated automated fault tests for synthetic quota/transaction failures.

## 19. If the phone still has no usable controls

Record the following, without posting your access key, token, cookie or personal file contents:

- Safari tab, another browser, or installed Home Screen app?
- Phone OS/browser version and portrait/landscape orientation.
- Exact bar text and whether tapping the bar does anything.
- Whether the navigation menu opens and contains Uploads.
- Whether the URL, if visible, ends in `#/uploads`.
- Whether the Uploads heading, scope explanation, global buttons and Queue and history section appear.
- The exact local-retention label and any connection/storage/auth/other-tab notice.
- Whether controls are absent, disabled, obscured, or respond but do not change state.
- Whether this was the same storage context and a newly selected file after the recovery update.

A screenshot with filenames redacted can distinguish the compact launcher from a full-panel rendering problem. Do not clear data while preserving evidence of a pending queue.

## 20. Source and evidence references

- [Original accepted recovery specification](../spec/resumable-uploads.md).
- [Original release verification](resumable-uploads.md).
- [Latest workspace/general-file verification](workspace-files.md).
- [Compact bar component](../../web/src/components/UploadTray.tsx).
- [Full Uploads controls and conditional row actions](../../web/src/views/Uploads.tsx).
- [Queue intake and browser-storage permission](../../web/src/upload/queue.ts).
- [State definitions and recovery planning](../../web/src/upload/model.ts).
- [IndexedDB transactions, retention and lease](../../web/src/upload/persistence.ts).
- [Runner, reconciliation, retries, actions and lifecycle](../../web/src/upload/runner.ts).
- [XHR settlement and watchdog](../../web/src/upload/xhr.ts).
- [Explicit sign-out choices](../../web/src/upload/signout.tsx).
- [Current workspace navigation](../../web/src/components/Workspace.tsx).
- [Native-browser recovery integration script](../../scripts/test-upload-recovery.mjs).

The fresh phone-controls audit was run from a temporary copy of that harness with one additional case, without editing the application or the checked-in test script. It created and cleaned its own local runtime/credentials. No production upload or deployment was performed for this report.
