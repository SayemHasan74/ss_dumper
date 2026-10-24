# Dump

Private, single-user file dump served by one Cloudflare Worker with Workers Static Assets, private Workers KV file storage, and D1 metadata. Parts 1 and 2 provide the foundation and secure sign-in. File operations arrive in later parts.

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

## Storage constraints for later parts

Files will use KV keys `f/<id>` and thumbnails `t/<id>`, with `{ size, at }` metadata. All Worker KV access will be implemented through `worker/src/files/storage.ts` in Part 3. The revised design uses a 900 MB soft cap, counting originals, thumbnails, and Trash, below KV's 1 GB free allowance. KV limits values to 25 MiB; its read, write, delete, and list quotas must also be respected. Reads are eventually consistent, so new files can take 60 seconds or longer to become readable from another location. KV has no built-in file checksum verification or Range reads. The later storage implementation must account for these differences.

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
