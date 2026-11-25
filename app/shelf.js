// CSS-3D tape shelf: spines you scroll along; whichever book passes the centre turns to show its
// cover, and clicking that cover grows the book page out of it.
// Design reference: layoffsandhires.com/engineering (light, minimal); the motion model and its
// constants follow that site's shelf.

const tape = document.getElementById("tape");
const viewport = document.getElementById("viewport");
const detail = document.getElementById("detail");
const tabsEl = document.getElementById("tabs");
const titleEl = document.getElementById("shelf-title");
const statsEl = document.getElementById("stats");
const emptyEl = document.getElementById("empty");
const searchEl = document.getElementById("search");
const sortEl = document.getElementById("sort");
const toastEl = document.getElementById("toast");
const syncBtn = document.getElementById("sync-btn");

// ---------- palette (the reference site's spine and band colours) ----------
const SPINES = [
  ["#EFECE6", "#141414"], ["#F3F1EC", "#141414"], ["#E9E5DC", "#141414"],
  ["#141414", "#F2F0EB"], ["#2B3150", "#F2F0EB"], ["#3B6FB6", "#F4F2ED"],
  ["#B3262C", "#F4F2ED"], ["#3D5A48", "#F2F0EB"], ["#5E5A2E", "#F2F0EB"],
  ["#6B2F35", "#F2ECDF"],
];
const BANDS = ["#BFC6CF", "#C8372D", "#C6D93B", "#D9A42B", "#2A6FB5", "#6E6A35",
  "#C9A0B5", "#B23A2E", "#7A5B3A", "#E8E4DA"];

function hashStr(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
// the real cover rendered from the PDF's first page (scripts/make-covers.py), unless that page is
// near-blank (a bare title page); then Open Library's cover or a typographic one stands in
const pdfCover = (b) => {
  const c = (window.COVERS || {})[b.path];
  return c && c.ink >= 0.035 ? c : null;
};
// spine colour comes from the cover's edge when there is a real cover
const spineOf = (b) => {
  const c = pdfCover(b);
  return c ? [c.bg, c.fg] : SPINES[hashStr(b.title) % SPINES.length];
};
const bandOf = (b) => BANDS[hashStr(b.author + b.title) % BANDS.length];
// dark or light text, whichever reads on a given background
function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const y = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return y > 150 ? "#141414" : "#f4f2ed";
}

