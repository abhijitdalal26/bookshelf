// Where book files come from.
// Local (scripts/serve.js): /files/<path under the books folder>.
// Hosted (Vercel): the same path under "My Drive/Books", read with the owner's own Google sign-in
// (read-only Drive scope). Nothing is shared publicly; the short-lived token stays in this browser.

(() => {
  const cfg = window.SHELF_CONFIG || {};
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  // a book's path under the books folder (books.js has absolute paths plus BOOKS_ROOT)
  const prefix = (window.BOOKS_ROOT || "") + "/";
  const rel = (window.relPath = (book) =>
    book.path.toLowerCase().startsWith(prefix.toLowerCase()) ? book.path.slice(prefix.length) : book.path);

  if (!local && !cfg.googleClientId) {
    const off = async () => { throw new Error("Reading isn’t set up on this site yet."); };
    window.bookSource = window.bookLink = off;
    window.bookNeedsSignIn = () => false;
    window.noteBackend = null;
    return;
  }

  if (local) {
    const url = (book) => "/files/" + rel(book).split("/").map(encodeURIComponent).join("/");
    window.bookSource = async (book) => ({ url: url(book) });
    window.bookLink = async (book) => url(book);
    window.bookNeedsSignIn = () => false;
    window.noteBackend = {
      available: () => local,
      load: async () => { const r = await fetch("/api/notes"); if (!r.ok) throw new Error(); return r.json(); },
      save: async (d) => {
        const r = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) });
        if (!r.ok) throw new Error();
      },
    };
    return;
  }

  const API = "https://www.googleapis.com/drive/v3/files";
  // read the books; keep notes in a private app-data file only this site can see
  const SCOPE = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.appdata";
  const TOKEN_KEY = "bookshelf-drive-token";
  const root = cfg.driveFolder || "Books";

  let token = null;
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
    if (t && t.exp > Date.now() + 60000) token = t;
  } catch {}

  // Sign-in is a full-page redirect to Google and back (no popup): the token comes back in the
  // address fragment, along with where to return to and whether a book was being opened.
  // Google tokens last an hour; after that, if we know the account, the redirect goes through
  // without any screen (prompt=none) and only falls back to the account chooser if Google asks.
  const RETURN_KEY = "bookshelf-signin-return";
  const HINT_KEY = "bookshelf-google-account";
  const redirectUri = location.origin + "/";
  let hint = null;
  try { hint = localStorage.getItem(HINT_KEY); } catch {}
  function signIn(read, silent = !!hint) {
    const state = Math.random().toString(36).slice(2);
    try { sessionStorage.setItem(RETURN_KEY, JSON.stringify({ state, hash: read ? "#" + encodeURIComponent(read) : location.hash, read, silent })); } catch {}
    const q = new URLSearchParams({
      client_id: cfg.googleClientId, redirect_uri: redirectUri, response_type: "token",
      scope: SCOPE, include_granted_scopes: "true", state,
    });
    if (hint) q.set("login_hint", hint);
    if (silent) q.set("prompt", "none");
    location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + q);
    return new Promise(() => {}); // the page is leaving
  }

  // back from Google: take the token, put the address back the way it was
  const back = new URLSearchParams(location.hash.slice(1));
  if (back.has("access_token") || back.has("error")) {
    let ret = null;
    try { ret = JSON.parse(sessionStorage.getItem(RETURN_KEY) || "null"); sessionStorage.removeItem(RETURN_KEY); } catch {}
    const ok = ret && back.get("state") === ret.state;
    if (ok && back.has("access_token")) {
      token = { v: back.get("access_token"), exp: Date.now() + (+back.get("expires_in") || 3600) * 1000 };
      try { localStorage.setItem(TOKEN_KEY, JSON.stringify(token)); } catch {}
      if (ret.read) window.resumeReading = ret.read;
      // remember which account this is, so the next sign-in can skip the chooser
      fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", { headers: { Authorization: `Bearer ${token.v}` } })
        .then((r) => r.ok && r.json()).then((j) => { if (j?.user?.emailAddress) localStorage.setItem(HINT_KEY, j.user.emailAddress); }).catch(() => {});
    } else if (ok && ret.silent && back.get("error") !== "access_denied") {
      // Google wants a screen after all (signed out, other account, new consent): ask properly
      signIn(ret.read, false);
    } else {
      addEventListener("DOMContentLoaded", () => window.shelfToast?.(back.get("error") === "access_denied" ? "Sign-in cancelled" : "Sign-in failed"));
    }
    history.replaceState(null, "", location.pathname + location.search + ((ok && ret.hash) || ""));
  }

  const valid = () => token && token.exp > Date.now() + 60000;
  window.bookNeedsSignIn = () => !valid();

  // header "Sign in" button, shown until there's a token
  const signinBtn = document.getElementById("signin-btn");
  if (signinBtn) {
    signinBtn.hidden = valid();
    signinBtn.addEventListener("click", () => signIn(null));
  }

  async function api(q, fields) {
    const out = [];
    let page = "";
    do {
      const u = `${API}?q=${encodeURIComponent(q)}&fields=nextPageToken,files(${fields})&pageSize=1000&spaces=drive` +
        (page ? `&pageToken=${page}` : "");
      const r = await fetch(u, { headers: { Authorization: `Bearer ${token.v}` } });
      if (r.status === 401) { token = null; if (signinBtn) signinBtn.hidden = false; throw new Error("Signed out — tap Read again"); }
      if (!r.ok) throw new Error("Drive error " + r.status);
      const j = await r.json();
      out.push(...j.files);
      page = j.nextPageToken;
    } while (page);
    return out;
  }

  // path under the Books folder -> file id, built from two listings (folders, PDFs)
  let index = null;
  async function buildIndex() {
    const folders = await api("mimeType='application/vnd.google-apps.folder' and trashed=false", "id,name,parents");
    const top = folders.find((f) => f.name === root && (f.parents || []).some((p) => !folders.some((g) => g.id === p)));
    if (!top) throw new Error(`No “${root}” folder in your Drive`);
    const byId = new Map(folders.map((f) => [f.id, f]));
    const pathOf = (id) => {
      if (id === top.id) return "";
      const f = byId.get(id);
      if (!f || !f.parents) return null;
      const up = pathOf(f.parents[0]);
      return up == null ? null : (up ? up + "/" : "") + f.name;
    };
    const files = await api("mimeType='application/pdf' and trashed=false", "id,name,parents,size");
    const m = new Map();
    for (const f of files) {
      const dir = pathOf((f.parents || [])[0]);
      if (dir != null) m.set(((dir ? dir + "/" : "") + f.name).toLowerCase(), { id: f.id, size: +f.size || 0 });
    }
    return m;
  }

  // the path -> id map is kept between visits (listing the whole Drive is the slow part)
  const INDEX_KEY = "bookshelf-drive-index-v2";
  try { localStorage.removeItem("bookshelf-drive-index"); } catch {}
  try {
    const c = JSON.parse(localStorage.getItem(INDEX_KEY) || "null");
    if (c && Date.now() - c.at < 7 * 864e5) index = Promise.resolve(new Map(c.map));
  } catch {}
  function freshIndex() {
    index = buildIndex().then((m) => {
      try { localStorage.setItem(INDEX_KEY, JSON.stringify({ at: Date.now(), map: [...m] })); } catch {}
      return m;
    }).catch((e) => { index = null; throw e; });
    return index;
  }
  // a cached id went stale (file replaced in Drive): forget the map so the next open rebuilds it
  window.bookSourceFailed = () => {
    index = null; session = null;
    try { localStorage.removeItem(INDEX_KEY); localStorage.removeItem(SESSION_KEY); localStorage.removeItem("bookshelf-r2-sizes"); } catch {}
  };

  async function fileOf(book) {
    if (!valid()) await signIn(rel(book));
    let f = (await (index || freshIndex())).get(rel(book).toLowerCase());
    if (!f) f = (await freshIndex()).get(rel(book).toLowerCase()); // maybe added since the map was made
    if (!f) throw new Error("This book isn’t in Drive yet");
    return f;
  }
  // signed in already and reading from Drive: get the map ready before anyone taps Read
  if (!cfg.filesUrl && valid() && !index) freshIndex().catch(() => {});

  // A book is read in 256 KB pieces (the reader's chunk size; small, because each request's
  // time is mostly fixed latency plus a little transfer), each fetched once and kept in the
  // browser's cache, so a book opened before opens instantly (and its read pages work offline).
  const CHUNK = 262144;
  const CACHE = "bookshelf-books-v3";
  try { caches.delete("bookshelf-books-v1"); caches.delete("bookshelf-books-v2"); } catch {}
  const flying = new Map();
  function chunk(src, i) {
    const id = `https://cache.bookshelf/${src.kind}/${encodeURIComponent(src.key)}/${i}`;
    if (flying.has(id)) return flying.get(id);
    const job = (async () => {
      let c = null;
      try { c = await caches.open(CACHE); const hit = await c.match(id); if (hit) return hit.arrayBuffer(); } catch {}
      const a = i * CHUNK, z = Math.min(src.size, a + CHUNK) - 1;
      const r = src.kind === "r2"
        ? await fetch(`${cfg.filesUrl}/${src.key.split("/").map(encodeURIComponent).join("/")}?p=${encodeURIComponent(session.pass)}`, { headers: { Range: `bytes=${a}-${z}` } })
        : await fetch(`${API}/${src.key}?alt=media`, { headers: { Authorization: `Bearer ${token.v}`, Range: `bytes=${a}-${z}` } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const buf = await r.arrayBuffer();
      c?.put(id, new Response(buf.slice(0))).catch(() => {});
      return buf;
    })().finally(() => flying.delete(id));
    flying.set(id, job);
    return job;
  }
  // bytes a..z-1, from the pieces that cover them (fetched side by side)
  async function bytes(src, a, z) {
    const first = Math.floor(a / CHUNK), last = Math.floor((z - 1) / CHUNK);
    const parts = await Promise.all(Array.from({ length: last - first + 1 }, (_, k) => chunk(src, first + k)));
    const out = new Uint8Array(z - a);
    let at = 0;
    parts.forEach((buf, k) => {
      const base = (first + k) * CHUNK;
      const piece = new Uint8Array(buf).subarray(Math.max(0, a - base), Math.min(buf.byteLength, z - base));
      out.set(piece, at); at += piece.length;
    });
    return out.buffer;
  }
  function source(src) {
    // PDF.js reads the end of the file (the index) first, then the start: ask for both now
    const n = Math.ceil(src.size / CHUNK);
    chunk(src, n - 1).catch(() => {});
    if (n > 1) chunk(src, 0).catch(() => {});
    return { length: src.size, fetchRange: (a, z) => bytes(src, a, z) };
  }

  // R2 through the Worker: one Google check buys a pass (7 days) plus every book's size, so
  // opening a book needs no sign-in round trip, and each piece is a single quick request.
  const SESSION_KEY = "bookshelf-r2-session";
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch {}
  async function r2Session(book) {
    if (session && session.exp > Date.now() + 36e5) return session;
    if (!valid()) await signIn(rel(book));
    const r = await fetch(`${cfg.filesUrl}/session`, { headers: { Authorization: `Bearer ${token.v}` } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    session = await r.json();
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
    return session;
  }

  // `length` + `fetchRange`: the reader asks for byte ranges itself (Drive hides range support
  // from other sites, so PDF.js would otherwise download the whole file before showing a page)
  window.bookSource = async (book) => {
    if (cfg.filesUrl) {
      const s = await r2Session(book).catch(() => null);
      const size = s?.sizes?.[rel(book)];
      if (size) return source({ kind: "r2", key: rel(book), size });
    }
    if (!valid()) await signIn(rel(book));
    const f = await fileOf(book);
    return source({ kind: "drive", key: f.id, size: f.size });
  };
  window.bookNeedsSignIn = () => !valid() && !(cfg.filesUrl && session && session.exp > Date.now() + 36e5);
  // download whole books, one after another, in the background (only with a pass, under 40 MB)
  window.preloadBooks = async (books) => {
    for (const book of books) {
      const size = cfg.filesUrl && session && session.exp > Date.now() + 36e5 && session.sizes?.[rel(book)];
      if (!size || size > 40 * 1048576) continue;
      const src = { kind: "r2", key: rel(book), size };
      for (let i = Math.ceil(size / CHUNK) - 1; i >= 0; i--) await chunk(src, i).catch(() => {});
    }
  };
  // warm a book's first pieces (never asks to sign in; only once a pass is held)
  window.prefetchBook = (book) => {
    const size = cfg.filesUrl && session && session.exp > Date.now() + 36e5 && session.sizes?.[rel(book)];
    if (size) source({ kind: "r2", key: rel(book), size });
  };
  window.bookLink = async (book) => `https://drive.google.com/file/d/${(await fileOf(book)).id}/view`;

  // notes.json in the Drive app-data folder (hidden from the Drive UI, private to this app)
  const NOTES = "notes.json";
  let notesId = null;
  async function findNotes() {
    if (notesId) return notesId;
    const r = await fetch(`${API}?spaces=appDataFolder&q=${encodeURIComponent(`name='${NOTES}'`)}&fields=files(id)`,
      { headers: { Authorization: `Bearer ${token.v}` } });
    if (!r.ok) throw new Error("Drive error " + r.status);
    notesId = (await r.json()).files[0]?.id || null;
    return notesId;
  }
  window.noteBackend = {
    available: valid,
    async load() {
      const id = await findNotes();
      if (!id) return {};
      const r = await fetch(`${API}/${id}?alt=media`, { headers: { Authorization: `Bearer ${token.v}` } });
      if (!r.ok) throw new Error("Drive error " + r.status);
      return r.json();
    },
    async save(d) {
      const id = await findNotes();
      const body = JSON.stringify(d);
      if (id) {
        const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
          method: "PATCH", headers: { Authorization: `Bearer ${token.v}`, "Content-Type": "application/json" }, body,
        });
        if (!r.ok) throw new Error("Drive error " + r.status);
        return;
      }
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify({ name: NOTES, parents: ["appDataFolder"] })], { type: "application/json" }));
      form.append("file", new Blob([body], { type: "application/json" }));
      const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
        method: "POST", headers: { Authorization: `Bearer ${token.v}` }, body: form,
      });
      if (!r.ok) throw new Error("Drive error " + r.status);
      notesId = (await r.json()).id;
    },
  };
})();
