Use this prompt in the implementation chat. It chooses **device-local recovery**, IndexedDB for retained files, and whole-file retries with duplicate checks. Browser storage can preserve files across closure, but cannot guarantee recovery after eviction or cleared site data. [IndexedDB documentation](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), [WebKit storage policy](https://www.webkit.org/blog/14403/updates-to-storage-policy/).

---

Implement durable, recoverable uploads in the existing Dump project at `E:\Codes\Drop`.

This is an implementation task, not a request for another proposal. Read the existing code, make the changes, test them, and document the result. Follow the decisions below explicitly.

**1. Understand the existing project before changing anything**

Read `AGENTS.md`, `C:/Users/SAM/.codex/skills/karpathy-guidelines/SKILL.md`, the saved specifications, `DECISIONS.md`, and relevant verification documents.

The checked-in project and its accepted amendments are authoritative. Some original specifications described R2; the actual application now uses:

- One Cloudflare Worker serving the frontend and Hono API.
- D1 binding `DB` for metadata.
- Private Workers KV binding `FILES` for original files and thumbnails.
- Preact, signals, TypeScript, Vite, and Tailwind.
- Browser-session authentication through an HttpOnly cookie.
- An independent upload-only bearer token for the iPhone Shortcut.
- A 900,000,000-byte server storage soft cap.
- A 25 MiB original-file limit.
- JPEG thumbnails generated in the browser.
- A service worker that caches only the public application shell and bypasses `/api/*`.

Keep the existing Cloudflare Free stack. No card, paid service, R2, new storage service, or additional runtime dependency.

Inspect these files in particular:

- `web/src/upload/queue.ts`
- `web/src/upload/xhr.ts`
- `web/src/upload/hash.ts`
- `web/src/upload/thumb.ts`
- `web/src/upload/backfill.ts`
- `web/src/components/Fab.tsx`
- `web/src/components/UploadTray.tsx`
- `web/src/components/DropOverlay.tsx`
- `web/src/views/Gallery.tsx`
- `web/src/store/files.ts`
- `web/src/auth.ts`
- `web/src/lib/api.ts`
- `web/src/lib/router.ts`
- `worker/src/files/routes.ts`
- `worker/src/files/repo.ts`
- `worker/src/files/storage.ts`
- `worker/test/coverage.test.ts`
- `web/test/upload-queue.test.ts`

The existing queue already has concurrency controls, retries, authentication-loss handling, and offline listeners. However, its jobs and `File` objects live only in module memory. It has no durable recovery journal, and the completed tray disappears automatically. Fix this architecture instead of merely adding more retry calls.

Preserve the previous iPhone memory fix: never use full-resolution original files as gallery or upload-list preview images.

Save this feature specification under `docs/spec/resumable-uploads.md`, and record implementation decisions in `DECISIONS.md`.

**2. Required outcome and honest limits**

The main scenario is:

1. I select photos on my phone.
2. Dump saves pending files locally and clearly tells me which ones are retained.
3. Some files upload.
4. Connectivity fails, the browser suspends, or I force-quit it.
5. An hour later, I reopen the same app/browser and authenticate.
6. Dump restores the retained queue and offers Resume.
7. Completed originals are preserved. Only unfinished work continues.

Support this without keeping the browser running.

However, make these distinctions explicit:

- Queue recovery is persistent local storage, not guaranteed background execution.
- An interrupted original restarts from byte zero.
- Already completed files are not uploaded again.
- The displayed progress of an interrupted file may restart from zero.
- Exact-byte resume is outside this feature.
- A browser can evict website data, the user can clear it, and private browsing may not preserve it.
- A file is recoverable after reopening only if its local storage transaction completed and its stored bytes remain available.

Never promise “protected forever,” “cannot be lost,” or “always recoverable.”

Do not implement chunked uploads, KV multipart assembly, or a server-side upload-session system for this feature.

**3. Device-local queue: explicit scope decision**

Implement pending-upload recovery on the originating browser/storage context only.

Do not synchronize pending queue records across devices. A desktop cannot resume a photo whose bytes exist only in the phone’s browser.

Completed files continue appearing across devices through the existing gallery.

Show this explanation in the Uploads panel:

> Pending uploads are saved in this browser on this device. Resume them here. Uploaded files appear on all your devices.

Do not assume Safari, another browser, and the installed Home Screen app share the same local storage. A different hostname, browser profile, private session, or app storage context may have a different queue.

No cloud queue metadata, device registry, polling dashboard, or extra D1 tables are needed.

**4. Persistent Uploads interface**

Add a dedicated `#/uploads` view, lazy-loaded through the existing router.

Add an Uploads entry to the header menu with a pending-count badge when appropriate. Keep a compact activity indicator available while uploads run; opening it navigates to the full Uploads view.

The Uploads view must remain available when nothing is actively transferring. Do not automatically remove completed rows or hide all history after three seconds.

Use the current design system, safe-area handling, accessible dialogs, and system light/dark theme.

Each row must show:

- Filename and size.
- A small thumbnail when available; otherwise a placeholder.
- Transfer status.
- Local-retention status.
- Per-file controls appropriate to its state.
- A useful error or pause reason.
- Whether the original is already uploaded but its thumbnail is unfinished.

The main user-facing statuses are:

- Queued.
- Uploading.
- Paused.
- Failed.
- Completed.

Also support explanatory substates such as:

- Saving on this device.
- Preparing.
- Checking previous upload.
- Waiting for connection.
- Sign in to resume.
- Daily limit reached.
- Uploaded — thumbnail pending.
- Original file needed.
- Cancelled.
- Already in Dump.

Provide:

- Pause all.
- Resume eligible uploads.
- Retry failed uploads.
- Cancel pending uploads.
- Clear completed history.
- Per-file Pause, Resume, Retry, Cancel, and Remove where applicable.

Never let “Clear completed” remove paused, failed, queued, or locally retained unfinished files.

Display confirmed completion separately from current transfer progress. A file reaching 100% in the XHR progress event is not completed until the server confirms acceptance.

Do not calculate “completed bytes” from unconfirmed XHR progress.

**5. Durable local storage**

Use native IndexedDB, without a new dependency.

Use a versioned database named `dump-uploads`. Keep the schema and storage operations in a dedicated module such as `web/src/upload/persistence.ts`.

Use separate object stores for:

- Job metadata.
- Original blobs.
- Optional thumbnail blobs.
- Queue settings and ownership/lease records.

Separating metadata from blobs is mandatory: loading the panel or restoring the queue must not load every original into memory.

Use stable UUIDs for local job and selection-group identifiers. Persist ordering so recovery preserves the user’s selection order.

Persist at least:

- Local job ID and selection-group ID.
- Original filename, upload filename, MIME type, size, and last-modified timestamp.
- Creation/update timestamps and ordering.
- Whether the user submitted the file for upload or it remains in selection review.
- User intent: runnable, manually paused, or cancelled.
- Pipeline phase.
- Local original availability.
- SHA-256 once calculated.
- Original-upload confirmation and returned server file ID.
- Thumbnail state and dimensions when known.
- Last meaningful error category.
- Retry attempt and next-retry timestamp.
- Whether an original request has an uncertain outcome.

Do not persist:

- Access keys, bearer tokens, cookies, or session secrets.
- Blob URLs.
- XHR objects or controllers.
- Decoded images or image bitmaps.
- Entire file contents as JSON/base64.
- Progress on every XHR event.

Store originals as Blob values. Reconstruct a `File` with stored metadata when necessary.

Only mark a file **“Saved on this device”** after:

1. The transaction containing its blob and corresponding metadata completes.
2. A follow-up read confirms that the blob record exists and has the expected size.

Request strict transaction durability where supported, with a compatible fallback. Do not describe transaction completion as a guarantee against all device failures.

Use short transactions. Do not hold IndexedDB transactions open across hashing, image decoding, network requests, or timers.

Prefer an atomic transaction spanning the relevant stores for each durable state transition.

Handle database upgrades, blocked opens, `versionchange`, transaction aborts, unavailable IndexedDB, quota errors, and failed cleanup explicitly.

On restoration, do not blindly trust a retention flag. Verify the relevant blob record when recovering a pending job. Missing or unreadable bytes must produce “Original file needed,” not an endless retry loop.

**6. Retention begins immediately after selection**

Start retaining selected files as soon as the app receives them, including selections awaiting review.

Persist original files one at a time. Do not read every selected file into an ArrayBuffer to store it; IndexedDB can store the Blob directly.

Until retention succeeds, show:

> Saving on this device… Keep the app open.

After successful retention, show:

> Saved on this device.

If retention fails, show:

> Not saved locally. Keep this page open or select this file again later.

Attempt `navigator.storage.persist()` from an appropriate user-initiated flow, and inspect `persisted()` when available.

Use `navigator.storage.estimate()` only as an advisory estimate. It is not proof that writes will succeed.

Show whether persistent storage was granted, denied, or unavailable without treating denial as a fatal error.

Do not repeatedly prompt or repeatedly call persistence requests for every file.

The default durable-upload path must retain a file before sending its original.

If retention fails, keep its currently available `File` reference and offer explicit choices:

- Retry saving locally.
- Upload this time without local recovery.
- Remove the item.
- Free space by removing completed history or explicitly selected local data.

Session-only upload is an opt-in fallback, never an automatic downgrade.

Clearly label such files as not recoverable after closure. Warn before leaving while unretained originals remain, while acknowledging that browser termination can bypass warnings.

If part of a large selection is retained and later writes fail, preserve the successfully retained subset. Do not clear or restart the entire selection.

**7. Fix selections larger than 100 files**

Remove the current destructive behavior where selecting more than 100 files causes `enqueue()` to reject the entire selection after the picker value has already been cleared.

A native picker selection cannot reliably be reopened with the same checked photos. Preserve the returned `File` references in application state immediately.

Implement an in-app review step for selections exceeding 100 files.

Requirements:

- Show every returned file using a virtualized list.
- Start local retention immediately.
- Show selected count and total size.
- Allow individual removal, deselection, and select-all.
- Provide “Select first 100.”
- Provide “Queue selected.”
- Provide “Queue all in groups of 100.”
- Keep the review open while the user adjusts the selection.
- Never force the user to reopen Photos just to remove a few items.

The old 100-file limit becomes the maximum logical processing group, not a destructive limit on the total selected files.

If I select 137 photos:

- I can deselect 37 and queue 100.
- Or explicitly queue all 137, partitioned into groups of 100 and 37.
- Both choices preserve the selected originals, subject to successful local storage.
- Grouping does not create 100 simultaneous upload tasks.

Ordinary selections of 100 or fewer may enter the queue immediately, using the same durable retention pipeline.

Preserve unsubmitted, retained review selections across reload. Restore them as **“Selection awaiting review”**, without uploading them automatically.

If I submit only part of a review selection, keep the remainder in review until I explicitly remove or discard it.

Apply the same non-destructive intake behavior to file picker, drop, and paste entry points.

Explain that recovery covers files the browser actually returned to the page. It cannot preserve selections still inside a native picker before that picker returns.

**8. Explicit state machine and transition safety**

Refactor the queue around a typed, testable state machine.

Separate these concerns:

- User intent.
- Pipeline phase.
- Local retention.
- Original-server confirmation.
- Thumbnail completion.
- Temporary execution ownership.

Do not overload a single `waiting` status with every possible reason.

Document and test the transition rules.

Persist significant transitions before starting their dependent side effects. In particular, persist an “original request may be in flight” marker before sending an original.

When a page disappears, that marker tells recovery to reconcile the outcome instead of assuming the upload failed.

A storage-write failure must not silently advance a durable job. Stop the affected job, retain available references, and explain that its latest state could not be saved.

Use attempt/generation identifiers to reject stale callbacks after:

- Pause.
- Cancel.
- Retry.
- Sign-out.
- Leadership changes.
- Queue restoration.

Abortions initiated by the user must not consume network retry attempts or convert cancelled jobs into failed jobs.

Persist confirmed original completion as soon as the response arrives, before starting thumbnail work.

Never discard a retained original while its server outcome is unknown.

**9. Recovery after reopening**

Restore the queue only after full browser authentication succeeds.

Do not expose retained filenames, thumbnails, or queue metadata on the public login screen.

Read metadata first. Load originals only when a job is about to run.

On a new page/app launch:

- Normalize interrupted preparation and transfer phases into recoverable paused states.
- Preserve manual-pause intent.
- Restore failed jobs with their reasons.
- Preserve completed history.
- Restore unsubmitted selection review.
- Detect missing local blobs.
- Show a clear Resume action.
- Do not automatically start transferring pending photos before the user chooses Resume.

Suggested message:

> Found 23 unfinished uploads saved on this device. Resume when you’re ready.

After Resume, reconcile uncertain server outcomes before sending originals again.

For a temporarily hidden or suspended page that later returns without a full reload, automatically continue jobs that were previously runnable, after rechecking authentication and reconciling uncertain requests. Manually paused jobs remain paused.

Do not depend on `beforeunload`, `unload`, or `pagehide` to perform the first durable write. Those events may never fire.

When the document becomes hidden, stop scheduling new work and checkpoint known state. Abort active requests as recoverably interrupted where necessary. Treat abort outcomes as uncertain until reconciled.

No service-worker background uploads or Background Sync dependency.

**10. Connection loss and bounded retries**

Do not treat `navigator.onLine === true` as proof that the API is reachable.

Handle both:

- Explicit offline events.
- Network failures/timeouts while the browser still reports online.

On connection loss:

- Pause scheduling.
- Abort or settle active requests safely.
- Preserve locally retained originals.
- Mark uncertain original outcomes for reconciliation.
- Show “Waiting for connection.”

When connectivity returns in an already active session:

- Retry a bounded reachability/authentication check.
- Resume only jobs whose user intent was runnable.
- Reconcile uncertain original uploads first.
- Leave manually paused, cancelled, authentication-blocked, quota-blocked, or storage-full jobs alone.

Use one queue-level connectivity probe, not one probe per file.

Back off repeated probes, for example 5, 15, 30, then 60 seconds, only while the app is visible and runnable work exists. Focus and online events may trigger an earlier check, with throttling.

Keep bounded per-request retries for transient errors. Reuse the existing 1/3/8-second delays with jitter and `Retry-After`, but reconcile original-upload outcomes before retransmission.

After bounded retries are exhausted, retain the job and show a Retry control. Never delete its original.

Malformed or lost success responses from an upload are uncertain outcomes, not proof that no file was stored.

**11. Reconcile interrupted originals using the existing API**

Keep these existing endpoints:

- `POST /api/upload/check`
- `POST /api/upload`
- `POST /api/thumb?id=<id>`
- `GET /api/files/:id`

Calculate and persist SHA-256 before the first original upload.

Before retrying an original with an uncertain outcome:

1. Check its hash through `/api/upload/check`.
2. Batch checks into at most 50 hashes, respecting the existing request limit.
3. If an active file exists, fetch its metadata.
4. Persist the server ID and original-confirmed state.
5. Do not retransmit the original.
6. Continue only any necessary thumbnail work.

If the check fails because authentication or connectivity failed, do not interpret that failure as “file absent.”

If the check succeeds and finds no active file, restarting the whole original is allowed.

Preserve the backend’s existing duplicate check and active SHA unique index as the final guard against overlapping requests.

Also handle duplicate hashes within the local queue:

- Avoid uploading the same bytes twice.
- Associate duplicate jobs with a canonical local job or confirmed server file.
- Do not permanently mark a duplicate as successful merely because its canonical job was queued.
- If the canonical job fails or is cancelled, the other job must remain recoverable or become the replacement uploader.
- Do not delete its only retained bytes while relying on an unfinished canonical job.

Explain the limits honestly:

- This prevents duplicate active gallery entries through existing deduplication.
- It does not guarantee exactly one network transfer or KV write.
- A Worker can write KV and fail before inserting D1 metadata; existing orphan maintenance handles such leftovers.
- A lookup can race a still-finishing request; the server’s unique-index handling remains necessary.
- KV propagation delays do not prove the original failed.

Do not probe KV by repeatedly fetching the whole original to determine whether an upload succeeded.

Once a job has durable confirmation that its original completed, do not reupload it merely because the remote file was subsequently trashed or deleted. Show “Previously uploaded; file no longer available” if needed.

**12. Originals and thumbnails are separate checkpoints**

Track original completion independently from thumbnail completion.

If the original succeeded and the thumbnail failed:

- Show “Uploaded — thumbnail pending.”
- Retry only the thumbnail.
- Never reupload the original.
- Check current file metadata before retrying a thumbnail whose response was lost.
- If a thumbnail is already recorded, finish without another write.

Keep thumbnail generation client-side, JPEG, quality 0.82, maximum longest side 480 pixels, with transparency flattened onto white.

When useful, retain the small generated thumbnail locally until its server write succeeds.

After original completion is durably recorded:

- The original blob may be released if thumbnail work is complete or a retained thumbnail is sufficient.
- If generating a missing thumbnail still requires the original, keep it until that work completes or the user explicitly chooses to discard its local copy.
- Explain that discarding this local copy leaves the uploaded original intact and may defer thumbnail recovery to existing backfill.

Coordinate the new queue with thumbnail backfill. The two systems must not upload the same thumbnail simultaneously.

Prioritize foreground queue recovery over background backfill.

**13. Pause, Resume, Retry, and Cancel semantics**

Pause:

- Persist the user’s paused intent.
- Stop scheduling the affected work.
- Abort active work safely.
- Keep locally retained originals and thumbnails.
- Preserve uncertain-outcome markers.
- Do not resume manually paused jobs on online/focus events.

Resume:

- Clear the manual pause only for selected jobs.
- Validate local availability.
- Recheck session and blockers.
- Reconcile uncertain server state.
- Continue from the last confirmed stage.

Retry:

- Retry unfinished eligible work only.
- Keep existing original confirmation.
- Never erase history or local bytes simply to reset counters.
- Do not retry unsupported or missing files without resolving the underlying issue.

Cancel:

- Stop future attempts.
- Abort active requests.
- Warn that an already accepted server upload may still appear in the gallery.
- Never delete a completed server file as a side effect.
- Explicit cancellation may remove retained local bytes after the cancellation is recorded.
- Preserve a small cancelled-history row until cleared.

Use a confirmation before cancelling unfinished jobs whose local copies will be deleted. State the consequences clearly.

Avoid stale async callbacks recreating a cancelled job or retaining a blob after its removal.

**14. Authentication, quotas, and storage limits**

Expired session or HTTP 401:

- Stop queue network work.
- Preserve IndexedDB data.
- Hide private queue UI while signed out.
- Return to the existing login flow.
- After login, restore the queue and offer Resume.
- Do not automatically delete pending files because `authState` became `out`.

`DAILY_LIMIT`:

- Pause new storage mutations across the queue.
- Keep retained originals.
- Explain the reset time: 00:00 UTC / 06:00 Asia/Dhaka.
- Store a next-eligible timestamp.
- Avoid repeatedly retrying writes before reset.
- After reset, eligible work may continue only while the page is active and the user has enabled running; reopening still offers Resume.

`STORAGE_FULL`:

- Pause affected uploads.
- Retain pending files.
- Explain that server space must be freed.
- Provide a route to relevant Settings/Trash controls.
- Recheck stats when the user chooses Resume.
- Do not repeatedly hammer the API.

Local storage full/unavailable is a different error from server storage full. Use different messages and remedies.

Respect all existing request limits, CSRF requirements, scope checks, and generic backend error handling.

**15. Low-memory implementation**

Make these scheduling choices:

- One local-retention write at a time.
- One shared hash/image-preparation slot.
- One active upload chain on touch/coarse-pointer devices.
- Three active upload chains on desktop.
- Reduce to one on slow connections or when `saveData` is enabled.

An upload chain includes an original followed by its thumbnail, not separate unrelated concurrency allowances.

Use feature detection defensively. Do not assume `navigator.connection` exists.

Do not:

- Read all retained blobs on startup.
- Hash all 100 originals simultaneously.
- Decode full-size originals for selection review or tray previews.
- Use `Promise.all()` over the entire batch for expensive preparation.
- Keep decoded bitmaps after use.
- Retain original `File` references after successful persistence when they are no longer needed.
- Create hundreds of preview URLs on initial restoration.

Generate small thumbnails lazily and revoke preview URLs when rows leave the relevant view, jobs are removed, or authentication ends.

Virtualize large review lists and upload-history lists. Paginate IndexedDB metadata where necessary.

Release canvases, image bitmaps, fallback image resources, and transient ArrayBuffers promptly.

Preserve original upload bytes unchanged.

**16. Multiple tabs and ownership**

Two tabs on the same origin must not independently run the same durable queue.

Implement one active queue runner per browser storage context.

Prefer Web Locks where available. Use an IndexedDB transactional lease with owner ID, expiration, and fencing generation as a fallback.

The fallback must:

- Acquire/update ownership atomically.
- Renew only while the owning page is actively running.
- Expire after a crashed or abandoned owner.
- Verify ownership before scheduling network mutations.
- Prevent stale owners from committing queue-state updates after ownership changes.

A practical lease is 30 seconds with a 10-second heartbeat while visible.

Use BroadcastChannel when available for change notifications, with a lightweight visible-page fallback. Notifications are advisory; IndexedDB is authoritative.

A second tab should show:

> Uploads are running in another tab.

On suspension, ownership loss, or takeover, abort local work and reconcile server outcomes before a new runner retransmits.

Do not claim the lease can cancel an HTTP request that already reached the Worker. Server deduplication remains the final protection.

Do not persist an unexpiring `isUploading` boolean that can permanently strand jobs.

**17. Local privacy and sign-out**

Retaining originals locally is a deliberate change to the previous memory-only privacy model. Explain it in the app and README.

State:

- Pending originals are stored in this browser’s IndexedDB.
- They may remain after closing the tab or app.
- They are not uploaded until the queue runs.
- They are not application-encrypted.
- Someone with access to the browser profile/device may access local website data.
- Hiding the queue until authentication does not cryptographically protect the stored files.
- Clearing website data or browser eviction can remove them.

Do not implement encryption with a key stored beside the data or derived from the inaccessible HttpOnly cookie.

For explicit Sign out, when retained unfinished jobs exist, present:

- **Keep pending uploads on this device and sign out.**
- **Delete this device’s pending uploads and sign out.**
- Cancel.

Explain the local-privacy consequence before keeping files.

Automatic authentication expiry must retain pending files without asking.

For “Sign out everywhere,” apply the selected local cleanup behavior only to this browser. Do not claim it clears IndexedDB on other devices.

Do not broaden `Clear-Site-Data` to include `"storage"`; that would silently erase the durable queue and other local preferences.

On sign-out:

- Stop scheduling and abort requests.
- Release execution ownership.
- Clear sensitive in-memory rows and preview URLs.
- Preserve or delete durable data according to the explicit choice.
- Ensure late callbacks cannot repopulate the signed-out UI.

**18. Cleanup and missing-file recovery**

Do not automatically expire unfinished locally retained files.

Keep completed-history metadata for 30 days, with automatic pruning limited to completed/cancelled records. Pruning must never touch unfinished work.

Delete unneeded original and thumbnail blobs promptly after confirmed completion, using durable state transitions.

If cleanup fails, keep the completed state and retry cleanup later. Do not reupload a completed original because local deletion failed.

Add a local-storage section to Uploads showing:

- Retained pending-file count.
- Known retained bytes.
- Persistence status.
- A brief eviction explanation.
- Clear completed history.
- Explicitly confirmed removal of selected pending local files.

If metadata survives but an original is missing:

- Show “Original file needed.”
- Offer “Choose file again.”
- Verify a known SHA-256 before attaching the replacement.
- Do not accept a different file silently under an old job.
- If no hash was ever established, explain that identity cannot be proven and require explicit replacement confirmation using available metadata.

If the entire IndexedDB database was cleared, the app cannot reconstruct the missing queue. Do not invent missing job names or counts. Document this limitation.

**19. Testing requirements**

Add meaningful unit tests for state transitions, recovery planning, retry eligibility, duplicate dependencies, and ownership.

Use real-browser IndexedDB integration tests for persistence and transaction behavior. Mock-only tests are not sufficient evidence that files survive reload.

Use existing dependencies and available browser tooling. Do not add a testing library merely for convenience.

Test at least:

1. Save several originals, reload, authenticate, recover their bytes and metadata, then Resume.
2. Close and reopen the browser with the same storage profile; recover unfinished jobs.
3. Recover an hour-old paused queue without expiration.
4. Disconnect during an original request; reconnect and resume only eligible jobs.
5. Simulate network failure while `navigator.onLine` remains true.
6. Lose the original-upload success response after server acceptance; reconciliation completes the job without retransmitting it.
7. Lose the thumbnail response; metadata reconciliation avoids rewriting an already recorded thumbnail.
8. Reload after original confirmation but before thumbnail completion; retry only thumbnail work.
9. Kill/reload during local persistence; only committed blobs are labelled retained.
10. Fail an IndexedDB transaction after an individual request succeeded but before transaction completion; no false retention claim.
11. Exhaust local storage partway through a selection; previously retained files survive and remaining files are labelled accurately.
12. Run with IndexedDB unavailable; session-only fallback requires explicit choice.
13. Missing blob with existing metadata produces a reselect flow.
14. Complete one file, interrupt another, reopen; only unfinished work runs.
15. Manual Pause stays paused across connectivity changes and reload.
16. Cancel during preparation and transfer; stale callbacks cannot restart the job.
17. Authentication expires mid-queue; pending data survives login.
18. Both explicit sign-out cleanup choices behave as described.
19. Daily quota and server storage-cap errors preserve pending originals and stop request storms.
20. Two tabs compete for ownership; only one runner schedules work.
21. A runner disappears and a new page recovers its lease without permanently stuck jobs.
22. Select 137 photos; deselect to 100 without reopening the picker.
23. Queue all 137 in groups; all files are preserved and concurrency remains bounded.
24. Reload during oversized-selection review; committed selections restore without auto-uploading.
25. Duplicate local jobs remain recoverable if the canonical job is cancelled or fails.
26. A previously confirmed server file is later deleted; recovery does not recreate it automatically.
27. Large photo batches never publish full-resolution original preview URLs.
28. Notes, gallery, clipboard, Trash, PWA startup, and upload-only Shortcut behavior remain intact.

Use synthetic files and an isolated local dataset for destructive tests.

For real iPhone verification, provide a checklist covering:

- Airplane mode during upload.
- Locking the phone.
- Switching apps.
- Force-quitting and reopening the same browser/PWA after an hour.
- Selection of more than 100 photos.
- Low available device storage.
- Safari versus installed-app storage contexts.

Do not claim physical iPhone tests passed when only desktop emulation ran. Distinguish simulated suspension, browser-process closure, and real iOS termination.

**20. Scope, verification, and delivery**

Keep changes focused on durable uploads and non-destructive selection.

Preserve existing backend endpoints and storage bindings. A frontend-only design with IndexedDB should cover this feature; do not redesign storage infrastructure.

Lazy-load the full Uploads view and selection-review UI. Keep the existing initial JS/CSS budgets enforced. Do not raise budgets or disable checks.

Run:

- `npm run typecheck`
- `npm test`
- `npm run build`

Run applicable local smoke tests and browser recovery tests.

Update:

- `README.md` with recovery, privacy, sign-out, selection review, and eviction behavior.
- `DECISIONS.md`.
- `docs/verification/resumable-uploads.md`.

Follow repository commit/push instructions after reviewing changes for secrets. Never commit selected photos, IndexedDB exports, credentials, local browser profiles, or local Wrangler state. Do not deploy merely as a side effect of testing; follow the implementation chat’s deployment authorization.

Deliver:

- What changed and where.
- The durable state/retention model.
- Exact recovery behavior.
- The difference between whole-file restart and byte-offset resume.
- Oversized-selection behavior.
- Tests actually performed and their results.
- Initial bundle sizes.
- Remaining device/browser limitations.
- A concise real-phone acceptance checklist.

The feature is complete only when an original that has been labelled **“Saved on this device”** can survive a normal reload or browser restart, reappear after authentication, and resume unfinished work without reuploading already confirmed originals—provided the browser has retained the site’s data.