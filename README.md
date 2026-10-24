# Dump

Private, single-user file dump served by one Cloudflare Worker with Workers Static Assets, private Workers KV file storage, and D1 metadata. Parts 1–7 provide secure sign-in, the file API, virtualized gallery, uploads, viewer, copy workflows, Trash/settings, PWA installation and an iPhone Shortcut guide. Cleanup and deployment verification arrive in Part 8.

Use Cloudflare's Free plan without adding a payment method. Do not enable R2 or any paid product. If a setup command requests a paid subscription or card, stop rather than accepting it.

## First-time setup

Use Node 22.12+ and npm; the selected current toolchain requires this minimum within the spec's Node 20+ range. This project was verified with Node 24.20.0. Run all commands from this repository root.

1. Run `npm install`, then `npx wrangler login`.
2. Create a KV namespace with `npx wrangler kv namespace create FILES`. Paste its returned namespace ID into the `[[kv_namespaces]]` block in `wrangler.toml`, keeping `binding = "FILES"`. For this existing account, the namespace named `dump-files` is already created and its verified ID is configured; skip creation.
3. Create the database with `npx wrangler d1 create dump-db`. Paste its returned database ID into `wrangler.toml`. For this existing account, `dump-db` is already created and its verified ID is configured; skip creation.
4. Run `node scripts/generate-secrets.mjs --write-dev-vars` in your own terminal. Save ACCESS_KEY and UPLOAD_TOKEN in your password manager immediately; they cannot be recovered. The script displays them once and writes only their hashes plus SESSION_SECRET into `.dev.vars`.
5. Run each of the three displayed `npx wrangler secret put ...` commands and paste the corresponding value when prompted: ACCESS_KEY_HASH, UPLOAD_TOKEN_HASH, and SESSION_SECRET.
6. Run `npm run deploy`. This typechecks, builds, checks bundle budgets, applies remote migrations, and deploys the Worker and assets.

Never commit `.dev.vars` or plaintext credentials. `.dev.vars` is ignored by Git. Running the generator again replaces the local secrets; save the newly generated credentials and update remote secrets together if rotating them.

## Local development

After installing dependencies, generate local secrets as above. Local development simulates D1 and KV on disk; the configured IDs do not enable remote access in local mode, and placeholder IDs also work locally.

```sh
npm run build
npm run db:migrate:local
npm run dev
```

Open http://localhost:5173 and sign in with the locally generated ACCESS_KEY. Vite proxies `/api` to Wrangler on port 8787, preserving the original host. `/api/health` returns `{"ok":true}`. `/api/nope` returns 401 without credentials and the NOT_FOUND envelope with status 404 after authentication. The initial build supplies Wrangler's static asset directory. Wrangler uses local D1 and KV during development; `npx wrangler dev --local --port 8787` explicitly selects local mode if needed.

## Gallery and viewer

The signed-in gallery follows the system light/dark theme and uses window scrolling with a virtualized square grid. Search, file type, local-day/time, pin and tag filters are temporary. Refresh merges the newest page; when scrolled down, a new-files pill waits for your tap before inserting files. The gallery stays mounted behind the lazy-loaded viewer, preserving loaded pages and scroll position.

Open a cell to view its original; use arrow keys, chevrons or touch swipes to navigate. Click an image or double-tap on touch to change zoom. Escape exits zoom first, then closes; Back also closes the viewer. PDFs have authenticated Open and Download links. New images retry a missing thumbnail/original once after three seconds to allow for KV propagation. Older failures require explicit retry for originals.

For local performance testing, use an isolated local database/KV instance: synthetic files remain until you delete them. With the local server running, PowerShell 7 can prompt for the local upload token without saving it in shell history:

```powershell
$env:SMOKE_BASE_URL = 'http://localhost:8787'
$env:SMOKE_UPLOAD_TOKEN = Read-Host 'Local upload token' -MaskInput
node scripts/seed.mjs 300
Remove-Item Env:SMOKE_UPLOAD_TOKEN
```

The default count is 300; use 5000 for the larger scrolling check. The script creates unique 64×64 PNGs, four uploads at a time, and prints counts only. HTTPS targets are refused unless `--force` is explicitly supplied, since each upload consumes live KV write quota. The script never runs in CI. Part 4 measurements and test limits are recorded in [the verification report](docs/verification/part-4.md).

## Uploading

Tap the round + button to choose up to 100 PNG, JPEG, WebP, GIF or PDF files, each at most 25 MiB. On iPhone, the native Photo Library / Take Photo / Choose Files sheet appears once, followed by the normal multi-select picker. The file input opens through its native label, without a JavaScript `input.click()`. HEIC/HEIF is excluded; iOS can convert photos to JPEG for the supported picker types. A real iPhone/Safari check is still needed; local verification uses touch emulation in Edge Chromium.

