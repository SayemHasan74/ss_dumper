# Dump

## What it is

Dump is a private, single-user screenshot and file inbox. Upload on your phone, then copy, download or manage the same files from any browser. It supports PNG, JPEG, WebP, GIF and PDF; no registration, sharing or public file links.

## Architecture in 6 lines

1. One Cloudflare Worker serves the Preact app and authenticated Hono API.
2. Workers Static Assets hosts the public, data-free HTML/JS/CSS shell.
3. D1 (`DB`) stores metadata, tags, settings and authentication counters.
4. Private Workers KV (`FILES`) stores originals and client-generated thumbnails.
5. A server-issued HttpOnly cookie provides long-lived browser sign-in; a separate token permits uploads only.
6. Cron runs bounded maintenance; the service worker caches only the public shell and static assets.

## First-time setup and deployment

Use a **free Cloudflare account, no card, no R2**. Stay on Workers Free; stop if any command requests a paid subscription or payment method. Use Node **22.12+** and npm (the pinned toolchain requires it; verified locally on Node 24.20.0). CI uses Node 22. No deployment runs in CI.

Run these commands yourself, in order, from this repository. Deployment was deliberately not performed by the implementing agent.

```powershell
npm install
npx wrangler login
npx wrangler kv namespace create FILES
npx wrangler d1 create dump-db
```

Paste the returned namespace and database IDs into `wrangler.toml`, retaining bindings `FILES` and `DB`. **For the existing project account, `dump-files` and `dump-db` are already created and configured: skip the two create commands and verify those IDs instead.** `FILES` is the binding name; the dashboard namespace may be called `dump-files`.

```powershell
node scripts/generate-secrets.mjs --write-dev-vars
```

Save ACCESS_KEY and UPLOAD_TOKEN in a password manager immediately. They cannot be recovered. The script prints the three secret values to enter below; `.dev.vars` contains only their hashes and SESSION_SECRET. Do not regenerate existing credentials casually: this command creates new ones.

```powershell
npx wrangler secret put ACCESS_KEY_HASH
npx wrangler secret put UPLOAD_TOKEN_HASH
npx wrangler secret put SESSION_SECRET
npm run deploy
```

Enter each corresponding generated value at its prompt. `deploy` builds, checks budgets, applies remote migrations and deploys the Worker plus assets. If Wrangler asks to create the not-yet-deployed Worker while setting secrets, allow creation of this free Worker. Open the HTTPS URL printed by Wrangler, normally `https://dump.<your-subdomain>.workers.dev`.

Verify the live app with the safe smoke subset, using **PowerShell 7** masked prompts (these keep credentials out of command history):

```powershell
$env:SMOKE_BASE_URL = 'https://<your-worker-url>'
$env:SMOKE_ACCESS_KEY = Read-Host 'Access key' -MaskInput
$env:SMOKE_UPLOAD_TOKEN = Read-Host 'Upload token' -MaskInput
node scripts/smoke.mjs --prod
Remove-Item Env:SMOKE_ACCESS_KEY, Env:SMOKE_UPLOAD_TOKEN, Env:SMOKE_BASE_URL
```

The production test logs in, uploads one unique tiny PNG, lists/fetches it and trashes/purges **only that file**: about three KV operations (write, read, delete). It never changes settings or empties existing Trash. HTTPS without `--prod` is refused. A just-written file may require retrying after propagation; failed fixture cleanup is reported. Never commit `.dev.vars`, `.env`, local state, credentials or backups.

## Local development

Generate local secrets with `node scripts/generate-secrets.mjs --write-dev-vars` and keep their plaintext keys in your password manager. Then:

```powershell
npm run build
npm run db:migrate:local
npm run dev
```

Open http://localhost:5173. Vite proxies the API to Wrangler on 8787. Local D1 and KV are simulated on disk in `.wrangler/state`; no remote data or quota is used. For the production build/CSP preview, use http://localhost:8787 after building. `npm run dev:api` includes `--test-scheduled`.

```powershell
npm run typecheck
npm test
npm run build
```

With the local server running, set the three smoke variables and run the API and maintenance suites:

```powershell
$env:SMOKE_BASE_URL = 'http://localhost:8787'
$env:SMOKE_ACCESS_KEY = Read-Host 'Local access key' -MaskInput
$env:SMOKE_UPLOAD_TOKEN = Read-Host 'Local upload token' -MaskInput
npm run test:smoke
npm run test:maintenance
Remove-Item Env:SMOKE_ACCESS_KEY, Env:SMOKE_UPLOAD_TOKEN, Env:SMOKE_BASE_URL
```

**Use an isolated local dataset:** the full API suite tests Empty Trash; maintenance expires/purges eligible existing rows. Both clean up their synthetic fixtures and restore settings. Maintenance is refused for non-loopback/HTTPS servers. Wait 60 seconds between manual cleanup runs. Optional `SMOKE_WRANGLER_CONFIG` and `SMOKE_PERSIST_TO` let its CLI fixtures share an isolated server's config/state. On Windows the script executes the installed Wrangler Node entrypoint with an argument array, avoiding a shell around `npx.cmd`.

`node scripts/seed.mjs 1000` uploads synthetic PNGs to the local server using SMOKE_UPLOAD_TOKEN; default count is 300. Never seed a live free-plan namespace. The seed utility refuses HTTPS unless explicitly passed `--force`. Tests use no credentials in CI. Unit tests cover worker security/storage/maintenance and frontend pure planning functions; the source check enforces centralized JSON parsing and the storage boundary.

## Use it from any device

Open the same HTTPS address on your phone, Mac or Windows browser. Sign in once per browser with ACCESS_KEY; the server renews the login for weeks, up to a 180-day absolute lifetime. Keep your key and upload token in a password manager. They are never placed in browser storage or URLs.

## Install on iPhone

Open the address in Safari → Share → Add to Home Screen. Open the new Dump icon and **sign in once inside the installed app**; iPhone uses a separate login from Safari. Desktop browsers may offer Install app in Settings or their own install menu.

The first visit installs the service worker; reload online under its control to warm the public shell before an offline launch. Offline startup shows anonymous skeletons and “You're offline”, without restoring private files. Reconnection checks authentication again. Changed service-worker bytes produce an Update ready → Reload toast; app-only hashed-asset changes load on the next navigation. Finish uploads before reloading: queued files live only in memory.

## Share-sheet upload

Follow [the complete iPhone Shortcut guide](docs/ios-shortcut.md) for Share Sheet and latest-screenshots shortcuts. Settings supplies the Upload URL and checklist. Use UPLOAD_TOKEN with `Authorization: Bearer <token>`, raw File body, an encoded filename and optional SHA-256 of the actual uploaded bytes. Convert HEIC/HEIF to JPEG first. Keep the configured Shortcut private. Shortcut originals receive thumbnails after the app next opens and backfill runs.

## Daily use

- Tap **+** and choose up to 100 supported files, at most 25 MiB each. Desktop also supports drop and paste outside editors. iOS includes its normal extra picker tap.
- Thumbnails appear immediately. Preparation has two slots and uploads have three (two on slow/data-saving connections); retry, cancel and progress are in the upload tray. Offline queues wait; closing the tab loses unfinished files. Keep the app open while uploading.
- Filter by name, date, file type, pin or tag. Scrolling uses a virtualized grid; refresh merges new files while preserving older pages. The new-files pill lets you choose when to insert items while scrolled down.
- Open a file for its original. Use arrows/swipes, zoom/pan or open/download PDFs. Back/Escape closes the viewer.
- Tap **Select**, long-press a cell, or use desktop Ctrl/Cmd-click and Shift-click. Select loaded items or Everything matching (up to 2,000).
- **Copy** one screenshot and paste into a chat. Multiple images use Copy next, one clipboard image at a time. “One image” combines chronological screenshots into white PNG sheets (up to six per sheet, with canvas size limits). The browser cannot put several independent images into most destination apps in one paste.
- Download one original or a ZIP of selected files up to 300 MiB combined. Share appears only when the browser can share those actual files (up to ten).
- Delete moves to Trash with a six-second Undo. Trash offers Restore, confirmed permanent deletion and Empty Trash. Pin excludes a file from auto-expiration; Edit and Tag change metadata.

Images use client-generated JPEG thumbnails (longest side 480, quality .82, white background). Backfill runs only while visible/online and idle, for images up to 15 MiB, at most two attempts per image per session. No images are processed in the Worker.

## Settings explained

