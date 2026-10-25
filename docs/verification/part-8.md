# Part 8 verification — 25 October 2026 (Asia/Dhaka)

## Outcome and scope

Implemented the final milestone in `E:/Codes/Drop`: shared scheduled/manual maintenance, Settings cleanup, hardening, bounded smoke utilities, pinned dependencies, CI and the final README. Cross-checked the attached Part 8 against the original eight-part Markdown. The saved attachment's SHA-256 is `6C1DF947136103A7B7D9BDC20534BF88B2E1B01867B5FC42BBF53342B9889109`, identical to `docs/spec/part-8.md`. All eight parts and the approved Part 3 quota amendment are present.

**No Cloudflare deployment was performed**, as Part 8 explicitly requires. Account/payment-method state, live response headers and physical-device checks remain the owner's post-deployment work; they are not represented as completed local tests. The exact ordered deployment commands and device checklist are in [README](../../README.md#first-time-setup-and-deployment).

## Maintenance evidence

The same `runMaintenance(env, now)` is used by the cron export and `POST /api/maintenance/run`. Only `storage.ts` accesses `env.FILES`. Each step catches its own errors; production events contain counts or fixed step names, never keys, filenames, exceptions or secrets.

A real isolated local D1/KV test passed:

| Check | Result |
| --- | --- |
| 60-day-old unpinned file | Moved to Trash |
| 40-day-old pinned file | Kept active |
| Old trashed file | D1 row, original and thumbnail purged |
| Two-hour-old orphan | Deleted |
| Fresh orphan | Kept |
| Existing row with thumb_size = 0 and old thumbnail object | Metadata repaired; thumbnail retained |
| Returned budget counters | 14 operations, 4 KV mutations; below 400 / 250 |
| Local scheduled endpoint with cron `0 21 * * *` | HTTP 200 |

The pure/unit tests cover cutoffs, chunking, batch sizing, both operation limits, young/old/missing-metadata/foreign objects, existing rows, thumbnail repair, injected-clock cooldown, and the approved **non-throwing quota flag**. A quota test proves no more purge/orphan calls start after delete quota failure, while D1 login cleanup still runs. A 500-orphan page test proves only 249 deletes plus one list are reserved, the next cursor is not persisted and unfinished work is replayable. KV list quota failures are translated to StorageQuotaError.

Delete reservations happen before row deletion. The purge's atomic D1 batch rechecks the age/Trash predicate and returns only actually deleted rows, protecting concurrent restores. A page cursor advances only after its work completes. Counters are conservative upper bounds if a restore or quota stops already-reserved operations. The setting read is one separately counted D1 operation; the expiration update is another. Batch statements count individually. The limits apply per run, not globally per day; repeated manual runs can still consume the remaining daily allowance.

## Security hardening evidence

| Spec item | Evidence / result |
| --- | --- |
| 1. Cache clearing on sign-out | Both logout routes return `Clear-Site-Data: "cache"`; unit test passes. Unsupported browsers may ignore the header. |
| 2. Input limits | `limits.ts`: login/settings 1,024; patch 4,096; check 8,192; bulk 16,384 bytes. `npm test` source audit verifies all five JSON parser calls use the explicit centralized limit; value assertions also pass. Raw-file routes have separate byte limits. |
| 3. Header injection | Existing serve test exercises quotes, CR/LF, backslashes and Bengali in Content-Disposition; ASCII fallback and RFC 5987 encoding prevent raw injected headers. Other dynamic response headers are validated IDs, numeric values, fixed strings or signed cookies. |
| 4. Error hygiene | Forced database failure and thrown-handler tests return only the generic INTERNAL envelope; no SQL, stack, storage key or internal ID is echoed. |
| 5. Storage privacy | Every registered private route, including maintenance, denies anonymous requests and upload-token read/management access. Anonymous original returns 401. Only the authenticated original/thumb routes read stored file bodies. No f/ or t/ public route; no R2 binding. README has live verification steps. |
| 6. Dependencies | `.npmrc` save-exact; all direct versions pinned; lock committed. Runtime list exactly hono, preact, @preact/signals, fflate. `npm ls --depth=0` matches the allowlist. `npm audit --omit=dev`: **found 0 vulnerabilities** (0 high / 0 critical). |
| 7. Secrets / logging | Public source, docs and built JS scanned for literal 43-character base64url key/token/secret patterns: zero candidate files. Current local SESSION_SECRET checked against public files: zero matches. All Worker console output reviewed: fixed structured events only; no frontend console logging. `.dev.vars` ignored; `git rev-list --all -- .dev.vars` empty. |
| 8. Methods / coverage | Part 2 route coverage rerun against all current registered routes. OPTIONS, PUT and a custom method return the 404 envelope after authentication and normal CSRF. Anonymous unknown API paths remain 401 by the established security policy. |
| 9. Final cookie/CSRF E2E | Real login cookie works. Missing client header, wrong Origin, simulated cross-site mutation and cross-site read all return 403; upload-only reads return 403 and anonymous lists 401. Local smoke suite passes. |
| 10. CSP | Built production assets served through local Wrangler; login, gallery, viewer, Trash and Settings loaded with **zero securitypolicyviolation events and zero uncaught page errors**. No inline script/style elements; virtualization uses CSSOM style properties. Local static response has expected CSP/frame/security headers; Wrangler parses six _headers rules. Live headers pending owner deployment. |
| 11. Optional controls | README documents zone Security → WAF/Security rules → rate limiting for login, and disabling workers.dev only after a working custom domain. No paid feature enabled. |
| 12. Free plan | Config/products: Workers, Static Assets/ASSETS, D1/DB, KV/FILES, Cron Triggers, Observability. Source/config audit confirms no R2/Queues/Images/Stream/Durable Objects binding. Free-plan documentation reviewed; no card or paid subscription requested or enabled by this work. Owner checks actual account state after deploy. |
| 13. Storage operations | README endpoint table checked against storage call sites: original 1 write; thumbnail 1 write; serving 1 read or 0 for HEAD/304; trash/restore/list/search/check/stats/tags/settings 0; purge 1–2 deletes/file; failed original DB insert can add a cleanup delete. |