On desktop, drop files anywhere in the app or paste images while focus is outside an editor. New cells appear immediately. Images get a local JPEG thumbnail (480 px longest side, quality 0.82, white background); generic photo-picker names become `screenshot-…`, and pasted images become `pasted-…`. PDF originals have no thumbnail. SHA-256 and a batched preflight skip duplicates before uploading; the server also checks duplicates.

The upload tray sits above +. Tap its summary to inspect file progress, retry failed files, cancel work or clear finished entries. Upload concurrency is three, or two for a slow/data-saving connection; hashing and thumbnail preparation share two slots. The queue waits offline and resumes on reconnect. If a session expires, sign in again to resume the same in-memory files. Closing/reloading the tab loses this queue, so an unfinished queue triggers the browser's leave-page warning. A screen wake lock is requested when supported; browsers may deny or release it, and background suspension can still interrupt work.

Network/timeouts and retryable responses have at most three retries with backoff. Daily quota exhaustion stops the queue and offers manual Retry after the quota resets. A full storage response also stops the queue. If an original succeeds but its thumbnail fails, the original remains added. When uploads are idle and the app is visible/online, a background job fills missing image thumbnails one at a time (originals up to 15 MiB, at most two attempts per image per signed-in session). A daily-limit response stops backfill for that session.

Preview URLs remain in memory for the signed-in session to hide storage propagation delays. Cancellation/clearing a local item revokes its preview; sign-out revokes all local and completed previews. Nothing in the queue is saved to browser storage. Images generally cost two KV writes, originals plus thumbnails. See [Part 5 verification](docs/verification/part-5.md) for measured behavior and limitations.

## Select, copy and manage files

Tap Select in the header or long-press a cell for half a second. On desktop, use the hover check, Ctrl/Cmd-click to toggle or Shift-click for a range. Escape/Clear, filter/search changes and successful destructive actions clear selection. The Select menu can choose loaded files by date/type, or page through everything matching the current filters up to 2,000 files. On a phone, Copy and Delete live in the bottom toolbar; + is hidden while selecting.

Copy one image, then paste into your chat. JPEG/GIF/WebP sources are converted to PNG. PDFs use Download/Open/Share. For several images, the Copy Queue copies the first immediately and offers Copy next after each paste. One by one copies separate images; One image combines them into white PNG sheets, at most six screenshots per sheet with additional size/area limits. Both modes order screenshots oldest first, regardless of selection order. The mode is remembered in `dump.copyMode`; at most two prepared entries are cached in memory. If copying is unavailable or denied, the app offers Download instead.

Download one file directly, or several as a browser-built store-only ZIP with unique names (300 MiB combined limit). Share appears only when the browser supports the actual selected Files, up to ten at once. Delete moves files to Trash immediately with a six-second Undo toast. Pin protects files from auto-delete; Tag adds/removes a normalized tag; Edit changes one file's name, note and tags. Failed mutations roll back while keeping the selection. Permanent deletion is available only for trashed files and requires confirmation.

Open Trash or Settings from the header menu. Trash supports restore, permanent delete and Empty Trash, and reports skipped duplicate restores. If permanent deletion hits the daily storage limit, the app stops; already-deleted database rows remain deleted and Part 8 orphan cleanup will handle their leftover storage. Unsubmitted files remain available. Settings shows active/Trash storage usage, auto-delete and Trash retention, build information, Sign out and Sign out everywhere. The latter invalidates other sessions immediately in the same isolate and within 30 seconds in other isolates.

Keyboard: Ctrl/Cmd+A selects loaded files, Ctrl/Cmd+C copies selected images (or the current viewer image), Delete trashes selection, / opens search, and Escape closes the innermost dialog/queue/viewer or clears selection. Viewer shortcuts also include Backspace to delete and P to pin. Dialogs trap and restore focus. See [Part 6 verification](docs/verification/part-6.md) for browser coverage and remaining Safari/device verification.

## File API and free-plan storage

Files use KV keys `f/<id>` and JPEG thumbnails `t/<id>`, with `{ size, at }` metadata. All Worker KV access goes through `worker/src/files/storage.ts`. Originals stream through FixedLengthStream and are never buffered or hashed in the Worker. Type sniffing happens before the first write; rejected types cost no KV writes. Client SHA-256 is trusted for duplicate detection only, not integrity verification.

The API supports PNG, JPEG, GIF, WebP, and PDF originals up to 25 MiB, and JPEG thumbnails up to 150 KiB. Upload-token endpoints are POST `/api/upload`, `/api/upload/check`, `/api/thumb`, and GET `/api/auth/session`. Original uploads use a raw body and require Content-Length. Optional headers are a percent-encoded X-File-Name, X-Content-Sha256, and paired X-Width/X-Height. File metadata, paginated/filterable lists, tags, statistics, settings, Trash/restore and purge routes require the full session cookie.

