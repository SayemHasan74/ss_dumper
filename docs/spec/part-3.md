The rules in Part 1 section 0 and the security model from Part 2 apply. FIRST ACTION: save this entire message verbatim to docs/spec/part-3.md, then re-read docs/spec/part-1.md and docs/spec/part-2.md. This part is BACKEND ONLY (plus shared types and scripts). Do not touch the frontend UI.
1. Thumbnails are JPEG, not WebP. iOS Safari cannot encode WebP (canvas silently returns PNG). Thumbnails are produced with "canvas -> JPEG, quality 0.82, longest side 480 px". The server stores and serves thumbnails as image/jpeg only. Part 1 already says JPEG; log this decision in DECISIONS.md.
2. policy.ts UPLOAD_SCOPE_ROUTES gets three new entries (section 9). Part 2's coverage.test.ts is adjusted as described in section 12.
3. tsconfig.json and tsconfig.worker.json both gain shared/ in include.
4. STORAGE IS CLOUDFLARE WORKERS KV (binding FILES), not R2. The platform facts in Part 1 section 2a are binding for this part. In particular: no Range reads, no checksum verification, no bulk delete, 1,000 writes/deletes/lists per day, eventual consistency, streams need a known length. All KV access happens ONLY inside worker/src/files/storage.ts (section 3a). Event names in logs use kv_ (not r2_).
- MAX_UPLOAD_BYTES = 26,214,400 (25 MiB, equal to the KV value limit). MAX_THUMB_BYTES = 153,600 (150 KiB).
- Allowed types, decided ONLY by sniffing the first bytes (never by file extension or client Content-Type): PNG, JPEG, GIF, WebP, PDF. Everything else -> 415 UNSUPPORTED_TYPE. SVG, HTML, HEIC/HEIF, and anything text-like are explicitly rejected.
- KV keys: originals f/<id>, thumbnails t/<id>. User input is NEVER part of a key.
- SNIFF_BYTES = 16.
- STORAGE_CAP_BYTES = 900,000,000 (approximate soft cap that keeps the app inside the KV free plan's 1 GB).
- LIST_DEFAULT_LIMIT = 60, LIST_MAX_LIMIT = 200, BULK_MAX_IDS = 200, CHECK_MAX_HASHES = 50.
- PURGE_MAX_PER_CALL = 100 (maximum ids for the bulk purge action) and EMPTY_TRASH_MAX_PER_CALL = 100. Reason: every purged file costs up to 2 KV deletes out of the 1,000 per day.
- KV_DELETE_PARALLEL = 10 (deletes are issued in groups of 10 concurrent calls).
- NAME_MAX = 200 chars, NOTE_MAX = 280 chars, TAG_REGEX = ^[a-z0-9-]{1,24}$, MAX_TAGS_PER_FILE = 5, SEARCH_MAX = 60 chars.
- SETTINGS_CACHE_MS = 30,000. STATS_CACHE_MS = 60,000. Both caches live inside the createApp closure (same pattern as the Part 2 epoch cache) and use the injected clock.
- Allowed setting values: auto_expire_days in {0, 7, 14, 30, 60, 90}; trash_days in {1, 3, 7, 14, 30}.
```
shared/types.ts                  FileDTO, StatsDTO, SettingsDTO, ErrorCode union (used by worker AND web)
worker/src/ids.ts                MODIFY: add isUlid, ulidTime, ulidFloor, ulidCeil
worker/src/files/config.ts
worker/src/files/validate.ts     sanitizeName, normalizeTag, parseTags, parseSha, parseDim, parseLimit, escapeLike
worker/src/files/sniff.ts        sniffMime(bytes) -> mime | null, extForMime(mime), jpegMagicOk(bytes)
worker/src/files/stream.ts       peekPrefix(body, n) (section 3b)
worker/src/files/storage.ts      the ONLY module that touches env.FILES (section 3a)
worker/src/files/repo.ts         all D1 queries (prepared statements only)
worker/src/files/dto.ts          row -> FileDTO
worker/src/files/serve.ts        KV streaming with ETag / conditional requests
worker/src/files/routes.ts       all /api/files*, /api/upload*, /api/thumb, /api/tags, /api/stats, /api/settings, /api/trash/*
worker/src/policy.ts             MODIFY
worker/src/app.ts                MODIFY: mount routes, add caches
worker/test/*.test.ts            see section 12
scripts/lib/png.mjs              tiny PNG encoder (node:zlib + CRC32), no dependencies: makePng(w, h, seed) -> Buffer
scripts/smoke.mjs                end-to-end test against a running server (section 13)
```
A small factory createStorage(kv: KVNamespace) returning this interface (this is the only place that knows KV exists; everything else, including tests, uses the interface):
ts
```ts
export interface StoredMeta { size: number; at: number }          // at = epoch ms
export interface StoredObject { body: ReadableStream<Uint8Array>; meta: StoredMeta | null }
export interface ListedKey { name: string; meta: StoredMeta | null }
export interface Storage {
  putStream(key: string, body: ReadableStream<Uint8Array>, length: number, meta: StoredMeta): Promise<void>;
  putBytes(key: string, bytes: ArrayBuffer, meta: StoredMeta): Promise<void>;
  get(key: string): Promise<StoredObject | null>;                 // ONE KV read (getWithMetadata, type 'stream')
  deleteMany(keys: string[]): Promise<{ failed: number }>;        // one KV delete per key, KV_DELETE_PARALLEL at a time, never throws
  list(cursor: string | null, limit: number): Promise<{ keys: ListedKey[]; cursor: string | null }>;   // no prefix; limit <= 1000
}
export class StorageQuotaError extends Error {}                   // KV daily operation limit hit
export class StorageLengthError extends Error {}                  // body length differs from the declared length
```
Rules:
- putStream: const fls = new FixedLengthStream(length); const piped = body.pipeTo(fls.writable); try { await kv.put(key, fls.readable, { metadata: meta }); await piped; } catch (e) { ... }. Do NOT await piped before calling kv.put (the put is what drains the stream; awaiting first deadlocks). If the pipe rejects (the client sent a different number of bytes than declared, or disconnected) throw StorageLengthError. If kv.put rejects with a message that contains "limit exceeded" (case-insensitive) throw StorageQuotaError. Any other rejection is rethrown unchanged.
- putBytes: kv.put(key, bytes, { metadata: meta }) with the same quota-error mapping.
- get: kv.getWithMetadata<StoredMeta>(key, { type: 'stream' }); returns null when value is null. Never pass cacheTtl.
- deleteMany: an empty list does nothing (and costs nothing). Failures are counted, logged once as {"evt":"kv_delete_fail"}, and never thrown.
- list: kv.list({ cursor, limit }), mapping each key's metadata through a validator (an object with finite numeric size and at, else null).
- Provide isStorageQuotaMessage(msg: string): boolean as a pure exported function so it can be unit-tested.
- Wrap-up: the whole module is small (about 100 lines). It must not import anything from Hono.
peekPrefix(body: ReadableStream<Uint8Array>, n: number): Promise<{ prefix: Uint8Array; stream: ReadableStream<Uint8Array> }>
- Take a reader. Read chunks until the accumulated length is >= n or the stream ends. Keep the chunks (no copying beyond building prefix, which is the first min(n, total) bytes).
- Return a replay stream: a ReadableStream whose start enqueues the already-read chunks in order, and whose pull then continues reading from the same reader (closing when the reader is done). cancel must cancel the reader.
- Memory held is only the chunks needed to reach n bytes (a few KB to 64 KB), never the whole body.
- If the stream ends before n bytes, prefix is shorter than n and the replay stream still contains everything.
- isUlid(s): ^[0-9A-HJKMNP-TV-Z]{26}$ (Crockford base32 has no I, L, O, U).
- ulidTime(id): decode the first 10 chars to epoch ms.
- ulidFloor(ms): 10-char time part + sixteen 0. ulidCeil(ms): 10-char time part + sixteen Z.
- Rule: files.created_at MUST equal ulidTime(id). This lets every date filter use the primary-key index (id >= ulidFloor(since)) instead of scanning rows. The KV metadata at of an original also equals ulidTime(id).
sniffMime(bytes) (needs the first 12 bytes):
- PNG: 89 50 4E 47 0D 0A 1A 0A -> image/png
- JPEG: FF D8 FF -> image/jpeg
- GIF: 47 49 46 38 followed by 37 or 39 then 61 -> image/gif
- WebP: 52 49 46 46 (RIFF), bytes 8-11 = 57 45 42 50 (WEBP) -> image/webp
- PDF: 25 50 44 46 2D (%PDF-) -> application/pdf
- anything else (including fewer than 12 bytes) -> null.
sanitizeName(raw, mime): NFC-normalize; remove control chars (U+0000-001F, U+007F), bidi/format characters (U+200B-200F, U+202A-202E, U+2060-2064, U+2066-2069, U+FEFF), and the characters / \ : * ? " < > |; collapse whitespace runs to one space; trim spaces and dots from both ends; keep only the last path-like segment; limit to NAME_MAX code points while preserving the extension; if empty -> file. Then enforce the extension: valid extensions per mime are png: .png; jpeg: .jpg|.jpeg; gif: .gif; webp: .webp; pdf: .pdf (compare case-insensitively). If the current extension is not valid for the sniffed mime, replace it (or append one if there is none) with extForMime(mime).
normalizeTag(s): trim, lowercase, replace spaces/underscores with -, collapse repeated -, strip leading/trailing -; must then match TAG_REGEX else invalid. parseTags(arr): array of <= 5 strings, each normalized and valid, deduplicated.
parseSha(s): 64 hex chars, case-insensitive, returned lowercase. parseDim(s): integer 1..30000. parseLimit(s): integer clamped to 1..LIST_MAX_LIMIT, default LIST_DEFAULT_LIMIT. escapeLike(s): escape \, %, _ with a backslash (use ESCAPE '\' in SQL).
- Prepared statements with bound parameters ONLY. A query may be assembled only from fixed SQL fragments chosen by code flags; user values are always bound, never concatenated.
- D1 allows at most 100 bound parameters per statement. Therefore every "id in list" is passed as ONE JSON-array parameter: id IN (SELECT value FROM json_each(?1)).
- Multi-statement changes use DB.batch([...]) (atomic).
- Never SELECT *. Never unbounded queries (every list has a LIMIT).
- Tags for list results come from a correlated subquery, not a second round trip: (SELECT json_group_array(t.tag) FROM file_tags t WHERE t.file_id = f.id) AS tags (parse the JSON string, sort alphabetically in JS).
ts
```ts
export interface FileDTO {
  id: string; name: string; mime: string; size: number;
  width: number | null; height: number | null;
  thumbSize: number;              // 0 = no thumbnail yet
  note: string; pinned: boolean; tags: string[];
  createdAt: number; deletedAt: number | null;
  expiresAt: number | null;       // createdAt + autoExpireDays*86400000; null when pinned, trashed, or auto-expire = 0
}
export interface StatsDTO { count: number; bytes: number; trashCount: number; trashBytes: number; capBytes: number }
export interface SettingsDTO { autoExpireDays: number; trashDays: number }
```
bytes and trashBytes include thumbnail bytes (size + thumb_size). ErrorCode is a string-literal union of every code in section 11.
- getSettings(): reads auto_expire_days, trash_days from settings, cached SETTINGS_CACHE_MS, cache replaced immediately after a successful PATCH in the same isolate.
- getStats(): one DB.batch of two aggregate queries (active, trashed), cached STATS_CACHE_MS. After each successful mutation in this isolate (upload, trash, restore, purge, thumb), adjust the cached numbers in place; after STATS_CACHE_MS recompute from D1. The cap check is therefore approximate; document this in README.
Add to UPLOAD_SCOPE_ROUTES: POST /api/upload, POST /api/upload/check, POST /api/thumb.
Headers: Content-Length (required), X-File-Name (optional, percent-encoded UTF-8, <= 600 chars encoded; decode with decodeURIComponent in try/catch, invalid -> treat as missing), X-Content-Sha256 (optional), X-Width and X-Height (optional, both or neither). The request Content-Type is ignored.
Processing order (cheap checks first; nothing before step 4 may touch D1 or KV, and NOTHING is written to KV until the content type has been sniffed, so rejected uploads cost no write quota):
1. No/invalid Content-Length -> 411 LENGTH_REQUIRED. 0 -> 400 EMPTY_FILE. Over MAX_UPLOAD_BYTES -> 413 PAYLOAD_TOO_LARGE.
2. Invalid sha / dims -> 400 BAD_REQUEST.
3. Request has no body -> 400 EMPTY_FILE.
4. Quota: getStats(); if bytes + trashBytes + contentLength > STORAGE_CAP_BYTES -> 507 STORAGE_FULL (message: "Storage is nearly full. Empty the Trash or delete files.").
5. If sha was given: look for an ACTIVE file with that sha256; if found return 200 { ok: true, duplicate: true, file } WITHOUT reading the body.
6. Sniff before storing: peekPrefix(request.body, SNIFF_BYTES), then sniffMime(prefix). Null (including a body shorter than 12 bytes) -> 415 UNSUPPORTED_TYPE (cancel the stream; nothing was stored).
7. id = ulid(), key f/<id>. storage.putStream(key, replayStream, contentLength, { size: contentLength, at: ulidTime(id) }). Errors: StorageLengthError -> 400 SIZE_MISMATCH; StorageQuotaError -> 429 DAILY_LIMIT (message: "Daily storage limit reached. Try again after 06:00 Dhaka time (00:00 UTC)."); anything else -> 500 INTERNAL (log {"evt":"kv_put_fail"} only). Because the length is enforced by the fixed-length stream, the stored size always equals Content-Length.
8. Insert the row (name from sanitizeName(decodedName or "file", mime), mime = sniffed, size = contentLength, sha256 = header value or NULL, width/height from headers or NULL, thumb_size 0, created_at = ulidTime(id)). If the insert fails with a UNIQUE violation on the sha index (a race with another upload), storage.deleteMany([key]) and return the existing file as duplicate: true. Any other insert failure -> storage.deleteMany([key]), 500.
9. Respond 201 { ok: true, duplicate: false, file: FileDTO }.
The Worker must never buffer the whole body in memory and never hash it (CPU budget). The client-supplied sha256 is trusted for duplicate detection only (KV cannot verify it); log this in DECISIONS.md.
Returns { ok: true, existing: { "<sha>": "<id>" } } for hashes that already belong to an ACTIVE file: SELECT sha256, id FROM files WHERE deleted_at IS NULL AND sha256 IN (SELECT value FROM json_each(?1)). This uses D1 only (no KV operations).
Headers: Content-Length required, <= MAX_THUMB_BYTES (else 413). Optional X-Width/X-Height = ORIGINAL image dimensions.
1. Cheap validation first: id valid ULID else 400; Content-Length checks.
2. Row must exist, be active, and have an image/* mime; else 404 NOT_FOUND (or 409 NOT_IMAGE for a PDF).
3. Read the body with arrayBuffer() (it is <= 150 KiB), require byteLength <= MAX_THUMB_BYTES and JPEG magic FF D8 FF, else 415 UNSUPPORTED_TYPE.
4. storage.putBytes('t/<id>', bytes, { size: byteLength, at: now }) (quota error -> 429 DAILY_LIMIT); then UPDATE files SET thumb_size = ?, width = COALESCE(width, ?), height = COALESCE(height, ?) WHERE id = ? AND deleted_at IS NULL.
5. Idempotent (a second call overwrites; a re-upload still costs one KV write). Respond { ok: true, thumbSize }.
All :id params are validated with isUlid; invalid -> 404 NOT_FOUND. JSON bodies go through parseJsonBody (Part 2) with the limits stated below.
GET /api/files — query: limit, cursor (a ULID; returns id < cursor), trash=1 (only trashed; default only active), type=image|pdf, tag, q, pinned=1, since and until (epoch ms; mapped to id >= ulidFloor(since) and id <= ulidCeil(until)). Invalid values -> 400 BAD_REQUEST naming the parameter; unknown parameters are ignored. q is trimmed, <= SEARCH_MAX, matched with f.name LIKE ? ESCAPE '\' on %escaped%. Always ORDER BY f.id DESC. Fetch limit + 1 rows; if there is an extra row, drop it and return nextCursor = id of the last returned row, else null. Response: { ok: true, files: FileDTO[], nextCursor: string | null }. This endpoint never touches KV.
Base SQL (fragments appended with AND, values bound):
sql
```sql
SELECT f.id, f.name, f.mime, f.size, f.width, f.height, f.thumb_size, f.note, f.pinned, f.created_at, f.deleted_at,
       (SELECT json_group_array(t.tag) FROM file_tags t WHERE t.file_id = f.id) AS tags
FROM files f
WHERE f.deleted_at IS NULL            -- or IS NOT NULL when trash=1
ORDER BY f.id DESC LIMIT ?
```
Optional fragments: f.id < ?, f.id >= ?, f.id <= ?, f.mime LIKE 'image/%', f.mime = 'application/pdf', f.pinned = 1, f.id IN (SELECT file_id FROM file_tags WHERE tag = ?), f.name LIKE ? ESCAPE '\'.
GET /api/files/:id — { ok, file } (works for trashed files too).
GET /api/files/:id/original and GET /api/files/:id/thumb — see section 10a.
PATCH /api/files/:id — body <= 4 KB; any of name (string; passed through sanitizeName with the file's mime, so the extension stays correct), note (string <= NOTE_MAX, control characters except newline removed), pinned (boolean), tags (array via parseTags, replaces the whole set). At least one field required, else 400. Trashed file -> 409 IN_TRASH. Apply in one DB.batch. Returns { ok, file }.
DELETE /api/files/:id — move to Trash (deleted_at = now). Already trashed -> still 200. Missing -> 404. Returns { ok: true }. Moving to Trash costs NO KV operations.
POST /api/files/:id/restore — UPDATE OR IGNORE files SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL. If it is still trashed afterwards (an active file with the same sha256 exists) -> 409 DUPLICATE_EXISTS. Returns { ok, file }.
DELETE /api/files/:id/permanent — only for trashed files, else 409 NOT_IN_TRASH. Order: read the row's thumb_size; delete tag rows and the file row in one batch FIRST; then storage.deleteMany(['f/<id>'] plus ['t/<id>'] only when thumb_size > 0). If any KV delete fails, deleteMany logs {"evt":"kv_delete_fail"} and the request still returns success (Part 8's orphan sweep cleans up).
POST /api/files/bulk — body <= 16 KB: { action, ids, tag? }. ids: 1..BULK_MAX_IDS unique valid ULIDs (for purge: 1..PURGE_MAX_PER_CALL, else 400 BAD_REQUEST). Actions and SQL (?2 is JSON.stringify(ids)):
- trash: UPDATE files SET deleted_at = ?1 WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?2))
- restore: UPDATE OR IGNORE files SET deleted_at = NULL WHERE deleted_at IS NOT NULL AND id IN (...) (rows that would collide with an active duplicate are silently skipped)
- pin / unpin: UPDATE files SET pinned = ?1 WHERE deleted_at IS NULL AND id IN (...)
- tag_add (requires tag, normalized): INSERT OR IGNORE INTO file_tags (file_id, tag) SELECT f.id, ?1 FROM files f WHERE f.deleted_at IS NULL AND f.id IN (SELECT value FROM json_each(?2)) AND (SELECT COUNT(*) FROM file_tags t WHERE t.file_id = f.id) < 5
- tag_remove (requires tag): DELETE FROM file_tags WHERE tag = ?1 AND file_id IN (SELECT value FROM json_each(?2))
- purge: select which of the ids are trashed (id, thumb_size), delete their tag rows and file rows in one batch, then storage.deleteMany of their f/<id> keys plus t/<id> keys only where thumb_size > 0. Response: { ok: true, affected: <meta.changes or purged count>, requested: ids.length }. The client uses affected < requested to show "N skipped". Only purge uses KV (every other action is D1 only).
POST /api/trash/empty — purge up to EMPTY_TRASH_MAX_PER_CALL trashed files (same procedure as bulk purge, oldest deleted_at first). Returns { ok, purged, remaining } where remaining is the count of trashed files left; the client calls again while remaining > 0. If KV reports its daily limit during the purge, the rows already deleted stay deleted, the response is 429 DAILY_LIMIT, and the leftover KV objects are removed by the orphan sweep the next day.
GET /api/tags — { ok, tags: [{ tag, count }] } for ACTIVE files, ordered by count desc then tag, LIMIT 100 (join file_tags with files).
GET /api/stats — { ok, ...StatsDTO } from getStats().
GET /api/settings — { ok, autoExpireDays, trashDays }. PATCH /api/settings — body <= 1 KB, either or both fields, values from the allowed sets only (else 400). Writes settings rows, refreshes the cache.
KV cannot serve byte ranges and cannot do conditional reads, so the Worker serves WHOLE files and does its own conditional logic BEFORE reading KV (to save read quota):
- Look up the row in D1 (active or trashed). Missing row -> 404 NOT_FOUND. Thumb with thumb_size = 0 -> 404 NO_THUMB.
- ETag (strong, quoted): originals "<id>", thumbnails "<id>-<thumb_size>". If If-None-Match contains that ETag (or *) -> 304 with the ETag and the caching headers below, WITHOUT reading KV.
- Otherwise storage.get('f/<id>') or storage.get('t/<id>') (ONE KV read). A null result (row exists but the object is missing, or KV has not propagated a brand-new object yet) -> log {"evt":"kv_missing"} and respond 404 NOT_FOUND with header Retry-After: 2 and Cache-Control: no-store.
- Respond 200 with the stream as the body. Headers: Content-Length = the row's size (originals) or thumb_size (thumbs), Accept-Ranges: none (a Range request header is ignored and still gets the whole file with 200), ETag.
- Content-Type: the row's mime for originals, image/jpeg for thumbs (never trust anything else).
- Content-Disposition: inline; filename="<ascii fallback>"; filename*=UTF-8''<percent-encoded name> (fallback = name with non-ASCII, " and \ replaced by _). With ?download=1 use attachment.
- Caching (these override the Part 2 default no-store, on 200 and 304 only): originals and thumbs get Cache-Control: private, max-age=31536000, immutable and Vary: Cookie, Authorization. This is safe because ids are never reused and content never changes; the client busts thumbnails with ?v=<thumbSize>. The long browser cache is also what keeps the app inside the free plan's daily Worker-request and KV-read limits.
- CSP for image responses: default-src 'none'; sandbox. PDF responses keep the Part 2 default CSP (a sandbox directive breaks Chrome's PDF viewer).
- HEAD works through Hono's GET handling (a HEAD must not read KV: answer from the D1 row alone).
BAD_REQUEST 400, EMPTY_FILE 400, CHECKSUM_MISMATCH 400 (reserved: the KV backend cannot verify checksums, so the server never returns it, but the code stays in the ErrorCode union), SIZE_MISMATCH 400, UNAUTHENTICATED 401, FORBIDDEN_SCOPE 403, CSRF 403, NOT_FOUND 404, NO_THUMB 404, IN_TRASH 409, NOT_IN_TRASH 409, DUPLICATE_EXISTS 409, NOT_IMAGE 409, LENGTH_REQUIRED 411, PAYLOAD_TOO_LARGE 413, UNSUPPORTED_TYPE 415, UNSUPPORTED_MEDIA_TYPE 415, RATE_LIMITED 429, DAILY_LIMIT 429, INTERNAL 500, STORAGE_FULL 507.
- ids.test.ts: format, monotonic ordering within the same ms, ulidTime round-trip, ulidFloor(t) < id < ulidCeil(t) for an id made at t, isUlid rejects I/L/O/U and wrong lengths.
- sniff.test.ts: each valid magic; truncated input; RIFF without WEBP; <svg, <html, GIF8 + wrong digit, HEIC (ftypheic) all rejected.
- names.test.ts: ../../etc/passwd.png, a name containing U+202E (RTL override), zero-width characters, 300-char names (extension preserved), empty name, photo.png sniffed as JPEG becomes photo.jpg, no extension gets one, Unicode (Bangla) names survive.
- validate.test.ts: tags (case, spaces, 6 tags rejected, duplicates merged, invalid chars), sha, dims, limit clamping, LIKE escaping.
- stream.test.ts: peekPrefix returns the correct prefix when the first bytes span several small chunks, when a single chunk is larger than n, and when the body is shorter than n; the replay stream yields exactly the original bytes in order; cancelling the replay stream cancels the source.
- storage.test.ts: isStorageQuotaMessage matches "KV put() limit exceeded for the day." (any case) and rejects unrelated messages; deleteMany with a fake KVNamespace issues one delete per key, never more than KV_DELETE_PARALLEL at once, counts failures, and never throws; list maps valid and invalid metadata correctly.
- upload-validation.test.ts (using createApp with a fake env that has NO DB/FILES; every case must fail BEFORE touching them): missing Content-Length -> 411, over 25 MiB -> 413, bad sha -> 400, bad dims -> 400, /api/thumb without id -> 400 and with a non-ULID -> 400, /api/upload/check with 51 hashes -> 400, wrong content type -> 415.
- UPDATE coverage.test.ts from Part 2: for routes in UPLOAD_SCOPE_ROUTES, with a valid upload token assert the status is NOT 401, NOT 403 and NOT 500 (validation errors like 411/400/415 are expected); for all other non-public routes assert 403 FORBIDDEN_SCOPE as before. Unauthenticated -> 401 for every non-public route remains.
- Note: FixedLengthStream does not exist in the Node test environment, so the streaming upload path is covered by the smoke test (section 13), not by vitest.
Reads SMOKE_BASE_URL (default http://localhost:8787), SMOKE_ACCESS_KEY, SMOKE_UPLOAD_TOKEN. Runs against wrangler dev --local (real SQLite and KV simulators, so the SQL and the KV code are genuinely exercised). It logs in (keeping the cookie), then checks and prints PASS/FAIL per step, exiting 1 on any failure:
1. upload a generated PNG (makePng) with sha header via the upload token -> 201; same bytes again -> duplicate: true
2. /api/upload/check finds it; upload of <svg> bytes -> 415 (and a follow-up GET /api/stats shows the count unchanged, proving nothing was stored); of a 26 MiB buffer -> 413; a body shorter than 12 bytes -> 415
3. upload a thumbnail (bytes starting FF D8 FF) -> thumbSize > 0; a PNG body to /api/thumb -> 415
4. list (newest first, nextCursor null, tags []), list with limit=1 over 3 uploads paginates correctly, filters type, q, since, until behave
5. fetch original: bytes identical, Content-Type correct, Content-Length correct, Accept-Ranges: none, a request with Range: bytes=0-9 still returns 200 with the full body, If-None-Match with the ETag -> 304, ?download=1 -> attachment; fetch the thumb: image/jpeg
6. PATCH name/note/tags/pinned; 6 tags -> 400; rename removing the extension keeps a correct one
7. trash -> disappears from list, appears in trash=1; restore; trash + purge removes the KV objects (original and thumb now 404); DELETE .../permanent on an active file -> 409
8. bulk trash/restore/pin/tag_add/tag_remove/purge with 3 ids; affected correct; purge with 101 ids -> 400
9. /api/tags, /api/stats, /api/settings GET and PATCH (invalid value -> 400)
10. upload-token requests to a full-scope route -> 403; no credentials -> 401; cookie request without x-dump-client -> 403
- npm run typecheck, npm test, npm run build pass; budget unchanged (no frontend changes).
- npm run db:migrate:local, npm run dev:api, then node scripts/smoke.mjs ends with all steps PASS.
-  No endpoint builds SQL from user values; no SELECT *; every list query has a LIMIT.
-  Upload never buffers the file in Worker memory (streams to KV through FixedLengthStream), never hashes it in the Worker, and writes nothing to KV for rejected types.
- grep -R "FILES" worker/src shows env.FILES / kv used only in storage.ts (and the Env type); there is no BUCKET and no R2 reference anywhere.
- docs/spec/part-3.md saved; DECISIONS.md records the JPEG amendment, the trusted-client-sha rule, and any wrangler or workers-types adaptation.
STOP after this part. Do not start Part 4. Report using the format in Part 1, section 0, rule 6.