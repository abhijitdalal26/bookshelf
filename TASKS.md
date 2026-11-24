# TASKS

Sole developer: Claude. See CLAUDE.md for conventions.

## Hard constraint — local only

As of 2026-11-24 the user wants everything local. Do not sync or upload to Google Drive.
The Sync Drive button is hidden and `POST /api/sync-drive` returns 403 unless the server
is started with `ENABLE_DRIVE_SYNC=1`. Never enable that flag without explicit user approval.

## Current assignment

None. Pick from Backlog only with user approval.

## Sprint 1 — correctness and safety (P0)

### [x] T1 — "General" tab shows all books

Where: `app/shelf.js` — `buildTabs()` (~189), `filtered()` (~169), `seriesCounts()` (~152).

Problem: books with no series are counted under "General", but the tab is created with
value `""` (same as "All"), so clicking General shows every book.

Fix: give General a sentinel value (e.g. `"__general"`); in `filtered()` treat it as
`!b.series`. Keep "All" as `""`. Keep counts and `aria-pressed` correct.

Accept: All = total; General = only root-level books (series `""`); other tabs unchanged.

### [x] T2 — `/files/` path traversal guard

Where: `scripts/serve.js` — `safeJoin()` (~31).

Problem: `p.startsWith(base)` also accepts sibling directories (`D:\Books2\...`), so
`/files/..%5CBooks2%5Csecret.pdf` escapes `D:\Books`.

Fix: use `path.relative(base, p)` and reject when the result starts with `..` or is
absolute. Windows is case-insensitive; `path.relative` handles that. Optionally verify
with `fs.realpath` to block symlinks.

Accept: `/files/../../Windows/win.ini` and `/files/..%5CBooks2%5Cx.pdf` return 404;
normal PDFs still stream and Range requests still work.

### [x] T4 — arrow keys in search/sort move the shelf

Where: global `keydown` handler in `app/shelf.js` (~371).

Fix: return early when the event target is `input`, `select`, `textarea`, or
`[contenteditable]`. Keep Escape working globally.

Accept: arrows move the caret in the search box and do not scroll the shelf.

### [x] T5 — visible keyboard focus on spines

Where: `app/shelf.css`.

Problem: `.spine` is focusable (`tabIndex = 0`) but has no focus style.

Fix: add `.spine:focus-visible` with a ring that is obvious on both dark and light
spines (e.g. ink outline + white offset ring). Keep the existing reduced-motion rules.

Accept: Tab through the shelf; every focused spine has a clearly visible ring.

### [x] T6 — respect prefers-reduced-motion in tape physics

Where: `app/shelf.js` — `startLoop()` (~311), wheel/drag handlers.

Problem: CSS transitions are disabled, but the RAF easing and flick momentum still animate.

Fix: when `matchMedia("(prefers-reduced-motion: reduce)")` matches, snap `pos = target`
and `apply()` immediately; skip momentum on pointer release.

Accept: with reduced motion on, wheel/drag/arrow moves are instant and there is no glide.

### [x] T7 — stale books.js after rescan

Where: `scripts/serve.js` — static response headers (~150).

Problem: `Cache-Control: max-age=300` can serve an old `books.js` for 5 minutes after
`node scripts/scan-books.js`.

Fix: send `no-cache` (or `max-age=0, must-revalidate`) for `.html`, `.js`, `.css`.
Keep PDFs `no-cache` as they are.

Accept: rescan → reload → new titles appear immediately.

## Sprint 2 — in-app PDF reader (P1)

### [x] T8 — reader overlay

Where: `app/index.html`, `app/shelf.css`, `app/shelf.js`.

Goal: "Open PDF" reads the book inside the app instead of a new tab.

Spec:

- Add a full-screen overlay after `#detail`: `#reader` containing a top bar
  (`div.reader-bar` — do NOT use `<header>`, the global `header` CSS would hit it),
  prev/next buttons, title, "Open in new tab" fallback link, close button, and
  `<iframe id="reader-frame" title="Book">`.
- Hidden by default; toggle with `.shown` like `#detail`; use `aria-hidden` and `inert`
  when closed.
- `openReader(book)`: set iframe `src` to `fileUrl(book)`, set title, update prev/next
  disabled state, show overlay, focus close button, remember the opener.
- Prev/next walk the current `shown` array (respects filter + sort), clamped at the
  ends (disabled, no wrap).
- Keyboard while open: Escape closes; ArrowLeft/ArrowRight = prev/next. Shelf arrows
  must be suppressed while the reader is open.
