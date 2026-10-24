You are the implementing engineer. I am sending the full spec in 8 parts. Each part is a milestone. Rules:
1. FIRST ACTION: save this entire message verbatim to docs/spec/part-1.md. Do the same for every later part (part-2.md, ...). Before starting any part, re-read all earlier spec files.
2. Implement ONLY the current part. Do not start features from later parts. Do not leave TODOs, stubs, mocks, or fake data for things belonging to the current part.
3. Follow every decision exactly. Do NOT substitute libraries, rename endpoints, restructure folders, or "improve" the design. If something is unspecified, choose the simplest option that satisfies the spec and log it as one line in DECISIONS.md (what + why). Only stop and ask me if the spec contradicts itself or is impossible; then state the contradiction and your proposed fix.
4. Dependencies: ONLY those in the allowlist in section 3. Anything else needs my approval.
5. Code quality: TypeScript strict, no any, no commented-out code, no dead code. NEVER log secrets, keys, tokens, cookies, or file names.
6. When finished with a part: run npm run typecheck and npm run build, fix every error, then report: (a) files created/changed, (b) commands I must run, (c) deviations from spec, (d) acceptance checklist with pass/fail for each item.
7. FREE PLAN, NO CARD: this project must run entirely on Cloudflare's free plan with NO credit card and NO paid product. Never add a binding, product, or dependency that requires a payment method (this is why R2, Queues, Images, Stream, and Durable Objects are NOT used). If a command or wrangler prompt asks you to enable a paid product or add a card, stop and tell me.
8. WHEN THE SPEC IS UNSURE ABOUT A PLATFORM DETAIL (for example a wrangler flag name or a workers-types signature): check the installed tool (npx wrangler <cmd> --help, the installed type definitions), adapt to what is really installed, and log one line in DECISIONS.md. Do not stop for this.
"Dump" is a private, single-user, universal file dump (name used everywhere: "Dump"). I take screenshots on my iPhone (repos, certifications, etc.), upload them in one tap-flow, then open the same app on my Mac/Windows PC (or any other browser, anywhere), see a fast thumbnail grid, and copy / download / delete them (usually to paste into an AI chat). It must feel instant, like a native folder, not like a cloud drive.
- One user only. No registration, no sharing, no public links, no multi-tenant logic.
- Clients: the same web app on iPhone (installed as a PWA on the Home Screen), Mac, and Windows, and any other browser.
- Files: mostly PNG/JPEG screenshots, sometimes PDFs (certificates).
My daily flow (this decides every unspecified detail; when in doubt, optimise for it):
1. On my phone I open the hosted app, tap the big + button, pick screenshots from the photo library, and I am done. Thumbnails appear immediately and the upload finishes in the background.
2. Later, on any device and from anywhere, I open the same URL, sign in once (the browser stays signed in for weeks), and see everything.
3. COPY is the most important feature, not download. I select one OR MANY files, press Copy, and paste into whatever I am typing in (an AI chat, a document, a message). Copying must be one tap/click for one image, and fast and obvious for many images.
4. Deleting must be effortless: select, Delete, with an Undo toast. No confirmation dialogs for moving to Trash.
Priority order when two requirements compete: (1) copy and upload feel instant and reliable, (2) delete is easy and safe (Undo), (3) works from any device, (4) free plan and no credit card, (5) small and low-resource, (6) everything else.
- ONE Cloudflare Worker serves everything: the static frontend (Workers Static Assets) AND the API under /api/*.
- Files live in a PRIVATE Cloudflare Workers KV namespace (binding FILES). KV has no public URL, so files are only reachable through authenticated Worker routes. Original files are stored under key f/<id> and thumbnails under t/<id>.
- Metadata lives in Cloudflare D1 (binding DB).
- Thumbnails are generated CLIENT-SIDE (canvas -> JPEG; iOS Safari cannot encode WebP, so JPEG is used everywhere) and uploaded alongside the original. The server never processes images.
- Same-origin only. No CORS headers anywhere. No third-party requests from the frontend (no CDNs, no analytics, no web fonts).
- Worker CPU budget: every request must stay under 10 ms CPU (free plan). Therefore: no PBKDF2/bcrypt/scrypt, no image processing, no hashing of file bodies, no large JSON building, no unbounded queries, no buffering of whole files in memory.
- The deployed URL is https://dump.<your-subdomain>.workers.dev (via workers_dev = true). It works from any browser on any network. A custom domain is optional and never required.
These facts come from Cloudflare's documentation. Every storage decision in this spec follows from them. If the installed wrangler or @cloudflare/workers-types disagrees with a fact, adapt to reality and log one line in DECISIONS.md.
Every KV key has metadata { "size": <bytes>, "at": <epoch ms of creation> } written in the same put (Part 3). Maintenance (Part 8) relies on it.
- Language: TypeScript (strict) everywhere. Node 20+, package manager: npm.
- Backend: Hono (only runtime dependency of the Worker).
- Frontend: Vite + Preact + @preact/signals + Tailwind CSS v4 (via @tailwindcss/vite). No router library (hash routing written by hand in Part 4). No UI kit, no icon library (inline SVG only), no date library (use Intl).
- Lazy-loaded only in Part 6: fflate (ZIP). Not installed now.
- Dev dependencies allowed: wrangler, typescript, @cloudflare/workers-types, vite, @preact/preset-vite, tailwindcss, @tailwindcss/vite, concurrently, vitest.
- Runtime deps total allowed: hono, preact, @preact/signals (+ fflate later). Nothing else.
```
dump/
  package.json
  wrangler.toml
  tsconfig.json              (frontend)
  tsconfig.worker.json       (worker)
  vite.config.ts
  .gitignore                 (node_modules, dist, .wrangler, .dev.vars)
  .dev.vars.example
  DECISIONS.md
  README.md
  docs/spec/                 (spec parts saved verbatim)
  migrations/0001_init.sql
  scripts/generate-secrets.mjs
  scripts/check-budget.mjs
  worker/src/index.ts        (Hono app + scheduled handler export)
  worker/src/env.ts          (Env interface)
  worker/src/ids.ts          (ULID generator)
  web/index.html
  web/src/main.tsx
  web/src/styles.css
  web/public/_headers        (placeholder now; filled in Part 2)
```
toml
```toml
name = "dump"
main = "worker/src/index.ts"
compatibility_date = "2026-10-24"   # or the newest date the installed wrangler supports
workers_dev = true
preview_urls = false

[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]

[[d1_databases]]
binding = "DB"
database_name = "dump-db"
database_id = "REPLACE_WITH_REAL_ID"
migrations_dir = "migrations"

[[kv_namespaces]]
binding = "FILES"
id = "REPLACE_WITH_REAL_KV_NAMESPACE_ID"

[triggers]
crons = ["0 21 * * *"]   # daily 21:00 UTC = 03:00 Asia/Dhaka; handler implemented in Part 8

[observability]
enabled = true
```
There is NO [[r2_buckets]] block and there must never be one. Local development (wrangler dev --local) simulates both D1 and KV on disk, so the placeholder ids are fine locally.
DB: D1Database; FILES: KVNamespace; ASSETS: Fetcher; ACCESS_KEY_HASH: string; UPLOAD_TOKEN_HASH: string; SESSION_SECRET: string;
- tsconfig.json (web): strict, target ES2022, module ESNext, moduleResolution Bundler, jsx: "react-jsx", jsxImportSource: "preact", include web/src.
- tsconfig.worker.json: strict, target ES2022, types @cloudflare/workers-types, include worker/src.
Root web/, build outDir: "../dist", emptyOutDir: true, plugins: preact preset + tailwind. Dev server port 5173 with proxy /api -> http://localhost:8787. build.target: "es2022", build.sourcemap: false, build.cssCodeSplit: false.
- dev:api: wrangler dev --port 8787
- dev:web: vite
- dev: runs both with concurrently
- typecheck: both tsconfigs with tsc --noEmit
- build: npm run typecheck && vite build && node scripts/check-budget.mjs
- db:migrate:local: wrangler d1 migrations apply dump-db --local
- db:migrate:remote: wrangler d1 migrations apply dump-db --remote
- deploy: npm run build && npm run db:migrate:remote && wrangler deploy
- test: vitest run
Three Worker secrets: ACCESS_KEY_HASH, UPLOAD_TOKEN_HASH, SESSION_SECRET.
scripts/generate-secrets.mjs (Node crypto only):
- Generates ACCESS_KEY = base64url of 32 random bytes (43 chars). Generates UPLOAD_TOKEN the same way. Generates SESSION_SECRET the same way.
- Hash format: lowercase hex SHA-256 of the UTF-8 string of the key/token.
- Prints the plaintext ACCESS_KEY and UPLOAD_TOKEN ONCE with a clear warning: "Save these in your password manager now. They are never stored in plaintext anywhere and cannot be recovered."
- Prints the three npx wrangler secret put ... commands with the values to paste.
- Flag --write-dev-vars writes .dev.vars containing ONLY ACCESS_KEY_HASH, UPLOAD_TOKEN_HASH, SESSION_SECRET (never plaintext keys).
- .dev.vars.example lists the three names with empty values.
scripts/check-budget.mjs: after build, parse dist/index.html, collect JS (script + modulepreload) and CSS (stylesheet) files it references, gzip each, and FAIL the build (exit 1) if total JS > 40 KB gzipped or total CSS > 10 KB gzipped. Print the sizes. Lazy chunks not referenced by index.html are excluded.
sql
```sql
CREATE TABLE files (
  id          TEXT PRIMARY KEY,                 -- ULID (sorts by creation time)
  name        TEXT NOT NULL,                    -- original filename, sanitized, max 200 chars
  mime        TEXT NOT NULL,                    -- server-sniffed type, never client-claimed
  size        INTEGER NOT NULL,                 -- bytes of original
  sha256      TEXT,                             -- lowercase hex, nullable
  width       INTEGER,
  height      INTEGER,
  thumb_size  INTEGER NOT NULL DEFAULT 0,       -- 0 = thumbnail not generated yet
  note        TEXT NOT NULL DEFAULT '',         -- max 280 chars
  pinned      INTEGER NOT NULL DEFAULT 0,       -- 1 = exempt from auto-expire
  created_at  INTEGER NOT NULL,                 -- epoch ms UTC
  deleted_at  INTEGER                           -- NULL = active, value = in Trash
);
CREATE INDEX idx_files_active ON files(id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_files_trash  ON files(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE UNIQUE INDEX idx_files_sha_active ON files(sha256) WHERE sha256 IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE file_tags (
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,                        -- lowercase [a-z0-9-], 1-24 chars, max 5 per file
  PRIMARY KEY (file_id, tag)
);
CREATE INDEX idx_file_tags_tag ON file_tags(tag, file_id);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('auto_expire_days', '30'),   -- 0 = never
  ('trash_days', '7'),
  ('session_epoch', '1');

CREATE TABLE login_attempts (
  ip_hash      TEXT PRIMARY KEY,
  fail_count   INTEGER NOT NULL,
  window_start INTEGER NOT NULL                 -- epoch ms
);
```
- IDs: ULID, implemented by hand in worker/src/ids.ts (no library): 48-bit ms timestamp + 80 random bits from crypto.getRandomValues, Crockford base32, 26 chars, monotonic within the same millisecond.
- Time: always epoch milliseconds (UTC) in DB and API. Format only in the UI via Intl.
- API envelope: success { "ok": true, ...data }, failure { "ok": false, "error": { "code": "SNAKE_CASE_CODE", "message": "human readable" } } with correct HTTP status. Unknown routes under /api/* return 404 with code NOT_FOUND. Uncaught errors return 500 INTERNAL with no stack or internal detail.
- All SQL uses prepared statements with bound parameters. NEVER build SQL by string concatenation with user input.
- Performance budgets (enforced by check-budget.mjs): JS <= 40 KB gzip, CSS <= 10 KB gzip, system font stack only, no images in the initial bundle except inline SVG.
- Dark mode follows the system (prefers-color-scheme), implemented in Part 4.
- Storage rule: ALL KV access in the Worker goes through one module, worker/src/files/storage.ts (created in Part 3). No other file calls env.FILES directly. This keeps every KV limit and workaround in one place.
1. Scaffold exactly per sections 4–7 (all files, configs, scripts, migration).
2. Worker: Hono app with GET /api/health returning { "ok": true }; the NOT_FOUND and INTERNAL handlers from section 8; export { fetch, scheduled } where scheduled is an empty async function (filled in Part 8).
3. Frontend: index.html + main.tsx render a minimal Preact page showing the text "Dump". Tailwind imported in styles.css. Viewport meta: width=device-width, initial-scale=1, viewport-fit=cover.
4. README.md: first-time setup steps — Cloudflare free account (no card; do NOT enable R2 or any paid product), create the KV namespace with npx wrangler kv namespace create FILES and paste its id into wrangler.toml, create D1 database dump-db and paste its id into wrangler.toml, run generate-secrets.mjs, set the three secrets with wrangler, npm run deploy. Include local dev steps and a warning to never commit .dev.vars.
5. DECISIONS.md created (may be empty except a header if there were no unspecified choices).
- npm install succeeds; npm run typecheck and npm run build pass; budget check prints sizes and passes.
- node scripts/generate-secrets.mjs --write-dev-vars works and creates .dev.vars with hashes only.
- npm run db:migrate:local applies the migration; all 4 tables exist.
- npm run dev serves the placeholder page at [http://localhost:5173](http://localhost:5173) and GET /api/health returns {"ok":true} through the Vite proxy; GET /api/nope returns the 404 envelope.
- wrangler.toml has a [[kv_namespaces]] block with binding FILES and NO r2_buckets; Env has FILES: KVNamespace; nothing in the project needs a payment method.
-  No dependency outside the allowlist is installed.
-  Spec saved at docs/spec/part-1.md.
STOP after this part. Do not start Part 2. Report using the format in section 0, rule 6.