const relPath = (book) => book.path.replace(/^D:\/Books\//i, "");

// series = from path segments
function seriesOf(book) {
  const rel = relPath(book);
  const seg = rel.split("/")[0];
  return seg && seg !== rel ? seg : "";
}

// ---------- read status (localStorage) ----------
const READ_KEY = "bookshelf-read-v1";
let readSet = new Set();
try { readSet = new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]")); } catch {}
const isRead = (b) => readSet.has(b.path);
function toggleRead(b) {
  if (readSet.has(b.path)) readSet.delete(b.path);
  else readSet.add(b.path);
  try { localStorage.setItem(READ_KEY, JSON.stringify([...readSet])); } catch {}
  for (const el of bookEls) if (el.book.path === b.path) el.sp.classList.toggle("read", readSet.has(b.path));
  updateStats();
}

// ---------- reading progress (synced with notes, see notes.js) ----------
function progressOf(book) {
  const p = window.noteStore?.getPos(book.path);
  return p && p.pages && p.page > 1 ? Math.min(100, Math.round((p.page / p.pages) * 100)) : 0;
}
function refreshProgress() {
  for (const b of bookEls) b.sp.style.setProperty("--p", progressOf(b.book) + "%");
  if (currentBook && detail.classList.contains("shown")) detailProgress(currentBook);
}
// the book page's Read button and progress line
function detailProgress(book) {
  const resume = window.readerProgress?.(book);
  document.getElementById("detail-read").textContent = resume ? `Continue · p. ${resume}` : "Read";
  const pos = window.noteStore.getPos(book.path);
  const nNotes = window.noteStore.list(book.path).length;
  document.getElementById("detail-progress").textContent = [
    pos && pos.pages && pos.page > 1 ? `Page ${pos.page} of ${pos.pages} · ${Math.round((pos.page / pos.pages) * 100)}%` : "",
    nNotes ? `${nNotes} highlight${nNotes === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");
}
window.shelfRefreshProgress = refreshProgress;

// ---------- cover art ----------
// "[O'Reilly] Title" -> "Title"
const cleanTitle = (t) => t.replace(/^\[[^\]]+\]\s*/, "");

// Open Library returns a 1x1 gif for unknown ids unless asked for a 404
function coverSrc(book, size) {
  if (!book.cover) return "";
  const src = book.cover.replace(/-[SML]\.jpg/, `-${size}.jpg`);
  return src + (src.includes("?") ? "&" : "?") + "default=false";
}

// a typographic cover in the spine's colours, with the real cover laid over it when one loads
function coverHTML(book, size) {
  const [bg, fg] = spineOf(book);
  const src = pdfCover(book)?.f || coverSrc(book, size);
  return `<div class="art"><div class="fc" style="background:${bg};color:${fg};--band:${bandOf(book)}">` +
    `<b>${escapeHtml(cleanTitle(book.title))}</b><i>${escapeHtml(book.author || "")}</i></div>` +
    (src ? `<img src="${src}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : "") +
    `</div>`;
}

// ---------- state ----------
const allBooks = (window.BOOKS || []).map((b) => ({ ...b, series: b.series || seriesOf(b) }));
allBooks.forEach((b) => { b._h = hashStr(b.path); });

let filter = "";
let query = "";
let sort = "title";
let shown = [];
let currentBook = null;
let detailOpener = null;

// tab = top-level collection ("History / Will Durant" -> "History")
const topOf = (s) => (s || "").split(" / ")[0];

function seriesCounts() {
  const m = new Map();
  allBooks.forEach((b) => {
    const s = topOf(b.series) || "General";
    m.set(s, (m.get(s) || 0) + 1);
  });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const SORTERS = {
  title: (a, b) => cleanTitle(a.title).localeCompare(cleanTitle(b.title)),
  author: (a, b) => (a.author || "").localeCompare(b.author || "") || a.title.localeCompare(b.title),
  year: (a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title),
  pages: (a, b) => (b.pages || 0) - (a.pages || 0) || a.title.localeCompare(b.title),
};

function filtered() {
  const q = query.trim().toLowerCase();
  return allBooks.filter((b) => {
    if (filter === "__general") { if (b.series) return false; }
    else if (filter && topOf(b.series) !== filter) return false;
    if (!q) return true;
    return (b.title + " " + (b.author || "") + " " + (b.series || "")).toLowerCase().includes(q);
  });
}

function updateStats() {
  const n = shown.length;
  const read = shown.filter(isRead).length;
  statsEl.textContent = `${n} book${n === 1 ? "" : "s"}` + (read ? ` · ${read} read` : "");
  titleEl.textContent = !filter ? "All books" : filter === "__general" ? "General" : filter;
}

// the dark pill slides under the active tab; on "All" it follows the centre book's collection
const tabInd = tabsEl.querySelector(".tab-ind");
function placeTabInd() {
  const on = (!filter && tabsEl.querySelector("button.here")) || tabsEl.querySelector("button.on");
  tabsEl.classList.toggle("follow", !filter && !!tabsEl.querySelector("button.here"));
  if (!on || !tabInd) return;
  tabInd.style.width = on.offsetWidth + "px";
  tabInd.style.transform = `translateX(${on.offsetLeft}px)`;
  if (on.offsetLeft < tabsEl.scrollLeft || on.offsetLeft + on.offsetWidth > tabsEl.scrollLeft + tabsEl.clientWidth)
    tabsEl.scrollTo({ left: on.offsetLeft - 4, behavior: reducedMotion.matches ? "auto" : "smooth" });
}

function buildTabs() {
  tabsEl.querySelectorAll("button").forEach((b) => b.remove());
  const mk = (label, val) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.dataset.val = val;
    btn.classList.toggle("on", filter === val);
    btn.setAttribute("aria-pressed", filter === val);
    btn.onclick = () => {
      filter = val;
      tabsEl.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("on", b === btn);
        b.setAttribute("aria-pressed", b === btn);
      });
      placeTabInd();
      render();
      markHere();
    };
    tabsEl.appendChild(btn);
  };
  mk("All", "");
  for (const [s] of seriesCounts()) mk(s, s === "General" ? "__general" : s);
  placeTabInd();
}

// ---------- tape rendering ----------
// The shelf is one continuous position `s` (in books; 0 = first book centred) easing towards a
// target `T`. Every frame each book is placed from its offset to `s`: the one passing the centre
// turns its cover to face you and the rest part around it. Scrolling just moves `T`.
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const probe = document.getElementById("probe");
const liveEl = document.getElementById("shelf-live");

