The rules in Part 1, section 0 apply to this part and every later one. FIRST ACTION: save this entire message verbatim to docs/spec/part-2.md, then re-read docs/spec/part-1.md. Implement only this part. Do not build any file endpoints (that is Part 3).
Private single-user app. The deployed URL is public on the internet, so assume strangers will find it. Required outcome: nobody without my key can read, upload, list, or delete anything, and a stolen/leaked upload token can only upload. Not in scope: multi-user, OAuth, passkeys, email, password reset (reset = rotate the secret with wrangler), user tables.
The static app shell (HTML/JS/CSS) is public by design and contains no data. ALL data lives behind /api/* and is authenticated.
- SESSION_SLIDING_MS = 30 days
- SESSION_ABSOLUTE_MS = 180 days (counted from the original login, never extended)
- SESSION_RENEW_THRESHOLD_MS = 15 days (re-issue cookie only when remaining lifetime is below this)
- CLOCK_SKEW_MS = 5 minutes (reject tokens whose iat is more than this in the future)
- LOGIN_MAX_FAILS = 5, LOGIN_WINDOW_MS = 15 minutes
- BEARER_MAX_FAILS = 10, BEARER_WINDOW_MS = 15 minutes
- EPOCH_CACHE_MS = 30,000
- AUTH_BODY_MAX_BYTES = 1024
- KEY_REGEX = ^[A-Za-z0-9_-]{43}$ (shape of ACCESS_KEY and UPLOAD_TOKEN)
- CSRF_HEADER = x-dump-client, required value 1
```
worker/src/app.ts                createApp(deps?) -> Hono app (all wiring lives here)
worker/src/index.ts              MODIFY: export { fetch: createApp().fetch, scheduled } only
worker/src/env.ts                MODIFY: add Hono Variables type { stores: Stores; scope: Scope; now: () => number }
worker/src/http.ts               HttpError class, fail()/ok() helpers, parseJsonBody()
worker/src/policy.ts             PUBLIC_ROUTES, UPLOAD_SCOPE_ROUTES
worker/src/auth/config.ts
worker/src/auth/crypto.ts        sha256Hex, hmacSign, hmacVerify, b64urlEncode/Decode, timingSafeEqual, utf8
worker/src/auth/session.ts       token create/verify/renew + cookie helpers
worker/src/auth/stores.ts        interfaces + D1 implementation + in-memory implementation (tests)
worker/src/auth/ratelimit.ts
worker/src/auth/gate.ts          global auth middleware + csrfCheck
worker/src/auth/routes.ts        /api/auth/* handlers
worker/src/middleware/headers.ts security headers middleware
worker/test/*.test.ts            see section 12
vitest.config.ts                 include worker/test/**/*.test.ts, environment node
web/public/_headers              REPLACE placeholder (section 9)
web/public/robots.txt
web/src/lib/api.ts
web/src/auth.ts
web/src/views/Login.tsx
web/src/main.tsx                 MODIFY (boot logic)
web/index.html                   MODIFY (robots meta)
vite.config.ts                   MODIFY: build.modulePreload = { polyfill: false }
tsconfig.worker.json             MODIFY: include worker/test too
scripts/generate-secrets.mjs     MODIFY: add --only flag (section 11)
README.md                        MODIFY: add "Security model and rotation" section
```
createApp(deps?: { stores?: Stores; now?: () => number }): defaults to D1-backed stores built from c.env.DB and Date.now. Tests inject in-memory stores and a fake clock. The first middleware on * puts stores and now on the context.
- utf8(s): TextEncoder.
- sha256Hex(s): crypto.subtle.digest('SHA-256', utf8(s)) -> lowercase hex.
- b64urlEncode(bytes) / b64urlDecode(str): base64url without padding, hand-written using btoa/atob. b64urlDecode returns null on any invalid input instead of throwing.
- timingSafeEqual(a: string, b: string): encode both to bytes; if lengths differ return false (lengths of our hashes are always 64, so no information leaks); otherwise XOR-accumulate over every byte with no early exit and return acc === 0.
- HMAC: SHA-256. Import the key ONCE per secret with crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign','verify']) and cache it in a module variable keyed by the secret string (re-import if the secret changes). Verification MUST use crypto.subtle.verify (constant-time), never string comparison of signatures.
- Why plain SHA-256 for the access key and not bcrypt/argon2/PBKDF2: the key is 256 bits of randomness, so brute force is infeasible and slow hashing adds nothing; slow hashing would also break the 10 ms CPU budget. Do NOT "upgrade" this.
Token string: v1.<payloadB64>.<sigB64> where payload is JSON {"iat":<ms>,"exp":<ms>,"ep":<int>} and sig = HMAC-SHA256(SESSION_SECRET, "v1." + payloadB64), both parts base64url.
- iat = original login time (preserved across renewals). exp = min(now + SESSION_SLIDING_MS, iat + SESSION_ABSOLUTE_MS). ep = current session epoch (section 7).
- verifySession(token) returns the payload or null. It must NEVER throw. Reject (return null) when: length > 400 chars; not exactly 3 dot-separated parts; first part not v1; bad base64url; signature invalid; JSON parse fails; any field is not a finite integer; now >= exp; iat > now + CLOCK_SKEW_MS; now >= iat + SESSION_ABSOLUTE_MS; ep !== current epoch.
- Renewal: on any valid cookie-authenticated request, if exp - now < SESSION_RENEW_THRESHOLD_MS, issue a fresh cookie (same iat, new exp, current ep). Set the Set-Cookie header BEFORE calling next() (Hono merges it into the handler's response). Do not set a cookie on every request.
- Cookie attributes (exact): Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict. NEVER set a Domain attribute. Name over HTTPS: __Host-dump_session. Only when the request URL is http: (local dev) use name dump_session without Secure. Choose the name from new URL(c.req.url).protocol; read only the cookie name matching the current protocol. Use hono/cookie helpers (getCookie, setCookie, deleteCookie).
- The cookie is always set by a server Set-Cookie header, never by JavaScript (iOS caps JS-set cookies at 7 days; server-set HttpOnly cookies are not capped).
- Deleting = same attributes with Max-Age=0 and empty value.
- iOS note for README: the Home Screen web app has its own cookie jar separate from Safari, so I log in once inside the installed app.
settings.session_epoch (integer string) is embedded in every cookie as ep. Incrementing it invalidates all existing cookies. To avoid a D1 read on every request, cache the epoch in a variable inside the createApp closure for EPOCH_CACHE_MS (use the injected clock). When logout-all runs, update the cache in that isolate immediately. Documented staleness in other isolates: up to 30 s. Put this in README.
Stores interface (auth/stores.ts), all async:
- getEpoch(): number
- bumpEpoch(): number — UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'session_epoch', then return the new value.
- getAttempt(key): { failCount: number; windowStart: number } | null
- recordFailure(key, now, windowMs): { failCount: number; windowStart: number }
- clearAttempt(key): void
D1 recordFailure is ONE DB.batch([...]) of two prepared statements (a single round trip):
sql
```sql
INSERT INTO login_attempts (ip_hash, fail_count, window_start) VALUES (?1, 1, ?2)
ON CONFLICT(ip_hash) DO UPDATE SET
  fail_count   = CASE WHEN window_start + ?3 <= ?2 THEN 1 ELSE fail_count + 1 END,
  window_start = CASE WHEN window_start + ?3 <= ?2 THEN ?2 ELSE window_start END;