Storage includes active originals, thumbnails and Trash against the 900 MB soft cap. Counts can lag across isolates for 60 seconds; orphan bytes are not represented until cleaned. Auto-delete moves unpinned files to Trash after the selected upload age; Never disables it. Trash retention permanently purges after the selected period. Run cleanup now uses the same bounded job as cron and displays its counts. Security provides this-browser sign-out and Sign out everywhere.

## Security model and rotation

The static shell is public and contains no files or credentials. Every data route is authenticated; no CORS headers are emitted. ACCESS_KEY is 256 random bits, verified with SHA-256. Cookies are HMAC-SHA256 signed, HttpOnly, SameSite=Strict, Secure and `__Host-` prefixed on HTTPS. Local HTTP uses a separate cookie. Sessions slide 30 days, renew below 15 days remaining and stop at 180 days. JavaScript never stores the session.

Cookie mutations require `x-dump-client: 1`, with Origin and fetch-site checks. Cross-site reads are rejected. Upload bearer authentication takes precedence over cookies and allows only upload/check/thumb and session scope checks. It cannot read/list/delete files or trigger maintenance. Login failures are limited to five per 15 minutes per hashed IP; bearer noise has its own limiter. No raw IPs, file names, keys, tokens or cookies are logged. Generic 500s expose no SQL, keys or stacks.

Sign out clears the cookie and sends `Clear-Site-Data: "cache"` (ignored by unsupported browsers). A copied stateless cookie remains valid until expiration or epoch/secret rotation. Sign out everywhere advances a D1 epoch, immediately here and within 30 seconds in other isolates. It does not revoke the separate upload token. Rotate only the credential you mean to change:

```powershell
node scripts/generate-secrets.mjs --only=access
node scripts/generate-secrets.mjs --only=upload
node scripts/generate-secrets.mjs --only=session
```

Run just the appropriate command and its displayed `wrangler secret put` command. Save the new access/upload credential; update Shortcuts after token rotation. Access-key rotation alone does not revoke cookies; session-secret rotation does. Append `--write-dev-vars` for matching local rotation; it preserves the other two values. No flag rotates all three. Without `--write-dev-vars` nothing is saved locally.

JSON request limits are centralized in `worker/src/limits.ts`: login/settings 1 KiB, patch 4 KiB, duplicate check 8 KiB, bulk 16 KiB. Original bodies stream to KV; only thumbnails up to 150 KiB are buffered. All SQL values are bound; dynamic SQL contains only internal clauses. File names reach Content-Disposition via ASCII fallback and percent-encoding, and file responses have private caching, ETags, no ranges and a restrictive sandbox policy for images/thumbs.

### Verify storage privacy after deploying

- Files live **only in the private KV namespace bound as FILES**. KV has no public URL or public-access toggle. Check the configured namespace ID in the dashboard, not its display name alone.
- Confirm `wrangler.toml` has no `r2_buckets` or other paid-product bindings. Only authenticated `/api/files/:id/original` and `/api/files/:id/thumb` serve file bytes. No `/f/` or `/t/` handler exists on workers.dev, routes or custom domains.
- Run `npm test`: route coverage denies anonymous access and upload-token reads on every registered private route, including maintenance. Unknown and OPTIONS methods get the 404 envelope after authentication/CSRF; anonymous unknown API paths stay 401 to hide route existence.
- Without credentials, `curl.exe -i https://<your-worker-url>/api/files/<file-id>/original` must return 401, no-store and no file data. A request to `/f/<id>` or `/t/<id>` may return the public SPA shell, never the stored object.
- Inspect response headers on the deployed login/gallery/viewer/trash/settings: CSP, nosniff, Referrer-Policy, frame denial, HSTS, same-origin policies, noindex and asset caching must match `web/public/_headers`. API security headers are set in middleware. Local preview checks pass; live headers require your post-deploy verification.

Optional domain-only hardening (not required, no card): in Cloudflare choose your zone → Security → WAF / Security rules → Rate limiting rules → Create rule, filter URI Path equals `/api/auth/login`, and choose an available free-plan action/threshold. Dashboard labels can vary; skip if your account requests an upgrade. After a custom domain is working, set `workers_dev = false` and redeploy, or Compute → Workers & Pages → dump → Settings → Domains & Routes → disable workers.dev. Keep workers.dev enabled if it is your only URL.

