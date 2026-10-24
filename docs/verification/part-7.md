# Part 7 verification

Verified locally on Windows on 2026-10-24. The pasted Part 7 was saved verbatim and compared with Part 7 of the supplied full eight-part Markdown file; no missing functional requirements were found. Work stops before Part 8. No deployment, paid product, new dependency or real user upload was used.

## Acceptance checklist

| Item | Result |
| --- | --- |
| Build and distribution files | PASS: strict typecheck/build and gzip budget checks; dist contains manifest, sw.js, all five icons and existing _headers |
| Manifest/installability | PASS in installed Edge Chromium using a fresh persistent profile: DevTools protocol Page.getAppManifest has no errors; Page.getInstallabilityErrors is empty |
| Registration and cache privacy | PASS: production service worker controls the page; API metadata, originals, POST and Range responses are not from the service worker; CacheStorage contains no /api/ keys |
| Offline reload | PASS after a controlled online cache warm-up: cached HTML/assets open under real network blocking, show You're offline plus 30 anonymous skeletons, no file cells, and API requests fail; reconnect rechecks the session and recovers |
| Navigation timeout | PASS: a delayed navigation falls back to cached shell at 2,545 ms in the final run, matching the 2.5-second timeout |
| Cache bound/activation | PASS: 65 distinct static requests trim to exactly 60 entries; activation removes an obsolete cache and leaves dump-static-v1 |
| Update flow | PASS in an isolated copy of built assets: changed worker bytes wait; Update ready/Reload activates it, removes obsolete caches and performs exactly one navigation into changed HTML |
| Foreground update throttle | PASS: controlled visible-return events ten minutes apart produce two checks; a duplicate event in the same interval produces none |
| Icons | PASS: opened 180 Apple, 512 maskable and 32 favicon visually; decoded all five PNGs to verify sizes, transparent ordinary corners and fully opaque Apple/maskable pixels |
| Shortcut documentation/Settings | PASS: both numbered Shortcut flows, token test/rotation, privacy notes and troubleshooting table delivered; Settings shows current-origin upload URL, real clipboard Copy works and checklist expands |
| Install controls | PASS: iOS-identity emulation shows the hint, dismissal persists after reload, standalone emulation hides it; captured beforeinstallprompt calls prompt once and appinstalled updates Settings |
| Keyboard/viewport | PASS in Chromium emulation: simulated 300 px visual-viewport keyboard inset keeps the FAB above the visible bottom; landscape has no page overflow. Existing safe-area and selection-toolbar rules remain |
| CSP/browser errors | PASS: no securitypolicyviolation events or page exceptions during normal, offline, update or install flows; worker-src self remains unchanged |
| Tests and secrets | PASS: existing 83 tests in 16 files; project .dev.vars compared unchanged; isolated QA secrets removed and servers stopped |
| Physical iPhone/Safari checks | NOT RUN: no real iPhone or Safari/iOS simulator available; see device checklist below |
| Spec saved | PASS: docs/spec/part-7.md is byte-for-byte identical to the pasted attachment in the working tree |

Browser tests used production assets served by isolated local Wrangler D1/KV and a local proxy. The proxy delayed only a test navigation; an isolated static-directory copy supplied the update fixture, leaving project assets unchanged. A persistent browser profile avoided Chromium's expected in-incognito installability restriction. Offline emulation used DevTools network-state controls as well as blocking requests, because request blocking alone left navigator.onLine true in this environment.

## Measured artifacts

| Artifact | Bytes |
| --- | ---: |
| Initial JavaScript gzip, including shared modulepreload | 32,538 / 40,960 allowed |
| CSS gzip | 7,651 / 10,240 allowed |
| icon-192.png | 2,024 |
| icon-512.png | 6,899 |
| icon-512-maskable.png | 4,344 |
| apple-touch-icon-180.png | 1,415 |
| favicon-32.png | 335 |

The 180 px Apple icon is an opaque, full-bleed indigo square with a centred white downward arrow and open-top tray, smooth round caps and no baked-in corner mask. The 512 px maskable icon has the same opaque background and a visibly smaller glyph centred with ample safe-zone space (80 percent scaling). The 32 px favicon keeps a readable white arrow/tray inside a rounded indigo square. All five decoded sizes match the spec; every alpha byte in Apple/maskable output is 255. The generator is deterministic, uses 4×4 supersampling and Node built-ins, and is not part of the build pipeline.

## Interpretation and remaining device checklist

- Offline placeholders are a public boot-error view, not a cached/authenticated gallery. Session checks are never served from the service worker. The normal private HTTP-cache policy for originals from Part 3 is unchanged; no original or metadata is put into service-worker CacheStorage.
- The specified worker has no install-time precache. Tests warm static URLs under control before offline launch. Revisit/reload online after initial installation; an uncached first-ever offline visit cannot manufacture a shell.
- A new-worker toast requires changed worker bytes, following the [service-worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers). Hashed app-only changes are fetched on the next online navigation. The update fixture changed worker bytes and HTML in an isolated copy; no real deployment was performed.
- Chromium's [beforeinstallprompt](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event) UI path was exercised with a captured-event fixture. Actual OS install UI was not automated or claimed as completed.
- On a real iPhone, verify Add to Home Screen, separate installed-app login and persistence, dark/light status bar, launch/splash appearance and notch/home-indicator clearance in both orientations.
- Verify real keyboard opening/closing in Safari and the installed app, including search, FAB/activity controls and input zoom. Emulated viewport/identity checks do not establish native Safari behavior.
- Verify native Home Screen Copy into your chat. The existing denied/unavailable-copy toast and feature-gated Share remain; no physical iOS clipboard result is claimed.
- Build and run both Shortcuts on the phone: Photos/network permissions, HEIC/HEIF conversion, multi-image/PDF input, File request Content-Length, optional SHA and token scope. The [Shortcut guide](../ios-shortcut.md) supplies the exact contract and error table; Windows cannot confirm those device actions.

The requested default status-bar style was retained. No assumption about a physical-device result was used to change it.