The full development-tree audit additionally reports **three development-only advisories**: miniflare moderate, undici high, wrangler moderate. The audit suggests downgrading Wrangler to 4.35.0; this was not applied blindly to the verified pinned 4.152.0 toolchain. These packages are not shipped in the browser or Worker runtime bundle. The required production-only audit is clean. Keep local dev tools on loopback and revisit a compatible patched release when updating the toolchain.

Cloudflare's [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/) specifies **separate** 1,000/day write, delete and list allowances, resetting 00:00 UTC. The requested shared maintenance counter is intentionally more conservative; the claim that it permanently reserves 750 upload operations for the entire day would be incorrect. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) for the other documented allowances.

## Performance measurements

Windows, Node 24.20.0, Wrangler 4.152.0, local simulated D1/KV, installed Edge Chromium. The isolated dataset was populated with **1,000 actual uploads through scripts/seed.mjs**, in addition to a few QA fixtures. No live free-plan quota was spent. Numbers below are local measurements, not remote network/CPU guarantees.

| Measurement | Observed | Target / interpretation |
| --- | --- | --- |
| GET files?limit=48 | First 10.61 ms; warmed median 14.26 ms, max 20.06 ms (10 measured warmed requests) | <100 ms: pass |
| GET thumbnail | Median 27.63 ms; max 34.65 ms (10 requests) | <50 ms: pass |
| 2,000,000-byte upload | HTTP 201, 143.4 ms | Pass |
| 25 MiB upload | HTTP 201, 1,564.4 ms; source streamed in 64 KiB chunks | Pass; separate memory check below |
| Warm screenshot Copy | 12.5 ms from captured click to actual Clipboard API completion | <300 ms: pass |
| Copy queue initial image | 16.1 ms | Measured actual PNG clipboard write |
| Prefetched Copy next | 12.6 ms | <100 ms: pass |
| Initial JS gzip | 32,549 bytes / 40,960 | Pass |
| Initial CSS gzip | 7,651 bytes / 10,240 | Pass |

The warmed list's Wrangler local observability spans show one `d1_all` operation; the repository list method issues one bounded SELECT. Cold settings/session-epoch cache misses add their own queries, so “one statement” is not a claim about every cold request. EXPLAIN QUERY PLAN for a dated active list reports `SEARCH files USING INDEX idx_files_active (id>?)`. Lists fetch `limit + 1` to determine whether another page exists (49 rows for 48 requested), plus each returned row's indexed tag subquery. Date/cursor bounds are ULID ranges. Name/type/pin/tag filtering may inspect more rows than returned: literal “only reads the rows returned for every search” is not true of these specified filters and was not claimed.

CPU/source review found no slow password hashing, server image processing, original-file hashing or full-original buffering in the Worker. Originals pass a small sniff prefix into a FixedLengthStream and then KV. Thumbnail buffering is limited to the 150 KiB upload route. JSON parsing is independently bounded. The 10 ms production CPU limit still needs live Observability review; local wall time does not measure that limit.