const st = {
  s: 0, T: 0, T0: 0,
  H: 0, ws: 0, gap: 0, dMax: 0, dS: 0, widths: [],
  loop: false, y: 0,          // y = tape elements (copies × books) when looping
  active: -1,
  mx: -1, my: -1, tiltX: 0, tiltY: 0, hover: -1, over: false, onCover: false,
  open: false, closing: false, pushed: false, skipPop: false,
  down: false, dragging: false, moved: false, sx: 0,
};
let bookEls = [];            // { el, sp, cv, book, i, lift, vis, art }
let rafId = 0, lastT = 0, snapTimer = 0;

const mod = (a, n) => ((a % n) + n) % n;
// signed offset of tape element n from the centre, wrapped to the nearest copy when looping
const offsetOf = (n) => {
  if (!st.loop) return n - st.s;
  const r = mod(n - st.s, st.y);
  return r > st.y / 2 ? r - st.y : r;
};
// nearest target that centres book index k
const targetFor = (k) => {
  const r = Math.round(st.T);
  if (!st.loop) return k;
  const N = shown.length;
  return r + mod(k - mod(r, N) + N / 2, N) - N / 2;
};
const clampT = (v) => (st.loop || !shown.length ? v : Math.min(Math.max(v, 0), shown.length - 1));
const setT = (v) => { st.T = clampT(v); kick(); };

// every book stands the same height; the cover's width follows its real proportions
const aspectOf = (book) => Math.min(0.82, Math.max(0.6, pdfCover(book)?.ar || 0.7));

function measure() {
  st.H = probe.getBoundingClientRect().height || 300;
  st.ws = 0.15 * st.H;
  st.gap = 0.03 * st.H;
  st.widths = shown.map((b) => st.H * aspectOf(b));
  st.dMax = Math.max(0, ...st.widths);
  tape.style.setProperty("--hpx", st.H + "px");
  tape.style.setProperty("--ws", st.ws + "px");
  for (const b of bookEls) b.el.style.setProperty("--dd", st.widths[b.i] + "px");
}

function render() {
  shown = filtered().sort(SORTERS[sort] || SORTERS.title);
  updateStats();
  emptyEl.hidden = shown.length > 0;
  if (st.open) closeDetail(true);
  currentBook = null;

  tape.innerHTML = "";
  bookEls = [];
  const N = shown.length;
  measure();
  // loop once there are enough books to fill the width; repeat the set until the wrap is off-screen
  st.loop = N >= 8;
  const copies = st.loop
    ? Math.max(1, Math.ceil((viewport.clientWidth + 3 * st.dMax) / (N * (st.ws + st.gap))))
    : 1;
  st.y = copies * N;

  const frag = document.createDocumentFragment();
  for (let n = 0; n < st.y; n++) {
    const i = n % N, book = shown[i];
    const [bg, fg] = spineOf(book);
    const band = bandOf(book);
    const el = document.createElement("div");
    el.className = "book";
    el.dataset.v = n;
    el.style.cssText = `--bg:${bg};--fg:${fg};--band:${band};--dd:${st.widths[i]}px;visibility:hidden`;
    el.innerHTML =
      `<div class="face spine${isRead(book) ? " read" : ""}" style="--p:${progressOf(book)}%">` +
        `<div class="band" style="color:${inkOn(band)}">${String(i + 1).padStart(2, "0")}</div>` +
        `<div class="st">${escapeHtml(cleanTitle(book.title))}</div>` +
        `<div class="au">${escapeHtml(book.author || "")}</div>` +
      `</div>` +
      `<div class="face cover"></div>`;
    bookEls.push({ el, sp: el.children[0], cv: el.children[1], book, i, lift: 0, vis: false, art: false });
    frag.appendChild(el);
  }
  tape.appendChild(frag);

  st.s = st.T = st.T0 = st.loop ? N : 0;  // start on the first book (in the middle copy)
  st.active = -1;
  frame(performance.now(), true);
  kick();
}

// which tape element is nearest the centre
function centreEl() {
  let best = null, min = Infinity;
  for (const b of bookEls) {
    const d = Math.abs(offsetOf(+b.el.dataset.v));
    if (d < min) { min = d; best = b; }
  }
  return best;
}