## Limits and costs

Products: **Workers**, **Workers Static Assets** (`ASSETS`), **D1** (`DB`), **Workers KV** (`FILES`), **Cron Triggers**, **Workers Observability**. All have free-plan allowances; no payment method or paid product is configured. No R2, Queues, Images, Stream or Durable Objects binding/dependency is used. Your account/payment-method state must be checked by you in the dashboard.

Cloudflare currently includes 1 GB KV storage, 100,000 reads/day, and **1,000 writes/day, 1,000 deletes/day and 1,000 list requests/day separately**, resetting at 00:00 UTC = **06:00 Dhaka**. The spec's shared mutation counter is retained as a conservative maintenance budget, not a claim that Cloudflare combines these quotas. About 400 image uploads/day is a practical estimate allowing retries/backfill (usually two writes per image), not a guaranteed allowance. The app uses a 900,000,000-byte approximate soft cap and a 25 MiB original limit, not 25 decimal MB.

Workers Free includes 100,000 dynamic requests/day and a 10 ms CPU allowance per invocation; static asset requests are free/unlimited under current pricing. D1 Free includes 5 million rows read/day, 100,000 rows written/day and 5 GB total storage. Search/tag/pin/type filtering may inspect more rows than returned; date/cursor filters use indexed ULID ranges. Large metadata totals and maintenance can still consume D1/CPU quotas. Local timing is evidence for this machine, not a promise about Cloudflare CPU or remote network latency.

At the soft storage cap, uploads fail with 507 STORAGE_FULL: empty Trash or remove files. KV quota failures return 429 DAILY_LIMIT; wait until 06:00 Dhaka and retry. Free-plan exhausted operations fail rather than enabling paid usage. Bulk purge deletes metadata first, so quota-failed objects are recovered by a later orphan sweep; single permanent delete reports success and also relies on that sweep. No forced deletion of active files occurs to free space.

