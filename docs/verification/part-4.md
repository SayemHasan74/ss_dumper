# Part 4 verification

Verified locally on Windows on 2026-10-24. No deployment or remote seeding was performed. Tests used an isolated Wrangler local D1/KV store and temporary credentials; the project's `.dev.vars` was unchanged. No dependencies were added.

## Automated checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS, frontend and Worker |
| `npm test` | PASS, 77 tests across 15 files |
| `npm run build` | PASS, including strict typecheck and gzip budgets |
| Initial JavaScript gzip | 16,950 bytes / 40,960 allowed |
| Initial CSS gzip | 5,684 bytes / 10,240 allowed |
| Viewer split | PASS, separate dynamic chunk, absent from initial HTML imports |
| HTTPS seed guard | PASS, refuses HTTPS without `--force` before uploading |
| Spec | Saved verbatim at `docs/spec/part-4.md` |

The unit suite covers the existing backend/security behavior. The frontend checks below used production assets served by local Wrangler with the production CSP, through bundled Playwright and installed Edge Chromium. Controlled responses were used only in the external test harness to exercise faults and delay images; no application mocks were added.

## Browser acceptance

| Area | Result and evidence |
| --- | --- |
| Auth/bootstrap | PASS: background only during session check, skeletons then grid; sign out and re-login work; simulated 401 clears/unmounts the gallery and resets filters |
| Filters/search | PASS: images/PDFs, tags, pinned, Today from local midnight, rolling seven days, debounced search, no matches and clear; stale search responses do not overwrite the newer query |
| Refresh | PASS: new-file pill defers insertion away from top; Show merges and scrolls to top; deleted recent items disappear; older loaded pages remain |
| Error states | PASS: first-page inline Retry, offline state and online recovery, load-more Retry after network failures, unfiltered empty state and hint |
| Viewer routing | PASS: cell opens hash route, Back closes, arrows replace the viewer entry, deep-link metadata fetch works without adjacent navigation, unknown hash canonicalizes to gallery |
| Viewer interaction | PASS: decoded original replaces thumbnail, zoom/Escape, focus trap/restore, exact scroll restoration, PDF Open/Download attributes, touch swipe navigation, double-tap and downward drag close |
| Retry/resource cleanup | PASS: new thumbnail/original retries once after three seconds; older failures do not automatically retry; explicit original Retry succeeds; blob URLs are revoked after close; backdrop closes with a thumbnail present |
| Theme/mobile | PASS: exact system light/dark backgrounds, 390 px portrait and 844×390 landscape without page overflow, three columns at 390 px, non-cell controls at least 44 px; safe-area CSS present |
| Motion | PASS: reduced-motion emulation disables skeleton animation and CSS transitions |
| Thumbnail layout | PASS: delayed successful thumbnail has explicit cell-sized width/height, unchanged cell bounding rectangle and thumbnail-load layout-shift score 0 |
| Security/browser errors | PASS: no CSP violation events or browser exceptions, no inline script/style elements; dimensions and offsets use permitted CSSOM style properties |

## Performance

An actual local seed of 5,000 PNGs plus three initial fixtures was fully paginated into the gallery (5,003 loaded files). The scrolling run used 180 animation-frame samples and a Chromium performance trace.

| Measurement | Observed |
| --- | --- |
| Maximum rendered file cells during fling | 104, below 120 |
| Median frame interval | 13.3 ms |
| 95th-percentile frame interval | 14.3 ms |
| Maximum frame interval | 16 ms |
| Intervals over 50 ms | 0 of 179 |
| Cached shell ready → skeleton | 581.1 ms |
| Navigation start → skeleton | 1177.6 ms |

Fast 3G emulation used 562.5 ms latency, 1.6 Mbps download and 750 Kbps upload at a 390 px viewport. Shell readiness was measured at DOMContentLoaded. The required session check stays ahead of gallery rendering. The shell-ready result passes the under-one-second interpretation approved after the user chose the safest option; full navigation **does not** meet a strict one-second interpretation. Both values are reported without hiding network/session latency.

These are local Chromium measurements, not guarantees for every device or network. Safe-area and native Back/edge-swipe/status-bar behavior still need a real iPhone/Safari check. No Safari or physical iPhone test is claimed. Screenshots and raw trace stay outside the repository. Part 5 has not been started.
