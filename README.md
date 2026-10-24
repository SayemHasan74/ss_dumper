# Dump

Private, single-user file dump served by one Cloudflare Worker with Workers Static Assets, private Workers KV file storage, and D1 metadata. Parts 1–4 provide the foundation, secure sign-in, authenticated file API, virtualized gallery, filters/search and full-screen image/PDF viewer. Upload UI arrives in Part 5; selection, copying and file actions arrive in Part 6.

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

Until the Part 6 UI exists, sign out everywhere by issuing this same-origin request while signed in (for example in the browser's developer console):

```js
fetch('/api/auth/logout-all', { method: 'POST', headers: { 'x-dump-client': '1' }, credentials: 'same-origin' })
```

On iPhone, the installed Home Screen app has its own cookie jar, separate from Safari. Sign in once inside the installed app. The app never creates session cookies through JavaScript.