### Memory sampling during a paced 25 MiB upload

100 samples at roughly 100 ms intervals, on the two workerd processes belonging to an isolated QA server:

| Process | Baseline working set | Peak working set | Private bytes baseline → peak |
| --- | --- | --- | --- |
| Wrangler frontend proxy (listens on preview port) | 59,678,720 | 60,071,936 | 51,609,600 → 52,359,168 |
| Combined local app/storage runtime | 100,253,696 | 218,513,408 | 104,562,688 → 220,598,272 |

The frontend proxy grew about **0.38 MiB**; the combined application/storage runtime grew about **113 MiB** while persisting the file. This does not isolate the application heap from local KV emulation, so the spike cannot be attributed solely to storage, and the stronger no-memory-spike requirement is **not proven**. Source inspection confirms the Worker streams originals without assembling a whole-file buffer. These are Windows process working-set/private-byte observations, not per-isolate V8 heap or production Cloudflare measurements. Upload succeeded. Wrangler's inspector did not provide a usable runtime connection for the attempted heap probe; that probe is not represented as evidence.

### Lighthouse and accessibility

Standalone Lighthouse 13.5.0, mobile defaults with simulated throttling, against the production preview in installed headless Edge; no Lighthouse package was added to project dependencies. Local CLI automation uses the same Lighthouse engine as DevTools, rather than clicking the DevTools panel.

Initial run found an invalid ARIA label on the native file-picker label, duplicate PDF visible text/name mismatch, and a 0.209 gallery CLS caused by grid dimensions being measured after paint. Fixed the native label using real hidden text while retaining the native picker, made PDF naming explicit, and measured the initial grid in a layout effect. The rerun reduced CLS to **0** and reached 100 accessibility. The final rerun after the PDF adjustment has no remaining accessibility findings.

Final gallery: **Performance 97, Accessibility 100, Best Practices 100, SEO 58**; LCP **2,213 ms**, CLS **0**. Logged-out page: **100 / 100 / 96 / 54** in the same category order.

The logged-out session check intentionally returns 401; Lighthouse counts that expected network console entry against Best Practices. SEO is deliberately reduced by noindex; the private app is not meant to be searchable. Some Edge/Lighthouse trace attempts returned NO_NAVSTART; successful runs only are used for scores. No live deployment or physical iPhone results are implied.

Lazy chunk sizes (raw / gzip bytes): Viewer **8,881 / 3,478**; Trash **850 / 464**; Settings **5,670 / 2,331**; fflate browser **5,082 / 2,317**. The shared Dialog chunk is included in the initial HTML modulepreload budget.

## Verification and acceptance

- [x] Fresh npm ci, typecheck, **95 tests in 18 files**, production build and gzip budgets pass.
- [x] All direct dependencies pinned, clean production audit and allowlist reviewed.
- [x] CI YAML parsed successfully; Node 22, npm ci, typecheck, tests, build; no deploy or secrets.
- [x] Local API smoke suite and maintenance integration suite pass; safe production-subset control path also tested against loopback.
- [x] Cron dispatch, quota stopping, unfinished cursor replay and operation caps verified.
- [x] Hardening evidence above; README privacy and real-deploy verification steps present.
- [x] Local performance results reported with cold-cache/search/emulator/production-CPU limits explained.
- [ ] The stronger no-memory-spike claim is unproven: the combined local app/storage runtime spiked; an isolated Worker heap measurement was unavailable. No original-file buffering exists in the reviewed Worker source.
- [x] Final README, ordered user-run deployment commands, backup and real-device checklist complete.
- [x] All eight spec files saved; approved quota amendment carried forward; decisions logged.
- [ ] Owner deploys and verifies live response headers/account state.
- [ ] Owner completes the physical iPhone/Safari/Home Screen, Shortcut, clipboard and multi-device checklist in README.

## Known limitations

The clipboard generally holds one image per paste; Copy Queue and combined PNG sheets provide the specified workflow. iOS has an extra native picker tap and may suspend background work; uploads/copy/share need real-device verification. Safari and the installed app have separate logins. Shortcut originals are backfilled after the app opens, with the size/attempt limits documented in README. Practical free KV capacity is 1 GB with a 900 MB soft cap and roughly 400 images/day; other activity changes that estimate. Files are always served whole without partial downloads. KV propagation can take about a minute or longer across locations. The approximate metadata cap excludes temporarily orphaned bytes. Per-run cleanup limits are not a global daily quota lock. No deployment or physical-device check has been claimed as done.