// on "All", mark the collection chip of the book in the middle so you can see where it belongs
function markHere() {
  const b = filter ? null : currentBook;
  const val = b ? (b.series ? topOf(b.series) : "__general") : null;
  let here = null;
  tabsEl.querySelectorAll("button").forEach((t) => {
    const on = t.dataset.val === val;
    t.classList.toggle("here", on);
    if (on) here = t;
  });
  placeTabInd();
}

function announce() {
  const b = shown[st.active];
  if (!b) return;
  currentBook = b;
  markHere();
  // warm the large cover so the book page's ink reveal has it ready
  const big = pdfCover(b)?.f || coverSrc(b, "L");
  if (big) new Image().src = big;
  // a book that stays in the middle gets its first pieces fetched, so Read opens it at once
  clearTimeout(announce.warm);
  announce.warm = setTimeout(() => { if (currentBook === b) window.prefetchBook?.(b); }, 600);
  liveEl.textContent = `${cleanTitle(b.title)}${b.author ? ", " + b.author.replace(/\.$/, "") : ""}. ${st.active + 1} of ${shown.length}.`;
}

// one frame of the shelf; returns true while anything is still moving
function frame(now, force) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const rm = reducedMotion.matches;
  const N = shown.length;
  if (!N) return false;

  // ease s towards T, faster while dragging so the shelf sticks to the finger
  const prevS = st.s;
  if (rm) st.s = st.T;
  else {
    st.s += (st.T - st.s) * (1 - Math.exp(-(st.dragging ? 18 : 5.2) * dt));
    if (Math.abs(st.T - st.s) < 1e-4) st.s = st.T;
  }
  // keep the numbers small on a looping tape
  if (st.loop && Math.abs(st.s) > 4 * st.y) {
    const k = Math.trunc(st.s / st.y) * st.y;
    st.s -= k; st.T -= k; st.T0 -= k;
  }
  // the gap the centre cover needs, blended between the two books either side of s
  const g = Math.floor(st.s), f = st.s - g;
  const wAt = (k) => st.widths[st.loop ? mod(k, N) : Math.min(Math.max(k, 0), N - 1)];
  st.dS = wAt(g) * (1 - f) + wAt(g + 1) * f;

  const act = mod(Math.round(st.s), N);
  if (act !== st.active) { st.active = act; announce(); }

  // the centre cover leans towards the pointer
  const r = viewport.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  st.onCover = st.over && !st.open &&
    Math.abs(st.mx - cx) < 0.55 * st.dS && Math.abs(st.my - cy) < 0.55 * st.H &&
    Math.abs(st.T - st.s) < 0.3;
  viewport.classList.toggle("on-cover", st.onCover);
  const tY = st.onCover ? ((st.mx - cx) / (0.55 * st.dS)) * 9 : st.over ? ((st.mx - cx) / r.width) * 5 : 0;
  const tX = st.onCover ? (-(st.my - cy) / (st.H / 2)) * 6 : 0;
  const kt = rm ? 1 : 1 - Math.exp(-7 * dt);
  st.tiltY += (tY - st.tiltY) * kt;
  st.tiltX += (tX - st.tiltX) * kt;
  let moving = st.s !== st.T || Math.abs(tY - st.tiltY) > 0.01 || Math.abs(tX - st.tiltX) > 0.01;

  const kl = rm ? 1 : 1 - Math.exp(-12 * dt);
  const reach = r.width / 2 + 1.5 * st.dMax;
  const { ws, gap, dS, H } = st;
  for (const b of bookEls) {
    const n = +b.el.dataset.v;
    const c = offsetOf(n);
    // spines sit ws+gap apart; around the centre they slide apart to make room for the cover
    const x = c * (ws + gap) + (dS - ws + 1.6 * gap) *
      (Math.abs(c) < 1 ? (c + Math.sin(Math.PI * c) / Math.PI) / 2 : 0.5 * Math.sign(c));
    const want = st.hover === n && Math.abs(c) > 0.5 ? 1 : 0;
    b.lift += (want - b.lift) * kl;
    if (Math.abs(want - b.lift) > 0.002) moving = true; else b.lift = want;

    if (Math.abs(x) > reach) {
      if (b.vis) { b.el.style.visibility = "hidden"; b.vis = false; }
      continue;
    }
    const fresh = !b.vis;
    if (fresh) { b.el.style.visibility = ""; b.vis = true; }
    if (!b.art) { b.art = true; b.cv.innerHTML = coverHTML(b.book, "M"); }
    if (!force && !fresh && prevS === st.s && !moving && b.lift === want) continue;

    const o = Math.max(0, 1 - Math.abs(c));
    const d = o * o * (3 - 2 * o);     // smoothstep: 1 at the centre, 0 one book away
    b.el.style.transform =
      `perspective(2200px) translate3d(${x}px,${-0.025 * d * H - 0.045 * b.lift * H}px,${0.2 * d * H}px) ` +
      `rotateZ(${-4.5 * d}deg) rotateX(${st.tiltX * d}deg) rotateY(${-90 * d + st.tiltY * d}deg)`;
    b.el.style.zIndex = String(Math.max(0, Math.round(1000 - 4 * Math.abs(c))));
    b.sp.style.setProperty("--shade", (0.55 * d).toFixed(3));
    b.cv.style.setProperty("--shade", ((1 - d) * 0.5).toFixed(3));
  }
  return moving || st.dragging;
}

