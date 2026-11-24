# Bookshelf

A personal 3D bookshelf for a local library of PDFs/EPUBs: scrollable CSS-3D spines, covers on hover, in-app PDF reader, per-book notes, optional Google Drive mirroring.

Plain HTML/CSS/JS plus two small Node scripts. No build step, no dependencies.

```
node scripts/scan-books.js   # scan D:\Books, enrich via Open Library -> app/books.js
node scripts/build-about.js  # merge data/about-*.json -> app/about.js
node scripts/serve.js        # http://localhost:8931
```

`app/books.js` and `app/about.js` are generated and git-ignored; the books themselves never enter the repo.
Drive sync (`POST /api/sync-drive`) mirrors `D:\Books` to `J:\My Drive\Books` with robocopy, add/update only.
See `CLAUDE.md` for conventions.
