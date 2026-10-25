# Accepted Part 8 follow-up: Cloudflare deployment

Deployed on 25 October 2026 with the owner's explicit permission, overriding the earlier do-not-deploy instruction. No features or maintenance budgets changed.

- Live URL: https://dump.sayemhasan74.workers.dev
- One Cloudflare Worker (`dump`) serves both the frontend and API; no other host is used.
- Reused the already-created, remotely verified `dump-files` KV namespace and `dump-db` D1 database. Their IDs already matched `wrangler.toml`; no duplicate resources were created.
- Set `ACCESS_KEY_HASH`, `UPLOAD_TOKEN_HASH` and `SESSION_SECRET` sequentially after the owner confirmed saving the access/upload credentials. Values are excluded from this report and Git.
- `npm run deploy` built the app, applied `0001_init.sql` remotely and deployed assets, the Worker and its daily cron.
- Registered the free account subdomain `sayemhasan74.workers.dev` because the first publishing attempt found none. Initial TLS handshake failures cleared after hostname/certificate propagation; tests then used verified HTTPS normally.
- Deployment version: `4176fdd4-b050-490a-b759-4ec5c7e6d0a1`.
- No command requested a credit card or paid subscription. Account billing history/payment methods were not independently audited.

## Checks

- `npm run typecheck`: passed.
- `npm test`: 18 test files, 95 tests passed, plus the static security audit.
- `npm run build`: passed; initial JS gzip 32,546 / 40,960 bytes; CSS gzip 7,651 / 10,240 bytes.
- Production `scripts/smoke.mjs --prod`: passed using the saved credentials without printing them. Logged in, uploaded one unique tiny PNG, listed and fetched it, then trashed and permanently deleted only that fixture. No settings changes or Empty Trash.
- Verified HTTPS shell CSP, HSTS, nosniff, frame denial and referrer-policy headers.
- Anonymous original request: HTTP 401 with `Cache-Control: no-store`.
- README, Settings storage note and DECISIONS describe separate 1,000/day write/delete/list allowances, 00:00 UTC = 06:00 Dhaka reset and about 500 original-plus-thumbnail uploads before retries/backfill.

## Phone checklist (owner testing)

- Open the live URL in Safari and sign in with the saved ACCESS_KEY.
- Add to Home Screen, open the installed app and sign in again if asked.
- Upload three screenshots and check their thumbnails and originals.
- Copy one screenshot and paste into another app; check Share/Download fallback if clipboard access is denied.
- Test selection, Copy next and One image; test Delete then Undo using only test files.
- Configure the documented iPhone Shortcut with the saved UPLOAD_TOKEN, upload a screenshot and check it appears on desktop.
- Check rotation, notch/home-indicator spacing, keyboard behavior and sign-in persistence.
- Sign out everywhere and confirm the other device loses access within 30 seconds.

These phone behaviors require physical-device testing; the HTTPS smoke test does not establish Safari/Home Screen behavior.

## iPhone batch-upload memory fix, 25 October 2026

- Reported symptom: a 66-photo upload added only some files, followed by an apparent page reload and loss of the pending queue.
- Found eager original-file preview URLs feeding both the virtual gallery and expanded upload tray, allowing many large image decodes outside bounded thumbnail preparation. This is a concrete memory hazard consistent with the symptom, not a confirmed physical-device crash diagnosis.
- Removed original preview URLs. Queued files use placeholders until their small JPEG thumbnails are prepared. Original upload bodies are unchanged; fallback thumbnail Image handlers/source are released explicitly.
- A 66-file regression fails against the previous queue implementation and passes with the fix, verifying all 66 complete, all preview URLs refer to thumbnail blobs and all upload bodies are the original File objects.
- Typecheck and all 96 tests passed; deployment build and bundle budgets passed (JS gzip 32,562 / 40,960 bytes, CSS gzip 7,651 / 10,240 bytes).
- The first remote migration check hit transient Cloudflare error 7403. A sequential retry succeeded, with no migrations needed; no schema, quotas, retention settings or user files were changed.
- Deployed version `d32be7bc-94e4-4892-ae3f-d7911e20fd72`; HTTPS production smoke passed, including cleanup of only its own fixture.
- Owner retry: reload the app once before selecting files, then retry the 66-photo selection while keeping the app open. Byte-identical files already stored are skipped by existing duplicate detection. Physical iPhone verification remains pending.

## Total photo count, 25 October 2026

- Added Total photos above the gallery: all active images, excluding PDFs, pending uploads and Trash, independent of pagination and filters.
- Extended the existing cached stats query and mutation adjustments; no new KV operations or database migrations. Fetches after uploads/actions settle rather than polling or fetching per upload.
- SQLite regression checks zero photos, 70 images beyond one gallery page, PDF/Trash exclusion and moving images into/out of Trash.
- All 97 tests and typecheck/build budgets passed. Deployed version `d19dc80f-0cd3-4e65-b6fa-a64d80b03c32`.
- Production safe smoke, photo-count response validation and current frontend bundle check passed.
