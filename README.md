# Dump

Private, single-user file dump served by one Cloudflare Worker with Workers Static Assets, private Workers KV file storage, and D1 metadata. Part 1 contains the foundation and a minimal Dump page. Authentication and file operations arrive in later parts.

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

Open http://localhost:5173. Vite proxies `/api` to Wrangler on port 8787. `/api/health` returns `{"ok":true}` and `/api/nope` returns the JSON NOT_FOUND envelope with status 404. The initial build supplies Wrangler's static asset directory. Wrangler uses local D1 and KV during development; `npx wrangler dev --local --port 8787` explicitly selects local mode if needed.

## Storage constraints for later parts

Files will use KV keys `f/<id>` and thumbnails `t/<id>`, with `{ size, at }` metadata. All Worker KV access will be implemented through `worker/src/files/storage.ts` in Part 3. The revised design uses a 900 MB soft cap, counting originals, thumbnails, and Trash, below KV's 1 GB free allowance. KV limits values to 25 MiB; its read, write, delete, and list quotas must also be respected. Reads are eventually consistent, so new files can take 60 seconds or longer to become readable from another location. KV has no built-in file checksum verification or Range reads. The later storage implementation must account for these differences.

## Checks

```sh
npm run typecheck
npm run build
```

The build enforces initial gzip budgets of 40 KB JS and 10 KB CSS (1024 bytes per KB), excluding lazy chunks not referenced by the built HTML. `npm test` invokes Vitest; Part 1 does not add a persistent test suite.

The scheduled handler is intentionally empty until Part 8. The daily trigger is 21:00 UTC (03:00 Asia/Dhaka the following day).
