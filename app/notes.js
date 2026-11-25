// Highlights and notes: { "<book path>": { "<id>": { id, page, rects, text, note, at } } }.
// Cached in localStorage and synced through window.noteBackend (drive.js): the local server's
// data/notes.json, or a private app-data file in the owner's Google Drive on the hosted site.
// Each entry carries `at`; on merge the newer copy wins, and removals are kept as tombstones
// so a delete on one device isn't undone by another.

(() => {
  const KEY = "bookshelf-notes-v1";
  const POS = "_pos";
  let data = {};
  try { data = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
  const listeners = [];

  function merge(a, b) {
    const out = {};
    for (const src of [a, b]) for (const [path, items] of Object.entries(src || {})) {
      const dst = (out[path] = out[path] || {});
      for (const [id, h] of Object.entries(items || {})) if (!dst[id] || (h.at || 0) > (dst[id].at || 0)) dst[id] = h;
    }
    return out;
  }

  const cache = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} };
  const emit = () => listeners.forEach((f) => f());

  let pulled = null;
  async function pull() {
    const be = window.noteBackend;
    if (!be || !be.available()) return;
    try {
      const remote = await be.load();
      const before = JSON.stringify(data);
      data = merge(remote, data);
      cache();
      if (JSON.stringify(data) !== before) emit();
      if (JSON.stringify(remote) !== JSON.stringify(data)) push();
    } catch { /* offline or signed out: keep the local copy */ }
  }

  let timer = null;
  function push() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const be = window.noteBackend;
      if (!be || !be.available()) return;
      try {
        // fold in anything another device saved meanwhile, then write
        data = merge(await be.load(), data);
        cache();
        await be.save(data);
      } catch { /* will retry on the next change */ }
    }, 800);
  }

  window.noteStore = {
    // syncs once a backend is reachable (on the hosted site: after Google sign-in)
    ready() {
      if (!pulled || !pulled.done) pulled = Object.assign(pull().then(() => { pulled.done = window.noteBackend?.available(); }), { done: false });
      return pulled;
    },
    list(path) { return Object.values(data[path] || {}).filter((h) => !h.deleted && h.id !== POS); },
    // reading position rides along with the notes so it follows you between devices
    getPos(path) { return data[path]?.[POS] || null; },
    setPos(path, page, pages) {
      if (data[path]?.[POS]?.page === page) return;
      data[path] = data[path] || {};
      data[path][POS] = { id: POS, page, pages, at: Date.now() };
      cache(); push();
    },
    progress() {
      const out = {};
      for (const [path, items] of Object.entries(data)) if (items[POS]) out[path] = items[POS];
      return out;
    },
    put(path, h) {
      data[path] = data[path] || {};
      data[path][h.id] = { ...h, at: Date.now() };
      cache(); emit(); push();
    },
    remove(path, id) {
      if (!data[path]?.[id]) return;
      data[path][id] = { id, deleted: true, at: Date.now() };
      cache(); emit(); push();
    },
    onChange(f) { listeners.push(f); },
  };
})();
