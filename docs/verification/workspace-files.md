# Workspace design and general files

31 October 2026. Owner request: implement the approved [HTML workspace preview](../previews/workspace.html), remove rainbow/AI decoration, provide charcoal dark and cream light modes, and accept Markdown, HTML, TypeScript and other file formats without changing unrelated behavior.

## Implemented

- Desktop top search/workspace bar, sidebar, rounded content panel, real storage/file counts, gallery filters and filename/size/date captions. Mobile uses two columns and the existing accessible dialog for navigation. Gallery window scrolling, pagination, keyboard selection, thumbnail-only previews, Notes, Trash, clipboard, sign-out and durable recovery remain in use.
- Settings → Appearance offers Follow system, Charcoal dark and Cream light. Only the theme preference is stored locally. Browser form-control color scheme and theme-color follow the choice. No AI integration, rainbow effects, external fonts or packages were added.
- Files appears beside PDFs and in the sidebar. Pick/drop any nonempty file up to the existing 25 MiB cap. Known image/PDF signatures keep their existing behavior; other bytes are stored as `application/octet-stream`, regardless of client-claimed MIME. Sanitized filenames, extensions and dotfiles are preserved within the existing 200-character bound. Existing 900 MB capacity, free quotas, authentication, CSRF, scope, deduplication, streaming, expiry and Trash rules remain unchanged. No database migration or new resource is required.
- General files always download as attachments with octet-stream, nosniff and sandbox/default-none CSP. Uploaded HTML/SVG/scripts are never opened as active app content. Explicit source previews render escaped UTF-8 text only, up to 256 KiB; larger/binary files download. Source selection/scrolling does not trigger file-navigation/delete shortcuts. General files do not get image thumbnail jobs; server classification overrides a misleading client image label.

## Verification

- `npm run typecheck`, `npm test`, `npm run build`: passed. **119 tests / 24 files**, including filename/dotfile/extension preservation, safe download headers for HTML/SVG/code/archive names, file admission and content-type filtering.
- Final initial assets: **33,717 / 40,960 bytes JS gzip**, **8,707 / 10,240 bytes CSS gzip**. Budgets unchanged.
- Native-browser tests uploaded Markdown, HTML, TypeScript with browser `video/mp2t` MIME, ZIP, dotfiles, binary bytes, a misleading `.png`, and a one-byte text file. Downloaded bytes matched originals, filenames survived, general-file response headers were inert, source HTML remained literal and its script did not run, native download named the HTML file correctly, and a Markdown file above 256 KiB offered download without source preview.
- Dark/cream themes, explicit preference persistence across reload, desktop/phone navigation and no horizontal overflow at 1440/768/390 pixels passed. Screenshots were visually inspected; sample images are synthetic. A 5,000-record client fixture remained bounded below 150 mounted gallery cells after scrolling, with visible row geometry verified. This checks client virtualization, not a claim that the API returns 5,000 records per request.
- Sixteen focused browser cases plus the existing ten-group local API smoke suite passed with zero failures. These cover the new workspace/files cases, original/thumbnail lost responses, reload checkpoints, expired authentication, both sign-out choices, both 137-file paths, touch concurrency, Notes autosave, image clipboard, Trash, offline service-worker startup/API-cache exclusion, denied Web Locks, strict-durability fallback and Pause all. The three workspace cases and updated API smoke suite were rerun after final theme/source-cap changes.
- All destructive tests use an isolated temporary local Worker/D1/KV dataset and disposable browser contexts. No real device/iPhone execution is claimed. The prior recovery phone checklist still applies.

Reproduce using `scripts/test-upload-recovery.mjs` and its existing browser-runtime environment options. `DUMP_TEST=workspace` selects the new cases; `DUMP_SMOKE=1` includes the API smoke checks. The smoke suite now checks unknown/short bytes as safe generic downloads rather than expecting the superseded image-only rejection.

## Release

Restore checkpoint: `checkpoint/before-workspace-files-2026-10-31`, based on `200bff15fe96247b09ee16fb65f35c719f0deac7`, was pushed without changing the previous recovery checkpoint. Feature commit: `b78d5b9ab34c9338d2de2bb5688434a68e637ed6`, on `codex/part-1`. Staged secret/asset scanning, private environment-history and diff-whitespace checks passed. Credentials, personal files, screenshots, browser profiles and local state are not part of the commit.

Authorized release: [Dump](https://dump.sayemhasan74.workers.dev), Worker version `5fa2bad8-ee58-4208-8a59-c9968fbeddef`. The first D1 preflight returned a Cloudflare 7403 API error; account/resource checks succeeded and a retry passed with no migrations required. Deployment then completed using the existing free bindings and unchanged credentials.

Live HTTPS verified the current hashed frontend, CSP and anonymous denial; native IndexedDB retention/reload/explicit Resume; one accepted PNG original and thumbnail with no replay after reload; the Files filter; an HTML file with preserved bytes, octet-stream/attachment/nosniff/sandbox headers, and literal source that did not execute; both actual theme colors; and local theme persistence after reload. Only the two unique synthetic fixtures were trashed and purged. Existing files, Notes, server settings and credentials were not changed; unrelated original-file fetching was blocked during the check.

Reload the app once to load the update. Choose Settings → Appearance to switch themes; Files is available in the sidebar and beside PDFs.
