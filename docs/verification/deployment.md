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