Sources: [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

### KV operation table

| Endpoint/action | KV operations |
| --- | --- |
| POST upload, new original | 1 write (DB failure may add 1 cleanup delete) |
| POST upload, detected duplicate | 0 |
| POST thumb | 1 write |
| GET original/thumb | 1 read, or 0 on ETag 304 |
| HEAD original/thumb | 0 |
| List/search/check/stats/tags/settings, pin/edit | 0 |
| Move to Trash / restore | 0 |
| Permanent delete / bulk purge / Empty Trash | 1 delete per original, plus 1 only when a thumbnail exists |
| Maintenance | At most 250 combined deletes/list pages; up to 4 pages |

## Backup

Metadata export (private: keep outside the public repository):

```powershell
npx wrangler d1 export dump-db --remote --output=backup.sql
```

For originals, use Select → Everything matching → Download; split selections so each ZIP is at most 300 MiB. This covers the current filters/collection and max 2,000 selected items, so back up additional ranges and Trash separately. D1 export alone does **not** back up file bytes.

For a complete low-level file backup, page through KV keys and get each value (these consume live read/list quotas); keep metadata beside each file if planning restoration:

```powershell
npx wrangler kv key list --namespace-id=<namespace-id> --remote
npx wrangler kv key get --namespace-id=<namespace-id> --remote 'f/<file-id>' > original.png
```

Use PowerShell 7.4+ for binary-preserving stdout redirection in the get command (older PowerShell can corrupt binary output). Installed Wrangler has no --output flag for kv key get. Consult installed `--help` for pagination flags before automating backups. Backups contain private data; never commit them.

## Maintenance

Cron `0 21 * * *` runs daily at **03:00 Dhaka**. Settings → Run cleanup now invokes the same idempotent job (one manual run per minute per isolate). It expires unpinned files, purges expired Trash, sweeps old orphan objects/repairs orphaned thumbnail metadata, and removes old login counters. Fresh objects are protected for one hour; foreign keys are ignored.

Each run reserves at most 400 D1/KV operations and 250 combined KV deletes/list pages before calls. D1 batch statements count individually. Reservations may overcount when a concurrent restore avoids deletion or quota stops a delete group. Cursor advancement happens only after a complete orphan page; unfinished pages replay safely next time. A quota result stops both KV steps while D1 login cleanup continues. These are per-run caps, **not a global daily scheduler**: repeated manual runs can consume remaining daily allowance. Avoid repeated cleanup runs.

Test the cron on your local server (no credentials needed for Wrangler's local-only test endpoint):

```powershell
curl.exe 'http://localhost:8787/__scheduled?cron=0+21+*+*+*'
```

Structured maintenance events contain only counts/budget flags or a fixed step name. No object keys are logged. Cron changes may take time to propagate after deployment.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Login rate limited | Wait 15 minutes; verify the plaintext key in your password manager. |
| Local HTTP login fails after HTTPS use | Clear the stale `__Host-` cookie; use the HTTP-local cookie and matching origin. |
| Installed iPhone app asks to log in again | Normal: its cookies are separate from Safari. |
| Missing thumbnails after a Shortcut upload | Open the app online and leave it idle for backfill. Large originals above 15 MiB need a browser upload with a thumbnail. |
| New file briefly 404s on another device | Wait a minute and retry; KV propagation can take 60 seconds or longer. |
| Copy denied/unavailable | Grant clipboard permission or use Download/Share; an OS may still block image clipboard access. |
| DAILY_LIMIT | Wait until 06:00 Dhaka; manually retry. |
| STORAGE_FULL | Delete unwanted files and empty Trash, allowing propagation/cleanup. |
| Shortcut 401 | Use the plaintext upload token, one space after Bearer; check rotation. |
| Shortcut 403 | Upload tokens cannot list/read/manage data; use the upload endpoint and correct token scope. |
| Shortcut 411 | Request Body must be File with a valid Content-Length; do not use JSON/Form/Base64. Verify on the real iPhone. |
| Cleanup asks you to wait | Only one manual run per 60 seconds in this isolate. |
| Offline first launch fails | Warm the shell online first; private files are never restored by the service worker. |

## Post-deployment checklist (real devices)

- [ ] iPhone Safari: open URL, sign in, Add to Home Screen; open the installed app and sign in again; tap +, upload three screenshots and see thumbnails.
- [ ] Desktop Chrome: sign in, see those three screenshots, Copy one and paste into a chat.
- [ ] Select all three, Copy and step through Copy next; switch to One image and paste the combined sheet.
- [ ] Select all, Delete, Undo; move unwanted test files back to Trash and Empty Trash after reviewing its contents.
- [ ] Shortcut A: share a screenshot in Photos → Dump; refresh desktop and confirm the original and eventual thumbnail.
- [ ] Sign out everywhere; confirm another device loses access within 30 seconds.
- [ ] Dashboard: verify the configured KV namespace/binding, no R2 bucket and no payment method.
- [ ] On iPhone copy a screenshot inside the installed app and paste into a chat app; verify Share/Download fallback when denied.
- [ ] Verify deployed static/API response headers and unauthenticated original returns 401.
- [ ] Verify notch/home-indicator padding, rotations, status bar, native keyboard, permission prompts and install/login persistence.

## Project layout

`worker/src` contains auth, file API/storage and maintenance. `shared` contains DTO types. `web/src` contains Preact views, virtual gallery, upload/copy pipelines and PWA helpers. `web/public` contains headers, manifest, hand-written service worker and generated icons. `migrations` is the D1 schema. `scripts` contains key generation, build/security checks, icon generation, seed and smoke utilities. `worker/test` and `web/test` contain unit tests. `.github/workflows/ci.yml` performs checks without deployment/secrets. Build output, node_modules, local state and env files are ignored.

## Spec history and verification

[Part 1](docs/spec/part-1.md), [Part 2](docs/spec/part-2.md), [Part 3](docs/spec/part-3.md), [approved quota amendment](docs/spec/part-3-amendment.md), [Part 4](docs/spec/part-4.md), [Part 5](docs/spec/part-5.md), [Part 6](docs/spec/part-6.md), [Part 7](docs/spec/part-7.md), [Part 8](docs/spec/part-8.md). Choices and deviations are in [DECISIONS.md](DECISIONS.md). Measurements and limitations: [Part 4](docs/verification/part-4.md), [Part 5](docs/verification/part-5.md), [Part 6](docs/verification/part-6.md), [Part 7](docs/verification/part-7.md), [final Part 8 report](docs/verification/part-8.md).