The 900 MB soft cap counts originals, thumbnails and Trash against KV's 1 GB free allowance. Settings are cached per isolate for 30 seconds, statistics for 60 seconds. Successful mutations adjust this isolate's cached totals immediately; other isolates and concurrent requests can temporarily see stale totals, so the cap is approximate. KV's daily read, write, delete and list quotas apply separately. Typical image uploads cost two writes, while moving to Trash and restoring cost no KV operations. Permanent deletion costs one delete for the original plus one only if a thumbnail exists. Bulk purge and Empty Trash process at most 100 files per call, with up to ten deletes in flight.

Quota exhaustion during an upload returns 429 DAILY_LIMIT. During bulk purge or Empty Trash, D1 rows are already removed; the same error is returned and the Part 8 orphan sweep will remove leftover objects later. Single-file permanent deletion still returns success if KV deletion fails. No additional delete groups are started after a quota failure. Quotas reset at 00:00 UTC (06:00 Asia/Dhaka). Remaining orphan bytes may temporarily exceed the metadata-based storage estimate.

KV reads are eventually consistent: new objects can take 60 seconds or longer to become readable from another location. A missing object returns 404 with Retry-After: 2 and no-store. Served files use long-lived private browser caching, never public caching. Originals use their id as the quoted ETag; thumbnails use id plus thumbnail size. Conditional requests and HEAD use D1 alone, saving KV reads. Range requests deliberately return the complete file with 200 and Accept-Ranges: none. KV has no public file URL.

## Local end-to-end smoke test

Start `npm run db:migrate:local` and `npm run dev:api` before the test. Use the plaintext access/upload credentials generated for that local server, not their hashes. In PowerShell, enter credentials without placing them in shell history:

```powershell
$env:SMOKE_BASE_URL = 'http://localhost:8787'
$env:SMOKE_ACCESS_KEY = Read-Host 'Local access key' -MaskInput
$env:SMOKE_UPLOAD_TOKEN = Read-Host 'Local upload token' -MaskInput
node scripts/smoke.mjs
Remove-Item Env:SMOKE_ACCESS_KEY, Env:SMOKE_UPLOAD_TOKEN
```

`-MaskInput` requires PowerShell 7. The smoke script runs against local D1/KV, prints ten PASS/FAIL steps, creates only its own synthetic files, and removes its test files and restores settings afterward. Use an isolated local instance for this test: its Empty Trash check purges existing Trash too. It exercises original streaming, deduplication, rejected uploads, JPEG thumbnails, pagination/filtering, ETags, ignored ranges, metadata edits, duplicate restore conflicts, bulk actions, settings and authentication boundaries. `scripts/lib/png.mjs` generates valid PNG test data with Node zlib and CRC32, without dependencies.

## Install on iPhone or desktop

1. After deployment, open your HTTPS Dump address in Safari on the iPhone.
2. Tap Share, then Add to Home Screen. The gallery's dismissible install hint explains the same steps.
3. Open the new Dump icon and sign in once inside it. The installed Home Screen app has its own login, separate from Safari.
4. On Chromium browsers, Settings → Install shows Install app when the browser offers an install prompt. Otherwise use the browser's install menu if available.

The app follows system light/dark styling, uses safe-area padding and keeps the specified default iOS status-bar style. Fixed upload/activity controls move above a reduced visual viewport when search is focused. Physical iPhone checks for keyboard behavior, status bar, notch/home indicator, clipboard and separate login persistence remain necessary; Chromium emulation is not an iPhone test.

## Offline shell and updates

Production builds register `/sw.js` after window load. The hand-written service worker runtime-caches only the public shell, hashed assets, icons and manifest, with a 60-entry FIFO cap. It bypasses every `/api/` request, non-GET, cross-origin and Range request. Navigations try the network for 2.5 seconds before using the cached shell. Browser caching of originals retains the private policy described above; the service worker does not cache originals, metadata or sessions.

The first visit installs the worker without a precache list. Open/reload online under its control to warm the shell before testing an offline launch. Offline launch displays anonymous placeholders and You're offline; it does not open the authenticated gallery or restore a file list. Reconnecting checks the session with the server again.

A changed service worker waits until you press Reload on the Update ready toast. Foreground update checks run at most once per ten minutes. Changes only to hashed app assets take effect on the next online load; a new-worker toast requires changed service-worker bytes. Finish uploads before accepting a reload; an in-memory queue cannot survive it. Service-worker caching is disabled in Vite development mode. Static assets remain on Workers Static Assets; no paid service was added.

Icons are committed outputs, generated independently of the build with `node scripts/make-icons.mjs`. The generator uses Node's built-in PNG/zlib primitives and 4×4 supersampling, without an image library. See [Part 7 verification](docs/verification/part-7.md) for measured results and device limitations.

