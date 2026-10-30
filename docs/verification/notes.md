# Notes verification — 30 October 2026 (Asia/Dhaka)

## Implemented behavior

Notes is beside PDFs and has a direct `#/notes` route. Plain-text blocks support create, edit, copy, cut-to-clear and confirmed permanent deletion. Text autosaves after a 600 ms pause, with Saved / Saving / pending / error feedback. Other visible Notes screens refresh within approximately four seconds; focus/reconnect refreshes immediately. Background polling stops, and unloaded block content is fetched near the viewport.

No editor character limit or total-per-block application cap is imposed. Each stored chunk is at most 8,192 UTF-16 code units (without splitting valid surrogate pairs); requests have an explicit 64 KiB JSON limit, and reads return at most four chunks per page. A block may span as many chunks as the existing free database/browser capacity permits. Metadata requests have a 1 KiB limit. D1's per-row maximum does not become a block-length cap. No new package, binding, paid product or external request was introduced.

Saves stage an immutable version and then atomically publish it using a version compare-and-swap, validating complete, contiguous chunks. Readers never observe an incomplete version. Stale updates/deletes return NOTE_CONFLICT; the browser keeps its draft and offers loading the remote version or saving the local text as a separate block. Retries recognize their own already-committed version without deleting another writer's staging chunks. Published old-version chunks are removed transactionally. Abandoned non-current staging rows older than a day are pruned in a bounded maintenance step; saved Notes are never auto-expired with files.

## Local checks

- `npm run typecheck`: pass.
- `npm test`: **107 tests in 22 files**, including route coverage and centralized JSON-limit audit.
- `npm run build`: pass. Initial JS gzip **33,152 / 40,960 bytes**; CSS **8,029 / 10,240**. Notes is lazy-loaded, approximately **3.7 KiB gzip**.
- Real SQLite tests execute the actual migration/trigger and route SQL, including atomic publish, incomplete versions, stale writes/deletes, empty text, cascade deletion and idempotent commits alongside another staged edit.
- A block with **over 2.1 million UTF-16 code units**, including Bengali/emoji, round-trips through bounded API pages and hundreds of small rows. Chunk splitting separately exercises much larger Unicode text and surrogate boundaries.
- Client regressions cover cutting to empty without chunk writes, typing while a previous save is in flight, conflict draft preservation, lost-acknowledgment recovery without duplicate writes, and sign-out ignoring old in-flight responses.
- Isolated local Wrangler D1/KV, generated temporary credentials and production assets tested in two independent Edge Chromium sessions. Create/autosave/Unicode sync, native Ctrl+X clearing the other device, multi-chunk paste, offline-vs-online conflict recovery preserving both versions, lost commit response/retry, hidden-screen polling pause, delete sync, and Notes-to-gallery navigation all pass.
- The large multi-line editor test sets the native textarea value and dispatches its input event: Playwright's fill helper stalled on that synthetic payload. Native Ctrl+X and ordinary text editing were tested separately. This is not a physical iPhone large-paste benchmark.
- Reviewed desktop light and 375px mobile dark screenshots; landscape and reduced-motion checks pass with no horizontal overflow. Labels, native textarea and 44px controls follow existing theme/accessibility patterns.
- Production CSP: zero violations on the Notes screen; no inline script/style elements and zero uncaught browser errors. Script-like pasted text remains literal and never executes.
- Existing project `.dev.vars` compared before/after and unchanged; QA credentials/state are outside the repository. No secret rotation or user files were needed for local tests.

## Security and limits

All Notes routes inherit the existing full-session gate, SameSite/HttpOnly cookies, Origin/fetch-site/client-header checks, generic errors and no-store headers. Anonymous access and upload-token read/write access are denied by route-coverage tests. Notes never enter the service-worker cache or browser localStorage; no note text is logged. Original file routes/storage are unchanged. Per-request limits remain centralized and bounded; no unbounded Worker JSON parser or whole-note buffer was added.

Notes use the existing private D1 database and no KV calls, so they do not spend the KV write/delete allowance. Free D1/database/request quotas still apply. Four-second polling is 900 requests/hour per continuously visible Notes tab, usually one small D1 row per unchanged poll, and no background polling. Saved text is not arbitrarily truncated. Offline/unsaved drafts exist in memory only: keep the tab open until Saved. A full CRDT/code-execution/rich-text editor was not added.

Physical iPhone Safari/Home Screen keyboard, selection and clipboard behavior require owner device testing. Chromium mobile emulation does not establish those results.

## Deployment

Live deployment verification is recorded in [the deployment log](deployment.md). Only the additive Notes migration and existing Worker/assets are required; credentials, files and existing metadata are preserved. Live smoke uses only its own temporary note block and removes it afterwards.
