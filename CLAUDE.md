# Bookshelf

A personal 3D bookshelf web app for the owner's real book collection.
Design reference: https://layoffsandhires.com/engineering — a minimal, light-themed
"tape" of CSS-3D book spines you scroll along; hover reveals the cover; click opens details.

Claude is the sole developer on this project. Work from `TASKS.md` and update it as tasks finish.

## Layout

```
app\
  index.html   page shell (header, search, tabs, viewport, detail panel, reader overlay)
  shelf.css    all styles (light theme, mobile-responsive)
  shelf.js     rendering, scroll/touch physics, interactions, detail panel, reader
  books.js     GENERATED (window.BOOKS). Never hand-edit; rerun the scanner.
scripts\
  scan-books.js  scans D:\Books, enriches via Open Library, writes app\books.js
                 (has manual overrides for files that get wrong matches)
  serve.js       local server on port 8931: serves app + PDFs under /files/
refs\            cloned reference repos, inspiration only, not used at runtime
TASKS.md         work queue and backlog
```

## Commands

- Rescan after adding/moving/removing books: `node scripts/scan-books.js`
- Run: `node scripts/serve.js` → http://localhost:8931 (PDFs at `/files/<path under D:\Books>`)
- Syntax check: `node --check app/shelf.js` and `node --check scripts/serve.js`

## Books folder (D:\Books)

- Each top-level folder is a collection tab; subfolders become "Parent / Child" tabs.
- Keep it tidy: no loose files in the root, no duplicates, folders named by topic.
  Rearranging files is fine when it improves the shelf — rescan afterwards and confirm
  the count and that every path in `books.js` still exists.

## Drive sync — ON HOLD

- User directive (2026-11-24): keep everything local. Do not upload or sync to Drive.
- The Sync Drive button is hidden and `POST /api/sync-drive` returns 403 unless the
  server runs with `ENABLE_DRIVE_SYNC=1`. Never set that flag or re-enable the button
  without explicit user approval.
- If ever re-enabled: Drive is `J:\My Drive`, books mirror to `J:\My Drive\Books` via
  robocopy, skipping xsim and World History screenshots.

## Conventions

- No build step, frameworks, or bundler. Plain HTML/CSS/JS.
- Light theme only: white bg, ink #0a0a0a, muted #666, hairline #e5e5e5, system sans.
- Books are CSS 3D: `.book > .vol > .face.spine + .face.cover` (plus `.face.pages` and
  `.face.top`) inside `#tape` (preserve-3d, perspective on `#viewport`).
- Spine structure must stay: `.band` (index) / `.st` (vertical title) / `.au` (vertical author).
- Don't use `<header>` inside overlays — the global `header` CSS would hit it.
- User-facing strings short and minimal, like the reference site.
- Accessibility: real buttons, aria labels, focus-visible outlines, `prefers-reduced-motion`
  respected in both CSS and the RAF physics.
- Ask before: infinite-loop tape, custom cursor, dark mode, EPUB engine, self-hosting
  fonts, anything touching Drive sync.

## Status

Done: scanning + Open Library enrichment, 3D spine shelf with momentum, cover reveal,
detail panel (dialog/inert/focus return), tabs, search, sort, read status, in-app PDF
reader, path-traversal guard, no-cache headers, resize handling, 3D page block/top edge,
hint restore (T11).
Open: see `TASKS.md` (deferred sync items and backlog only).