DELETE FROM login_attempts WHERE window_start < ?4;   -- ?4 = now - 24h
```
followed by a SELECT of the row (include it in the same batch). The in-memory store must implement identical semantics.
All JSON endpoints require Content-Type: application/json (else 415 UNSUPPORTED_MEDIA_TYPE) and bodies <= AUTH_BODY_MAX_BYTES (check Content-Length first, then actual text length; else 413 PAYLOAD_TOO_LARGE). Malformed JSON or wrong field types -> 400 BAD_REQUEST. Use the parseJsonBody(c, maxBytes) helper in http.ts for this so Part 3 reuses it.
POST /api/auth/login (public) body { "key": string }:
1. Parse body. key = key.trim() (pasted keys often carry whitespace).
2. Rate-limit check BEFORE verifying: identifier = login: + first 32 hex chars of sha256Hex(ip + "|" + SESSION_SECRET) where ip = CF-Connecting-IP header, or the literal local if absent. Never store raw IPs. Use the full IP string (no IPv6 prefix grouping; the key's entropy makes that unnecessary). If a row exists, now < windowStart + LOGIN_WINDOW_MS and failCount >= LOGIN_MAX_FAILS -> 429 RATE_LIMITED with header Retry-After: <ceil seconds remaining> and error.retryAfterSec in the body. Do not verify the key in this case.
3. Verify: if key does not match KEY_REGEX it counts as a failure (same response as a wrong key). Otherwise timingSafeEqual(await sha256Hex(key), env.ACCESS_KEY_HASH).
4. Failure: recordFailure, return 401 INVALID_KEY with message "Invalid key." The message must be identical for wrong key, wrong shape, and everything else (no oracle). The 5th failure still returns 401; the 6th attempt inside the window returns 429. No global (all-IP) lockout, because that would let an attacker lock me out; document this in DECISIONS.md.
5. Success: clearAttempt, create session (iat = now, ep = current epoch), set cookie, return { ok: true, scope: "full" }.
6. Config errors (a secret missing, ACCESS_KEY_HASH not 64 hex chars, SESSION_SECRET shorter than 32 chars): return 500 INTERNAL, console.error the NAME of the problem only, never a value.
POST /api/auth/logout (public, idempotent): delete the cookie, return { ok: true }. Stateless; does not bump the epoch.
POST /api/auth/logout-all (full scope): bump epoch (update the cache), delete the cookie, return { ok: true }.
GET /api/auth/session (full or upload scope): return { ok: true, authenticated: true, scope: "full" | "upload" }. Unauthenticated requests get the standard 401 from the gate. The frontend calls this on boot; the iOS Shortcut can use it to test its token.
policy.ts exports two arrays of exact strings "METHOD /pathname" (no path parameters, no wildcards; HEAD is matched as GET):
- PUBLIC_ROUTES = ["GET /api/health", "POST /api/auth/login", "POST /api/auth/logout"]
- UPLOAD_SCOPE_ROUTES = ["GET /api/auth/session"] (Part 3 appends the upload endpoints; upload-scope endpoints must therefore have no path parameters)
Routes in UPLOAD_SCOPE_ROUTES accept BOTH scopes. Every other non-public route accepts ONLY full.
app.use('/api/*', gate) algorithm, in this exact order:
1. key = METHOD + " " + pathname. If in PUBLIC_ROUTES: for unsafe methods (anything other than GET/HEAD) run csrfCheck; call next(); done.
2. If an Authorization header is present, use ONLY the bearer path and completely ignore any cookie: 
   - Must match ^Bearer ([A-Za-z0-9_-]{43})$ (scheme case-insensitive, single space). Otherwise 401 UNAUTHENTICATED.
   - Valid when timingSafeEqual(sha256Hex(token), env.UPLOAD_TOKEN_HASH). On success there is ZERO database access (fast path).
   - On failure: recordFailure with identifier bearer: + ip hash; return 429 RATE_LIMITED if the returned failCount >= BEARER_MAX_FAILS within the window, else 401 UNAUTHENTICATED. (Valid tokens always pass; this is a noise limiter only, because the token has 256 bits of entropy. Note in DECISIONS.md.)
   - On success: scope = upload. If key is not in UPLOAD_SCOPE_ROUTES -> 403 FORBIDDEN_SCOPE. Skip CSRF checks (no ambient credentials).
3. Else cookie path: read the cookie, verifySession. If invalid or missing -> 401 UNAUTHENTICATED; if a cookie was present but invalid, also send a delete-cookie header. If valid: scope = full.
4. For cookie-authenticated unsafe methods run csrfCheck. For GET/HEAD: if Sec-Fetch-Site is cross-site -> 403 CSRF.
5. Apply renewal (section 5), c.set('scope', ...), await next().
Consequences (state them in README): unauthenticated requests to ANY /api/* path, including nonexistent ones, return 401, not 404 (do not reveal which routes exist). Part 1's acceptance check for /api/nope -> 404 now applies to authenticated requests. OPTIONS requests fall through to the 404 handler (no CORS exists).
csrfCheck(c) (403 CSRF on any failure):
- If Sec-Fetch-Site is present and not same-origin or none -> fail.
- If Origin is present: must equal new URL(c.req.url).origin. Exception for local dev ONLY: if the request hostname is localhost or 127.0.0.1, compare hostnames and ignore the port. Origin: null fails.
- Header x-dump-client must equal 1. (Together with SameSite=Strict this blocks cross-site request forgery; no CORS means a cross-origin page cannot send the custom header.) Vite dev proxy must keep changeOrigin: false.
Worker responses (middleware/headers.ts, applied to every /api/* response including errors/404; set each header ONLY if the handler has not already set it, so Part 3 can override Cache-Control and Content-Security-Policy for file responses):
- Cache-Control: no-store
- X-Content-Type-Options: nosniff
- Referrer-Policy: no-referrer
- Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
- Cross-Origin-Resource-Policy: same-origin
- X-Frame-Options: DENY
- Strict-Transport-Security: max-age=31536000
- X-Robots-Tag: noindex, nofollow, noarchive Rule for any later override of no-store: it must be private (never public) and the response must carry Vary: Cookie, Authorization.
Static assets (web/public/_headers, exact):
```
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Strict-Transport-Security: max-age=31536000
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  X-Robots-Tag: noindex, nofollow, noarchive
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
/manifest.webmanifest
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```
Do NOT add clipboard to Permissions-Policy (Part 6 needs clipboard write). CSP rules for all frontend code: no inline <script>, no inline <style>, no eval, no inline event-handler attributes, no third-party URLs. Setting styles through JS/CSSOM (Preact style prop) is allowed. Verify the production build against this CSP.
web/public/robots.txt: User-agent: * / Disallow: /. Add <meta name="robots" content="noindex,nofollow"> to index.html.
Observability is on, so logs persist. Allowed events only, as single-line JSON via console.log: {"evt":"login_ok"}, {"evt":"login_fail","ip":"<first 8 hex of ip hash>"}, {"evt":"login_locked","ip":"<8 hex>"}, {"evt":"bearer_fail","ip":"<8 hex>"}, {"evt":"logout_all"}, {"evt":"config_error","name":"<secret name>"}. Never log keys, tokens, hashes, cookies, full IPs, headers, or request bodies.
- scripts/generate-secrets.mjs: add flag --only=access|upload|session. With it, generate and print ONLY that credential plus its single wrangler secret put command. access and upload print the new plaintext once with the same save-it warning. --only=session rotates SESSION_SECRET (invalidates all logins; no plaintext to save). Without --only, behaviour is unchanged. --write-dev-vars must still write hashes only, and must print the plaintext ACCESS_KEY and UPLOAD_TOKEN once (I need them to log in locally).
- README section "Security model and rotation": the model in plain language; what each secret does; leaked iPhone Shortcut -> --only=upload; lost/stolen device -> "Log out everywhere" (UI comes in Part 6; until then call POST /api/auth/logout-all) or --only=session; forgot key -> --only=access; the 30 s epoch-cache staleness; iOS Home Screen app has its own cookie jar; the 401-not-404 behaviour; never commit .dev.vars.
web/src/lib/api.ts:
- api<T>(path, opts?: { method?, json?, signal? }) -> resolves the parsed {ok:true,...} body, throws ApiError { status, code, message, retryAfterSec? } on failure or network error (code: "NETWORK").
- Every request sends x-dump-client: 1, Accept: application/json, credentials: 'same-origin'; JSON bodies send Content-Type: application/json. Default timeout 30 s via AbortController.
- Idempotent GETs retry up to 2 times on network error only, with 300 ms then 900 ms delay. Never retry 4xx/5xx or non-GET methods.
- On a 401 from any endpoint other than login, set authState to out.
web/src/auth.ts: signals authState: 'unknown' | 'in' | 'out'; bootAuth() calls GET /api/auth/session (200 -> in, 401 -> out, network error -> show an inline "Can't reach the server" retry state, not the login form); login(key); logout() (POST /api/auth/logout, then out). The key is NEVER written to localStorage, sessionStorage, IndexedDB, URL, or logs; clear the input value after every submit.
web/src/views/Login.tsx:
- Render nothing visible (just the background colour) while authState is unknown, so there is no login-form flash.
- One <form>: a visually-hidden (CSS clip, NOT display:none) text input name="username" autocomplete="username" value="dump" so password managers can save the credential, plus the key input type="password" name="key" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false", a show/hide toggle button (inline SVG, aria-label), and a submit button. All inputs font-size >= 16px (prevents iOS zoom). Enter submits.
- Autofocus the key input only when matchMedia('(hover: hover)').matches (desktop), never on touch devices.
- Pending: button disabled, label "Checking…". Errors in an aria-live="polite" region: INVALID_KEY -> "That key isn't right."; RATE_LIMITED -> "Too many attempts. Try again in M:SS." with a live countdown from retryAfterSec and the form disabled until it reaches zero; NETWORK -> "Can't reach the server."; anything else -> "Something went wrong."
- Layout: centered card, max-w-sm, padding that respects env(safe-area-inset-*), Tailwind dark: variants for dark mode, system font stack, no images.
- After success render a temporary placeholder: text "Signed in" and a Logout button (Part 4 replaces it).
main.tsx: mount, call bootAuth(), render Login when authState is out, placeholder when in.
Use createApp({ stores: memoryStores, now: fakeClock }) and app.request(url, init, env) with a fake env containing test hashes. Do NOT install @types/node or any test library; if typings complain, solve it with vitest types and note it in DECISIONS.md.
- crypto.test.ts: sha256Hex("abc") equals the standard vector ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad; timingSafeEqual true/false/different-length; base64url round-trip and invalid input returns null.
- session.test.ts: valid token verifies; tampered payload, tampered signature, wrong version, expired, iat too far in future, absolute-lifetime exceeded, epoch mismatch each return null; 12+ garbage inputs (empty, 1 part, 4 parts, 10 KB string, bad base64, non-JSON, wrong field types) return null and never throw; renewal fires only below the threshold and keeps iat.
- auth-flow.test.ts: login success sets the cookie with exact attributes (https URL -> __Host-dump_session, Secure; http://localhost -> dev name, no Secure); wrong key and malformed key give identical 401 bodies; missing x-dump-client -> 403 CSRF; mismatched Origin -> 403; Sec-Fetch-Site: cross-site -> 403; 415 and 413 enforcement; 5 failures then 429 with Retry-After; lockout expires after the window (fake clock); success clears the counter; the 6th attempt with the CORRECT key during lockout is still 429; session endpoint; logout clears cookie; logout-all invalidates an existing cookie (and the epoch cache TTL is honoured with the fake clock); bearer: valid token works on GET /api/auth/session, gets 403 FORBIDDEN_SCOPE on a full-only route, malformed/wrong gets 401, 10 failures gets 429, a bearer request ignores a valid cookie (bad bearer + good cookie = 401), a cookie is never accepted as upload scope, bearer requests with no x-dump-client header are not CSRF-blocked.
- coverage.test.ts (the safety net for all future parts): iterate app.routes (skip method ALL and wildcard paths, replace :param segments with x); for every route not in PUBLIC_ROUTES, an unauthenticated request must return 401; with a valid upload token it must return 200-range only if the route is in UPLOAD_SCOPE_ROUTES, otherwise 403 FORBIDDEN_SCOPE. This test must keep passing in every later part.
- headers.test.ts: default headers present on success, 401, 404, and 500 responses; a handler-set Cache-Control is not overwritten.
- npm run typecheck, npm test, npm run build all pass; budget check still passes.
-  With npm run dev and secrets from generate-secrets.mjs --write-dev-vars: UI shows the login form; a wrong key shows the error; 5 wrong keys then shows the countdown; the correct key shows "Signed in"; reload keeps me signed in; Logout returns to the form.
- curl -i localhost:8787/api/health -> 200 with all default security headers.
- curl -i localhost:8787/api/nope (no cookie) -> 401. With a valid cookie -> 404 envelope.
- curl -i -X POST .../api/auth/login WITHOUT x-dump-client -> 403 CSRF.
-  Login via curl with -H 'x-dump-client: 1' -H 'content-type: application/json' and the correct key returns a Set-Cookie with HttpOnly and SameSite=Strict (dev name, no Secure on http).
- Authorization: Bearer <UPLOAD_TOKEN> on GET /api/auth/session -> scope: "upload"; the same token on POST /api/auth/logout-all -> 403 FORBIDDEN_SCOPE.
-  Production build served with _headers present in dist/; no CSP violations in the browser console on the login screen.
-  No new runtime dependency added (JWT, bcrypt, zod, cookie, etc. are forbidden).
-  DECISIONS.md lists: no global lockout, bearer noise-limiter rationale, plain SHA-256 rationale, any typing workaround.
-  Spec saved at docs/spec/part-2.md.
STOP after this part. Do not start Part 3. Report using the format in Part 1, section 0, rule 6.