- Close: clear iframe `src` (stop loading), hide overlay, restore focus to the opener.
- Detail button: `.pdf` opens the reader (prevent default); `.epub` keeps the current
  new-tab behavior; other types say "Open file" and open a new tab. Keep
  `detailOpen.href` set as a fallback.
- No libraries. The browser's built-in PDF viewer is fine.
- Mobile: keep "Open in new tab" visible; iOS may refuse to render PDFs in an iframe.
- Note: once focus is inside the PDF plugin, browser keys go to the PDF; shortcuts
  work whenever focus is in the app bar.

Accept: PDF opens in-app; prev/next works on a filtered/sorted shelf; Escape closes;
focus returns; shelf does not scroll behind the reader; EPUB unchanged.

## Sprint 3 — polish (P2)

### [x] T9 — resize / breakpoint handling

`addEventListener("resize")` only calls `apply()`. Recompute `posMin`/`posMax` and clamp
`target`/`pos`. Make `isMobile` recomputable; when crossing 640px, re-render
(debounce ~150ms). Accept: no stranded tape after resize; book sizes switch at the
breakpoint.

### [x] T10 — detail panel focus and inert

On open: save the opener, focus `#detail-close`, add `role="dialog"` and
`aria-labelledby="detail-title"`. When closed: make it inert so Tab cannot reach
off-screen controls, and restore focus to the spine that opened it. Accept: keyboard
navigation never lands in the hidden panel; Escape returns focus to the shelf.

### [x] T11 — hint consistency

`render()` calls `closeDetail(false)`, which never restores `#hint`. Make the hint
return whenever the detail is closed. Accept: open a book, search, hint is back.

## Sprint 4 — visual quality (P1, user request 2026-11-24)

### [x] T13 — make the shelf look really 3D and polished

Where: `app/shelf.css`, `app/shelf.js` (render only).

Goal: spines should read as solid books with real depth, not flat cards. Keep the light,
minimal reference look and the `.band` / `.st` / `.au` spine structure.

Spec:

- Add a `.face.pages` element to each `.vol` in `render()`, opposite the existing
  `.cover`: cream page block with a subtle repeating-linear-gradient (thin page lines),
  sized `var(--d)` x `var(--h)`, rotated `rotateY(-90deg)` and translated to the far edge.
  Keep the cover image face on the other side.
- Add a thin `.face.top` (head edge) if it reads well, using the same cream tone.
- Strengthen hover: `translateZ(64px) rotateY(-34deg)`, a deeper contact shadow under the
  spine, and a slight brightness lift on the cover. Selected book keeps the same pose.
- Reduce `#viewport` perspective from 1400px to ~1100px for a stronger 3D read on desktop;
  keep mobile at 900px.
- Add a soft highlight along the spine's left edge so individual books separate clearly.
- Keep `prefers-reduced-motion` rules (no new transitions that ignore them).

Accept: books visibly have thickness and a page block when hovered/selected; shelf still
scrolls and all controls work; no new libraries or CDN assets.

## Drive sync is ON (approved 2026-11-24)

### [x] T3 — sync API must not be callable cross-origin

Where: `scripts/serve.js` — CORS block (~82) and POST handler (~94).

Problem: `Access-Control-Allow-Origin: *` lets any web page POST `/api/sync-drive` and
trigger robocopy on the user's machine.

Fix: remove the wildcard (same-origin does not need CORS). For POST `/api/sync-drive`,
if an `Origin` header is present and its host differs from `req.headers.host`, return 403.

Accept: app works on localhost (and a LAN host if used); cross-origin POST gets 403.

### [ ] T12 — sync poll timeout

The sync poll runs forever if status never leaves `syncing`. Stop after ~6 minutes with
an error toast and clear the interval on error. Accept: no permanently stuck button.

## Backlog — do not start without user approval

- Infinite-loop tape. Needs a wrap-vs-bounce decision and conflicts with the current
  `posMin`/`posMax` clamping.
- EPUB in-app reading. Needs an EPUB engine; would break the no-dependency rule unless
  vendored. Decide with the user first.
- Self-host Geist. `app/index.html` currently loads Google Fonts, which contradicts the
  "CDN-free" convention. Either self-host the woff2 files or amend the convention —
  user decision.
- Sync `/PURGE` is destructive (deletes extra files in `J:\My Drive\Books`). Confirm
  intent with the user; do not change silently.
- Custom cursor. Needs approval; not scheduled.
- Dark mode. Convention says light only; needs an explicit request.

## Done means

- `node --check` clean
- manual verification reported in the final message