## iPhone Shortcuts

Follow [the numbered Shortcut guide](docs/ios-shortcut.md) to build Dump in the Share Sheet and Dump latest screenshots for the Action Button, Back Tap or Home Screen. Settings → iPhone Shortcut supplies your current Upload URL and a collapsible checklist. Use the separate upload token from your password manager, never your sign-in key or a token hash. The token is not displayed or stored by the app; keep the configured Shortcut private and never share it through an iCloud link.

The Shortcut converts HEIC/HEIF to JPEG, URL-encodes names and sends a raw File POST. Optional SHA256 enables duplicate detection; missing thumbnails are backfilled when the web app is open. The guide includes a token test, rotation commands and the HTTP troubleshooting table. Actual Shortcut execution and File-body Content-Length must be verified on an iPhone after deployment.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

The build enforces initial gzip budgets of 40 KB JS and 10 KB CSS (1024 bytes per KB), excluding lazy chunks not referenced by the built HTML. `npm test` runs the authentication, crypto, session, route coverage, storage interface, and security-header unit tests. For a production-CSP preview, build and open http://localhost:8787; Vite's development server intentionally injects development tooling and is not the production-CSP test target.

The scheduled handler is intentionally empty until Part 8. The daily trigger is 21:00 UTC (03:00 Asia/Dhaka the following day).

## Security model and rotation

The static HTML, JavaScript, and CSS are public and contain no personal data or credentials. All data routes live behind `/api/*`. ACCESS_KEY is a randomly generated 256-bit sign-in key; only its SHA-256 hash is stored as ACCESS_KEY_HASH. Plain SHA-256 is appropriate for this high-entropy key and avoids slow password hashing on the free Worker CPU budget. The browser never saves the key to web storage or a URL.

Successful sign-in sets a server-issued HttpOnly, SameSite=Strict cookie. HTTPS uses `__Host-dump_session` with Secure and no Domain; local HTTP uses `dump_session` without Secure. Sessions slide for 30 days, renew only below 15 days remaining, and have a hard 180-day lifetime from original login. Cookie mutations require `x-dump-client: 1` and Origin/fetch-site checks; bearer requests do not use ambient cookies and skip CSRF checks. There is no CORS access.

UPLOAD_TOKEN_HASH verifies the separate upload-only token used by an iPhone Shortcut. In Part 2 this token can only check `/api/auth/session`; Part 3 adds upload routes. A bearer header always takes precedence over a cookie, including an invalid bearer header. A valid bearer token never reads D1 to authenticate. Invalid login attempts are limited per hashed IP to five per 15-minute window. Invalid bearer attempts have a separate ten-failure noise limiter; a valid bearer token is always accepted within its scope. No raw IPs or credentials are logged.

SESSION_SECRET signs cookies. Each session embeds the D1 `session_epoch`. Signing out everywhere increments this epoch; it takes effect immediately in the current isolate and within 30 seconds in other isolates due to the epoch cache. Ordinary Logout only removes this browser's cookie; a copied stateless cookie can remain valid until expiry or epoch/secret rotation.

Unauthenticated requests to every non-public `/api/*` path, including nonexistent routes, return 401 rather than revealing route existence. Authenticated unknown routes and unsupported methods such as OPTIONS return the 404 envelope after the normal gate/CSRF checks. No CORS headers are sent. Public unsafe routes, including login and logout, also require the CSRF header.

Rotation commands print the new credential, if applicable, plus exactly the matching `wrangler secret put` command. Save ACCESS_KEY or UPLOAD_TOKEN in your password manager before leaving your terminal:

```sh
node scripts/generate-secrets.mjs --only=access
node scripts/generate-secrets.mjs --only=upload
node scripts/generate-secrets.mjs --only=session
```

Use `--only=access` if the sign-in key is forgotten, `--only=upload` if a Shortcut leaks, and `--only=session` to invalidate every existing login after a device is lost or stolen. Run only the command for the credential you intend to rotate, then run its printed `npx wrangler secret put ...` command and paste the value. Rotating the access key alone does not invalidate existing cookies. Update the upload token inside your Shortcut after rotating it.

For local rotation, append `--write-dev-vars`; it replaces only the selected value and preserves the other two secrets. Without `--only`, all three are generated. Plaintext access/upload keys are never written to `.dev.vars`. Never commit `.dev.vars`, `.env` files, keys, or tokens; only empty example templates belong in Git.

Sign out everywhere from Settings, or issue this same-origin request while signed in (for example in the browser's developer console):

```js
fetch('/api/auth/logout-all', { method: 'POST', headers: { 'x-dump-client': '1' }, credentials: 'same-origin' })
```

On iPhone, the installed Home Screen app has its own cookie jar, separate from Safari. Sign in once inside the installed app. The app never creates session cookies through JavaScript.