// run frames until the shelf comes to rest
function kick() {
  if (rafId) return;
  lastT = performance.now();
  const tick = (now) => {
    rafId = frame(now) ? requestAnimationFrame(tick) : 0;
  };
  rafId = requestAnimationFrame(tick);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- scroll / drag / hover ----------
viewport.addEventListener("wheel", (e) => {
  if (st.open || e.ctrlKey) return;
  e.preventDefault();
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  setT(st.T + (d * (e.deltaMode === 1 ? 30 : 1) / (st.ws + st.gap)) * 0.5);
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => setT(Math.round(st.T)), 160);
}, { passive: false });

viewport.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || st.open) return;
  st.down = true; st.dragging = false; st.moved = false;
  st.sx = e.clientX; st.T0 = st.T;
});
addEventListener("pointermove", (e) => {
  st.mx = e.clientX; st.my = e.clientY;
  if (st.over) kick();
  if (!st.down) return;
  const dx = e.clientX - st.sx;
  if (!st.dragging && Math.abs(dx) > 5) {
    st.dragging = st.moved = true;
    viewport.classList.add("dragging");
  }
  if (st.dragging) setT(st.T0 - dx / (st.ws + st.gap));
});
const endDrag = () => {
  if (st.dragging) setT(Math.round(st.T));
  st.dragging = st.down = false;
  viewport.classList.remove("dragging");
};
addEventListener("pointerup", endDrag);
addEventListener("pointercancel", () => { endDrag(); st.moved = false; });

viewport.addEventListener("pointerover", (e) => {
  const hit = e.target.closest?.(".book");
  st.hover = hit ? +hit.dataset.v : -1;
  kick();
});
viewport.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") st.over = true; });
viewport.addEventListener("pointerleave", () => { st.over = false; st.hover = -1; kick(); });

// click a spine to bring it to the centre; click the centre cover to open the book
viewport.addEventListener("click", (e) => {
  if (st.moved || st.open || !shown.length) return;
  const hit = e.target.closest(".book");
  if (hit) {
    const c = offsetOf(+hit.dataset.v);
    if (Math.abs(c) < 0.5) openBook();
    else setT(Math.round(st.T + c));
    return;
  }
  // a turned face isn't always hit-tested, so also accept clicks inside the centre cover's box
  const cb = centreEl()?.cv.getBoundingClientRect();
  if (cb && e.clientX >= cb.left && e.clientX <= cb.right && e.clientY >= cb.top && e.clientY <= cb.bottom) openBook();
});

// keyboard: arrows browse the shelf, Enter opens the centre book, Esc closes
addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.getElementById("reader").classList.contains("shown")) return;
  if (st.open) { if (e.key === "Escape") closeDetail(); return; }
  const t = e.target;
  if (t instanceof Element && (t.matches("input, select, textarea") || t.isContentEditable)) return;
  if (e.key === "ArrowRight") { e.preventDefault(); setT(Math.round(st.T) + 1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); setT(Math.round(st.T) - 1); }
  else if (e.key === "Enter" && (t === document.body || t === viewport)) { e.preventDefault(); openBook(); }
});

// ---------- book page ----------
const detailRead = document.getElementById("detail-read");
const detailOpen = document.getElementById("detail-open");
const detailStatus = document.getElementById("detail-status");



