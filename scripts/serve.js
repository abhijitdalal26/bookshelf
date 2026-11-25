// Local server: serves the shelf app + the real book files + Drive sync API.
// App:  http://localhost:8931/
// PDFs: http://localhost:8931/files/<path under booksDir>
// Sync: POST http://localhost:8931/api/sync-drive  (mirrors booksDir into driveDir, if set)
// Status: GET http://localhost:8931/api/sync-status
// Notes:  GET/POST http://localhost:8931/api/notes  (reader highlights, kept in data/notes.json)
const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const ROOT = path.join(__dirname, "..");
const APP_DIR = path.join(ROOT, "app");
// paths and port come from shelf.config.json (see scripts/config.js)
const { booksDir: BOOKS_DIR, driveDir: DRIVE_DIR, driveSkip: DRIVE_SKIP, port: PORT } = require("./config");
const NOTES_FILE = path.join(ROOT, "data", "notes.json");
// Drive sync runs only when driveDir is set (Windows only: it uses robocopy); DISABLE_DRIVE_SYNC=1 turns it off.
const DRIVE_SYNC_ENABLED = !!DRIVE_DIR && process.platform === "win32" && process.env.DISABLE_DRIVE_SYNC !== "1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".epub": "application/epub+zip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function safeJoin(base, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  const baseAbs = path.resolve(base);
  const p = path.resolve(baseAbs, `.${path.sep}${rel}`);
  const relOut = path.relative(baseAbs, p);
  if (relOut === ".." || relOut.startsWith(`..${path.sep}`) || path.isAbsolute(relOut)) {
    return null; // path traversal guard
  }
  return p;
}

// Drive sync state
let syncState = { status: "idle", message: "", lastSync: null, progress: "" };

function syncToDrive() {
  if (!DRIVE_SYNC_ENABLED) {
    return { ok: false, message: "Drive sync is disabled" };
  }
  if (syncState.status === "syncing") {
    return { ok: false, message: "Sync already in progress" };
  }

  // Check if drive is available
  if (!fs.existsSync(path.dirname(DRIVE_DIR))) {
    syncState = { status: "error", message: "Google Drive is not connected", lastSync: syncState.lastSync, progress: "" };
    return { ok: false, message: syncState.message };
  }

  syncState = { status: "syncing", message: "Starting sync…", lastSync: syncState.lastSync, progress: "0%" };

  // Use robocopy for efficient incremental sync (only copies changed files)
  const cmd = `robocopy "${BOOKS_DIR}" "${DRIVE_DIR}" /E${DRIVE_SKIP.map((d) => ` /XD "${d}"`).join("")} /XF *.png *.txt *.tcl *.opt *.v *.sh *.prj *.ini /R:2 /W:2 /NFL /NDL /NJH /NJS /NC /NS /NP`; // add/update only: never deletes files already in Drive

  const proc = exec(cmd, { timeout: 0 }, (err, stdout, stderr) => {
    // robocopy exit codes 0-7 = success, 8+ = error
    const code = err ? err.code || 8 : 0;
    if (code >= 8) {
      syncState = {
        status: "error",
        message: `Sync failed (code ${code}): ${stderr || stdout}`.slice(0, 200),
        lastSync: syncState.lastSync,
        progress: "",
      };
    } else {
      syncState = {
        status: "done",
        message: "All books synced to Google Drive",
        lastSync: new Date().toISOString(),
        progress: "100%",
      };
    }
  });

  return { ok: true, message: "Sync started" };
}

http
  .createServer((req, res) => {
    // Same-origin only: no CORS headers, and cross-origin POSTs are rejected
    const origin = req.headers.origin;
    if (req.method === "POST" && origin) {
      let ok = false;
      try { ok = new URL(origin).host === req.headers.host; } catch { /* bad origin */ }
      if (!ok) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "Cross-origin request blocked" }));
        return;
      }
    }

    // API endpoints
    if (req.url === "/api/sync-drive" && req.method === "POST") {
      if (!DRIVE_SYNC_ENABLED) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "Drive sync is disabled" }));
        return;
      }
      const result = syncToDrive();
      res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    // reader highlights and notes, kept in data/notes.json
    if (req.url === "/api/notes" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(fs.existsSync(NOTES_FILE) ? fs.readFileSync(NOTES_FILE) : "{}");
      return;
    }
    if (req.url === "/api/notes" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 5e6) { res.writeHead(413); res.end(); req.destroy(); }
      });
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("bad notes");
          fs.writeFileSync(NOTES_FILE + ".tmp", JSON.stringify(data, null, 1));
          fs.renameSync(NOTES_FILE + ".tmp", NOTES_FILE);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"ok":false}');
        }
      });
      return;
    }

    if (req.url === "/api/sync-status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(syncState));
      return;
    }

    // Static file serving
    let urlPath = req.url;
    if (urlPath === "/") urlPath = "/index.html";

    let filePath;
    if (urlPath.startsWith("/files/")) {
      filePath = safeJoin(BOOKS_DIR, urlPath.slice("/files/".length));
    } else {
      filePath = safeJoin(APP_DIR, urlPath);
      if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
    }

    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const stat = fs.statSync(filePath);

    // Range request support for large PDFs
    const range = req.headers.range;
    if (range && ext === ".pdf") {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        "Content-Type": MIME[ext],
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
      "Cache-Control": [".pdf", ".html", ".js", ".css"].includes(ext) ? "no-cache" : "max-age=300",
    });
    fs.createReadStream(filePath).pipe(res);
  })
  .listen(PORT, () =>
    console.log(
      `shelf → http://localhost:${PORT}` +
        (DRIVE_SYNC_ENABLED ? "" : " (Drive sync disabled)")
    )
  );