// the centre cover's box on screen, as a clip-path for the book page
const clipTo = (r) =>
  `inset(${r.top}px ${innerWidth - r.right}px ${innerHeight - r.bottom}px ${r.left}px round 3px)`;
const coverRect = () => centreEl()?.cv.getBoundingClientRect();

// click the centre cover: the book page grows out of it, tilted like the cover,
// then its text rises in line by line
function openBook(push = true) {
  if (st.open || st.closing || !shown.length) return;
  setT(Math.round(st.T));
  st.s = st.T;
  frame(performance.now(), true);
  const book = shown[mod(Math.round(st.s), shown.length)];
  currentBook = book;
  st.open = true;
  // each open book has its own address, so Back folds the page away
  if (push) { history.pushState(null, "", "#" + encodeURIComponent(relPath(book))); st.pushed = true; }
  detailOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  fillDetail(book);

  detail.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  detail.classList.add("shown");
  detail.setAttribute("aria-hidden", "false");
  detail.inert = false;
  detail.scrollTop = 0;
  const rm = reducedMotion.matches;
  const r = coverRect();
  if (r) {
    detail.style.transformOrigin = `${r.left + r.width / 2}px ${r.top + r.height / 2}px`;
    detail.animate(
      [{ clipPath: clipTo(r), transform: "rotate(-4.5deg)" },
       { clipPath: "inset(0px 0px 0px 0px round 0px)", transform: "rotate(0deg)" }],
      { duration: rm ? 1 : 1050, easing: "cubic-bezier(.76,0,.18,1)", fill: "both" });
  }
  const rise = (el, delay, from) => el.animate(
    [{ transform: from, opacity: from.includes("%") ? 1 : 0 }, { transform: "none", opacity: 1 }],
    { duration: rm ? 1 : 900, delay: rm ? 0 : delay, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" });
  const heads = [...detail.querySelectorAll(".dp-text > .m > *")];
  const rest = [...detail.querySelectorAll(".dp-text > :not(.m)")].filter((el) => !el.hidden && el.offsetHeight);
  heads.forEach((el, n) => rise(el, 620 + 75 * n, "translateY(110%)"));
  rest.forEach((el, n) => rise(el, 620 + 75 * heads.length + 40 * n, "translateY(28px)"));
  inkIn(rm);

  const isPdf = book.path.toLowerCase().endsWith(".pdf");
  (isPdf ? detailRead : document.getElementById("detail-close")).focus({ preventScroll: true });
}

// the big cover bleeds in like ink: the image is masked by noise-warped circles that grow
// from scattered points, each a little later than the last
const INK = [[150, 330, 0], [340, 600, 120], [250, 120, 220], [90, 760, 300],
  [400, 250, 360], [260, 860, 420], [230, 470, 180]];
let inkRaf = 0;
function inkCover(book) {
  const src = pdfCover(book)?.f || coverSrc(book, "L");
  const box = document.getElementById("detail-cover");
  const ar = aspectOf(book);
  box.style.aspectRatio = String(ar);
  if (!src) { box.innerHTML = coverHTML(book, "L"); return; }
  const W = 474, H = Math.round(W / ar);
  box.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
      `<defs>` +
        `<filter id="ink-f" filterUnits="userSpaceOnUse" x="-200" y="-200" width="874" height="1300">` +
          `<feTurbulence type="fractalNoise" baseFrequency=".011" numOctaves="3" seed="7" result="n"/>` +
          `<feDisplacementMap in="SourceGraphic" in2="n" scale="120" xChannelSelector="R" yChannelSelector="G"/>` +
        `</filter>` +
        `<mask id="ink-m" maskUnits="userSpaceOnUse" x="-200" y="-200" width="874" height="${H + 400}">` +
          `<g filter="url(#ink-f)" fill="#fff" transform="scale(1 ${H / 900})">` +
            INK.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0"/>`).join("") +
          `</g>` +
        `</mask>` +
      `</defs>` +
      `<image href="${escapeHtml(src)}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" mask="url(#ink-m)"/>` +
    `</svg>`;
  // an image that fails to load falls back to the typographic cover
  const img = new Image();
  img.onerror = () => { if (currentBook === book) box.innerHTML = coverHTML(book, "L"); };
  img.src = src;
}
function inkIn(rm) {
  cancelAnimationFrame(inkRaf);
  const circles = [...document.querySelectorAll("#detail-cover circle")];
  const t0 = performance.now(), start = t0 + (rm ? -5000 : 520);
  const tick = (t) => {
    circles.forEach((c, n) => {
      const k = Math.max(0, Math.min(1, (t - start - INK[n][2]) / 1250));
      c.setAttribute("r", String(720 * (1 - Math.pow(1 - k, 3))));
    });
    if (t - t0 < 2400 && st.open) inkRaf = requestAnimationFrame(tick);
  };
  inkRaf = requestAnimationFrame(tick);
}

function fillDetail(book) {
  const note = (window.ABOUT || {})[book.path];

  document.getElementById("detail-title").textContent = cleanTitle(book.title);
  document.getElementById("detail-author").textContent = book.author || "";
  inkCover(book);
  document.getElementById("detail-eyebrow").textContent =
    [book.series || "General", note?.kind].filter(Boolean).join(" · ");
  document.getElementById("detail-line").textContent = note?.takeaway || "";

  const aboutEl = document.getElementById("detail-about");
  if (note) {
    const topics = (note.topics || []).map((t, n) =>
      `<li><span>${String(n + 1).padStart(2, "0")}</span>${escapeHtml(t)}</li>`).join("");
    aboutEl.innerHTML =
      (note.about ? `<p class="about">${escapeHtml(note.about)}</p>` : "") +
      (note.readIf ? `<h3>Read it if</h3><p>${escapeHtml(note.readIf)}</p>` : "") +
      (topics ? `<h3>Topics</h3><ol class="topics">${topics}</ol>` : "");
  } else aboutEl.innerHTML = "";

  const row = (k, v) => `<div class="row"><span>${k}</span><b>${v}</b></div>`;
  document.getElementById("detail-meta").innerHTML = [
    note?.level && row("Level", escapeHtml(note.level)),
    book.year && row("Year", book.year),
    book.pages && row("Pages", book.pages),
    row("File", escapeHtml(relPath(book))),
  ].filter(Boolean).join("");

  const isPdf = book.path.toLowerCase().endsWith(".pdf");
  detailRead.hidden = !isPdf;
  detailProgress(book);
  detailStatus.textContent = isRead(book) ? "Read ✓" : "Mark read";
  detailStatus.classList.toggle("done", isRead(book));
}

// fold the book page back into the cover it came from (instant when the shelf is re-rendering)
function closeDetail(instant, fromHistory) {
  if (!st.open || st.closing) return;
  if (!fromHistory) {
    if (st.pushed) { st.pushed = false; st.skipPop = true; history.back(); }
    else if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }
  const opener = detailOpener;
  detailOpener = null;
  const done = () => {
    cancelAnimationFrame(inkRaf);
    detail.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    detail.classList.remove("shown");
    detail.setAttribute("aria-hidden", "true");
    detail.inert = true;
    st.open = st.closing = false;
    kick();
    if (opener && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    else viewport.focus({ preventScroll: true });
  };
  const r = !instant && coverRect();
  if (!r) return done();
  st.closing = true;
  detail.getAnimations().forEach((a) => a.cancel());
  detail.style.transformOrigin = `${r.left + r.width / 2}px ${r.top + r.height / 2}px`;
  detail.animate(
    [{ clipPath: "inset(0px 0px 0px 0px round 0px)", transform: "rotate(0deg)", opacity: 1 },
     { opacity: 1, offset: 0.6 },
     { clipPath: clipTo(r), transform: "rotate(-4.5deg)", opacity: 0 }],
    { duration: reducedMotion.matches ? 1 : 800, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" },
  ).onfinish = done;
}
document.getElementById("detail-close").addEventListener("click", () => closeDetail());

detailStatus.addEventListener("click", () => {
  if (!currentBook) return;
  toggleRead(currentBook);
  detailStatus.textContent = isRead(currentBook) ? "Read ✓" : "Mark read";
  detailStatus.classList.toggle("done", isRead(currentBook));
});
detailRead.addEventListener("click", () => {
  if (currentBook) window.openReader(currentBook, detailRead);
});
detailOpen.addEventListener("click", (e) => {
  e.preventDefault();
  if (!currentBook) return;
  // open the tab now (inside the click) and point it at the file once its link is known
  const tab = window.open("about:blank", "_blank");
  window.bookLink(currentBook)
    .then((url) => { if (tab) { tab.opener = null; tab.location = url; } })
    .catch((err) => { tab?.close(); toast(err.message || "Couldn’t open the file"); });
});

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
}
window.shelfToast = toast;

document.getElementById("empty-clear").addEventListener("click", () => {
  query = ""; filter = "";
  searchEl.value = "";
  buildTabs(); render();
});

searchEl.addEventListener("input", () => {
  query = searchEl.value;
  clearTimeout(searchEl._t);
  searchEl._t = setTimeout(render, 150);
});
sortEl.addEventListener("change", () => { sort = sortEl.value; render(); });

// ---------- Drive sync (only offered by the local server) ----------
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  fetch("/api/sync-status").then((r) => r.ok && r.json()).then((st) => { if (st) syncBtn.hidden = false; }).catch(() => {});
}
syncBtn.addEventListener("click", async () => {
  if (syncBtn.classList.contains("busy")) return;
  const done = (msg) => { syncBtn.classList.remove("busy"); syncBtn.textContent = "Sync"; toast(msg); };
  syncBtn.classList.add("busy");
  syncBtn.textContent = "Syncing…";
  try {
    const data = await (await fetch("/api/sync-drive", { method: "POST" })).json();
    if (!data.ok) return done(data.message || "Sync failed");
    const poll = setInterval(async () => {
      try {
        const st = await (await fetch("/api/sync-status")).json();
        if (st.status === "done") { clearInterval(poll); done("Synced to Drive"); }
        else if (st.status === "error") { clearInterval(poll); done(st.message || "Sync failed"); }
      } catch { /* keep polling */ }
    }, 1500);
  } catch (err) {
    done("Sync failed");
  }
});

// Resize: books scale with the shelf's height; redraw only if the loop no longer covers the width
let resizeTimer = null;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    measure();
    const N = shown.length;
    if (st.loop && N && st.y * (st.ws + st.gap) < viewport.clientWidth + 3 * st.dMax) {
      const keep = st.active;
      render();
      st.s = st.T = targetFor(keep);
    }
    frame(performance.now(), true);
    placeTabInd();
  }, 100);
}).observe(viewport);

document.getElementById("shelf-prev").addEventListener("click", () => setT(Math.round(st.T) - 1));
document.getElementById("shelf-next").addEventListener("click", () => setT(Math.round(st.T) + 1));
document.getElementById("shelf-open").addEventListener("click", () => openBook());

// ---------- links to a book (#<path under D:\Books>) ----------
// centre the book the address names (widening the filter if it's hidden) and open its page
function openFromHash() {
  const rel = decodeURIComponent(location.hash.slice(1));
  if (!rel) return false;
  let k = shown.findIndex((b) => relPath(b) === rel);
  if (k < 0 && allBooks.some((b) => relPath(b) === rel)) {
    filter = ""; query = ""; searchEl.value = "";
    buildTabs(); render();
    k = shown.findIndex((b) => relPath(b) === rel);
  }
  if (k < 0) return false;
  st.T = st.s = targetFor(k);
  openBook(false);
  return true;
}
addEventListener("popstate", () => {
  if (st.skipPop) { st.skipPop = false; return; }
  if (!location.hash) { st.pushed = false; closeDetail(false, true); return; }
  if (st.open || st.closing) return;
  if (openFromHash()) st.pushed = true;
  else history.replaceState(null, "", location.pathname + location.search);
});

// ---------- go ----------
buildTabs();
render();
document.fonts?.ready.then(placeTabInd);
requestAnimationFrame(() => tape.classList.add("ready"));
if (location.hash && !openFromHash()) history.replaceState(null, "", location.pathname + location.search);
// back from Google sign-in while opening a book: carry on into the reader (reader.js loads after this)
if (window.resumeReading && currentBook && relPath(currentBook) === window.resumeReading)
  addEventListener("DOMContentLoaded", () => window.openReader?.(currentBook, detailRead));
// progress synced from another device shows up once the note store has pulled
window.noteStore.ready().then(refreshProgress);
// the books being read (most recent first) download quietly in the background, so Continue opens at once
window.noteStore.ready().then(() => setTimeout(() => {
  const pos = window.noteStore.progress();
  const reading = allBooks.filter((b) => pos[b.path] && !isRead(b)).sort((a, b) => pos[b.path].at - pos[a.path].at);
  window.preloadBooks?.(reading.slice(0, 3));
}, 3000));
window.noteStore.onChange(refreshProgress);
