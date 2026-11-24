// CSS-3D tape shelf — spines you scroll along, covers on hover, click to open.
// Design reference: layoffsandhires.com/engineering (light, minimal, Geist-like sans).

const tape = document.getElementById("tape");
const viewport = document.getElementById("viewport");
const detail = document.getElementById("detail");
const hint = document.getElementById("hint");
const tabsEl = document.getElementById("tabs");
const statsEl = document.getElementById("stats");
const emptyEl = document.getElementById("empty");
const searchEl = document.getElementById("search");
const sortEl = document.getElementById("sort");
const toastEl = document.getElementById("toast");
const syncBtn = document.getElementById("sync-btn");

// ---------- palette (mirrors the reference site's spine colors) ----------
const SPINES = [
  ["#232226", "#EDEBE6"], ["#121212", "#EDEBE6"], ["#B3202A", "#F4F2ED"],
  ["#383D63", "#F4F2ED"], ["#4C76B6", "#F4F2ED"], ["#2F63A6", "#F4F2ED"],
  ["#3E5A49", "#F4F2ED"], ["#141012", "#F4F2ED"], ["#ECEAE4", "#141414"],
  ["#EFEBE2", "#141414"], ["#5C2E2E", "#F0E8DA"], ["#2E4A3A", "#EFE8D8"],
  ["#3A3F66", "#EDEAE0"], ["#6E3038", "#F2ECDC"], ["#ECE5D3", "#1c1c1c"],
];
const BANDS = ["#5B8FD0", "#BFC6CF", "#C8372D", "#C6D93B", "#D9A42B", "#B23A2E",
  "#7A5B3A", "#D21F2C", "#C9A0B5", "#2A6FB5", "#8A9A5B", "#E8E4DA"];

function hashStr(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
const spineOf = (b) => SPINES[hashStr(b.title) % SPINES.length];
const bandOf = (b) => BANDS[hashStr(b.author + b.title) % BANDS.length];

// series = from path segments
function seriesOf(book) {
  const rel = book.path.replace(/^D:\/Books\//i, "");
  const seg = rel.split("/")[0];
  return seg && seg !== rel ? seg : "";
}

// local URL for the real file, served by scripts/serve.js
function fileUrl(book) {
  const rel = book.path.replace(/^D:\/Books\//i, "");
  return "/files/" + rel.split("/").map(encodeURIComponent).join("/");
}

// ---------- read status (localStorage) ----------
const READ_KEY = "bookshelf-read-v1";
let readSet = new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]"));
const isRead = (b) => readSet.has(b.path);
function toggleRead(b) {
  if (readSet.has(b.path)) readSet.delete(b.path);
  else readSet.add(b.path);
  localStorage.setItem(READ_KEY, JSON.stringify([...readSet]));
  refreshSpineState(b);
  updateStats();
}
function refreshSpineState(b) {
  document.querySelectorAll(`.book[data-path="${CSS.escape(b.path)}"] .spine`)
    .forEach((s) => s.classList.toggle("read", readSet.has(b.path)));
}

// ---------- cover art ----------
function wrapTitle(title, maxChars, maxLines) {
  const lines = [];
  let cur = "";
  for (const w of title.split(" ")) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur.trim()) lines.push(cur.trim());
      cur = w;
    } else cur += " " + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.slice(0, maxLines);
}

function makeCover(book) {
  const [bg, fg] = spineOf(book);
  const W = 420, H = 600;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");

  // wrap text to a pixel width using the current font
  const wrapPx = (text, maxW) => {
    const lines = [];
    let cur = "";
    for (const w of text.split(" ")) {
      const t = cur ? cur + " " + w : w;
      if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  };

  const draw = (img) => {
    g.clearRect(0, 0, W, H);
    if (img) {
      // real cover art: shown clean, scaled to fill, no overlays
      const ar = img.width / img.height;
      let dw = W, dh = W / ar;
      if (dh < H) { dh = H; dw = H * ar; }
      g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      return c.toDataURL("image/jpeg", 0.92);
    }

    // no cover found: editorial typographic cover in the book's spine colours
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const sheen = g.createLinearGradient(0, 0, W, H);
    sheen.addColorStop(0, "rgba(255,255,255,.07)");
    sheen.addColorStop(1, "rgba(0,0,0,.14)");
    g.fillStyle = sheen; g.fillRect(0, 0, W, H);

    g.fillStyle = bandOf(book); g.fillRect(0, 0, W, 78);
    g.fillStyle = bg;
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.font = "700 20px system-ui, sans-serif";
    g.letterSpacing = "3px";
    g.fillText(topOf(book.series).toUpperCase().slice(0, 22), 36, 48);
    g.letterSpacing = "0px";

    const title = book.title.replace(/^\[[^\]]+\]\s*/, "");
    let size = 60, lines;
    for (; size >= 36; size -= 4) {
      g.font = `800 ${size}px system-ui, sans-serif`;
      lines = wrapPx(title, W - 72);
      if (lines.length <= 6) break;
    }
    lines = lines.slice(0, 6);
    g.fillStyle = fg;
    lines.forEach((ln, i) => g.fillText(ln, 36, 170 + i * size * 1.08));

    g.fillStyle = fg; g.globalAlpha = .5; g.fillRect(36, H - 112, 56, 4); g.globalAlpha = 1;
    if (book.author) {
      g.font = "600 22px system-ui, sans-serif";
      g.letterSpacing = "2px";
      wrapPx(book.author.toUpperCase(), W - 72).slice(0, 2)
        .forEach((ln, i) => g.fillText(ln, 36, H - 70 + i * 28));
      g.letterSpacing = "0px";
    }
    return c.toDataURL("image/jpeg", 0.92);
  };

  if (book.cover) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { book._coverURL = draw(img); applyCover(book); };
    img.onerror = () => { book._coverURL = draw(null); applyCover(book); };
    img.src = book.cover;
    book._coverURL = draw(null);
  } else {
    book._coverURL = draw(null);
  }
  return book._coverURL;
}

const coverEls = new Map(); // book -> [elements]
function applyCover(book) {
  // keep an open detail panel in step when the real cover arrives late
  if (typeof currentBook !== "undefined" && currentBook === book) {
    document.getElementById("detail-cover").style.backgroundImage = `url("${book._coverURL}")`;
  }
  (coverEls.get(book) || []).forEach((el) => {
    el.style.backgroundImage = `url("${book._coverURL}")`;
  });
}

// ---------- state ----------
const allBooks = (window.BOOKS || []).map((b) => ({ ...b, series: b.series || seriesOf(b) }));
allBooks.forEach((b) => { b._h = hashStr(b.path); b._coverURL = makeCover(b); });

let filter = "";
let query = "";
let sort = "title";
let shown = [];
let currentBook = null;
let detailOpener = null;

function seriesCounts() {
  const m = new Map();
  allBooks.forEach((b) => {
    const s = topOf(b.series) || "General";
    m.set(s, (m.get(s) || 0) + 1);
  });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const SORTERS = {
  title: (a, b) => a.title.localeCompare(b.title),
  author: (a, b) => (a.author || "").localeCompare(b.author || "") || a.title.localeCompare(b.title),
  series: (a, b) => (a.series || "").localeCompare(b.series || "") || a.title.localeCompare(b.title),
  year: (a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title),
  pages: (a, b) => (b.pages || 0) - (a.pages || 0) || a.title.localeCompare(b.title),
};

function filtered() {
  const q = query.trim().toLowerCase();
  return allBooks.filter((b) => {
    if (filter === "__general") { if (b.series) return false; }
    else if (filter && topOf(b.series) !== filter) return false;
    if (!q) return true;
    return (b.title + " " + (b.author || "") + " " + (b.series || ""))
      .toLowerCase().includes(q);
  });
}

function updateStats() {
  const n = shown.length;
  const read = shown.filter(isRead).length;
  const pages = shown.reduce((s, b) => s + (b.pages || 0), 0);
  statsEl.textContent =
    `${n} volume${n === 1 ? "" : "s"}` +
    (read ? ` · ${read} read` : "") +
    (pages ? ` · ~${pages.toLocaleString()} pages` : "");
}

function buildTabs() {
  tabsEl.innerHTML = "";
  const mk = (label, val, n) => {
    const btn = document.createElement("button");
    btn.textContent = n != null ? `${label} · ${n}` : label;
    btn.classList.toggle("on", filter === val);
    btn.setAttribute("aria-pressed", filter === val);
    btn.onclick = () => { filter = val; buildTabs(); render(); };
    tabsEl.appendChild(btn);
  };
  mk("All", "", allBooks.length);
  for (const [s, n] of seriesCounts()) mk(s, s === "General" ? "__general" : s, n);
}

// ---------- tape rendering ----------
let pos = 0, target = 0, lastPos = 0, posMin = 0, posMax = 0, rafId = null;
let tapeWidth = 0;

// Mobile detection — recomputed on resize so book sizes switch at the breakpoint
function isMobile() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth <= 640;
}
let lastMobile = isMobile();

// Accessibility: when reduced motion is on, the tape snaps instead of easing
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// ws = spine width, h = height, d = depth (= cover width when revealed), base = half the tallest book
function dimsFor(book) {
  const r = book._h;
  if (isMobile()) {
    return { ws: 34 + (r % 10), h: 226 + ((r >> 5) % 10), d: 150 + ((r >> 11) % 25), base: 120 };
  }
  return { ws: 46 + (r % 18), h: 322 + ((r >> 5) % 12), d: 200 + ((r >> 11) % 40), base: 170 };
}

// "[O'Reilly] Title" -> "Title" on the spine
const spineTitle = (t) => t.replace(/^\[[^\]]+\]\s*/, "");

// tab = top-level collection ("History / Will Durant" -> "History")
function topOf(s) { return (s || "").split(" / ")[0]; }

// looping tape: three copies of the set, pos wraps inside the middle one
let loop = false, setW = 0;
const clampT = (v) => (loop ? v : Math.min(Math.max(v, posMin), posMax));

function render() {
  shown = filtered().sort(SORTERS[sort] || SORTERS.title);
  updateStats();
  emptyEl.hidden = shown.length > 0;

  tape.innerHTML = "";
  coverEls.clear();
  currentBook = null;
  closeDetail();

  const mob = isMobile();
  const base = mob ? 120 : 170;
  viewport.style.setProperty("--base", base + "px");

  // width of one pass of the set, to decide whether looping makes sense
  const gapOf = (b) => (mob ? 5 : 8) + ((b._h >> 3) % (mob ? 4 : 7));
  setW = shown.reduce((s, b) => s + dimsFor(b).ws + gapOf(b), 0);
  loop = setW > viewport.clientWidth * 1.5;
  const copies = loop ? 3 : 1;

  let x = 0, firstW = 0;
  const frag = document.createDocumentFragment();
  for (let c = 0; c < copies; c++) shown.forEach((book, i) => {
    const { ws, h, d } = dimsFor(book);
    const [bg, fg] = spineOf(book);
    if (c === 0 && i === 0) firstW = ws;

    const el = document.createElement("div");
    el.className = "book";
    el.style.setProperty("--i", Math.min(i, 24));
    el.dataset.path = book.path;
    el.dataset.cx = x + ws / 2;
    el.style.transform = `translate3d(${x + ws / 2}px, ${base - h / 2}px, 0)`;
    el.style.setProperty("--w", ws + "px");
    el.style.setProperty("--h", h + "px");
    el.style.setProperty("--d", d + "px");

    const vol = document.createElement("div");
    vol.className = "vol";

    const spine = document.createElement("div");
    spine.className = "face spine" + (isRead(book) ? " read" : "");
    spine.style.width = ws + "px";
    spine.style.height = h + "px";
    spine.style.left = -ws / 2 + "px";
    spine.style.top = -h / 2 + "px";
    spine.style.background = `linear-gradient(90deg, ${bg} 0%, ${bg} 55%, rgba(0,0,0,.22) 100%)`;
    spine.style.color = fg;
    spine.setAttribute("role", "button");
    spine.setAttribute("aria-label", `Open ${book.title}`);
    spine.tabIndex = 0;
    spine.innerHTML =
      `<div class="band" style="background:${bandOf(book)};color:${bg}">${String(i + 1).padStart(2, "0")}</div>` +
      `<div class="st">${escapeHtml(spineTitle(book.title))}</div>` +
      `<div class="au">${escapeHtml(book.author || "")}</div>`;

    const cover = document.createElement("div");
    cover.className = "face cover";
    cover.style.backgroundImage = `url("${book._coverURL}")`;
    coverEls.set(book, (coverEls.get(book) || []).concat(cover));

    const pages = document.createElement("div");
    pages.className = "face pages";
    pages.style.background = `linear-gradient(90deg, rgba(0,0,0,.28), ${bg} 40%, ${bg})`;

    const top = document.createElement("div");
    top.className = "face top";

    vol.appendChild(spine);
    vol.appendChild(cover);
    vol.appendChild(pages);
    vol.appendChild(top);
    el.appendChild(vol);
    frag.appendChild(el);

    const open = () => (el.classList.contains("sel") ? openBook(book, el) : selectBook(book, el));
    el._open = open;
    spine.addEventListener("click", (e) => { e.stopPropagation(); open(); });
    cover.addEventListener("click", (e) => { e.stopPropagation(); open(); }); // the cover is what you see on hover
    spine.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });

    x += ws + gapOf(book);
  });
  tape.appendChild(frag);

  tapeWidth = x;
  bounds();
  // first book centred; in loop mode start inside the middle copy
  target = loop ? setW + firstW / 2 : posMin;
  pos = target;
  apply();
  startLoop();
}

function bounds() {
  posMin = shown.length ? dimsFor(shown[0]).ws / 2 : 0;
  posMax = Math.max(posMin, tapeWidth - (shown.length ? dimsFor(shown[shown.length - 1]).ws / 2 : 0));
}

// slide the tape so a book sits centred in the space the detail panel leaves free
function centerOn(el) {
  let cx = +el.dataset.cx;
  if (loop) cx += Math.round((pos - cx) / setW) * setW; // nearest copy
  const shift = isMobile() ? 0 : Math.min(200, viewport.clientWidth * 0.15);
  target = clampT(cx + shift);
  startLoop();
}

// pick a random book from what is shown
function randomBook() {
  if (!shown.length) return;
  const i = Math.floor(Math.random() * shown.length);
  const el = document.querySelectorAll(".book")[(loop ? shown.length : 0) + i];
  if (el) openBook(shown[i], el);
}

// scroll by roughly half a screen (arrow buttons)
function nudge(dir) {
  target = clampT(target + dir * Math.max(240, viewport.clientWidth * 0.45));
  startLoop();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function apply() {
  if (loop) {
    // keep pos inside the middle copy so the tape never runs out
    while (pos >= 2 * setW) { pos -= setW; target -= setW; }
    while (pos < setW) { pos += setW; target += setW; }
  }
  const skew = reducedMotion.matches ? 0 : Math.max(-4, Math.min(4, (pos - lastPos) * 0.18));
  lastPos = pos;
  tape.style.transform = `translateX(${-pos}px) skewX(${skew}deg)`;
}

function startLoop() {
  if (rafId) return;
  const step = () => {
    const diff = target - pos;
    pos = reducedMotion.matches ? target : pos + diff * 0.12;
    if (Math.abs(diff) < 0.05) pos = target;
    apply();
    rafId = Math.abs(target - pos) > 0.01 ? requestAnimationFrame(step) : null;
  };
  rafId = requestAnimationFrame(step);
}

// ---------- scroll / drag / touch ----------
viewport.addEventListener("wheel", (e) => {
  e.preventDefault();
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  target = clampT(target + d * 1.4);
  startLoop();
}, { passive: false });

let dragging = false, dragX = 0, dragStartX = 0, dragMoved = false;
let velocity = 0, lastDragTime = 0;

viewport.addEventListener("pointerdown", (e) => {
  dragging = true;
  dragX = e.clientX;
  dragStartX = e.clientX;
  dragMoved = false;
  velocity = 0;
  lastDragTime = Date.now();
  viewport.classList.add("dragging");
  viewport.setPointerCapture(e.pointerId);
});
viewport.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - dragX;
  if (Math.abs(e.clientX - dragStartX) > 5) dragMoved = true;
  const now = Date.now();
  const dt = now - lastDragTime;
  if (dt > 0) velocity = -dx / dt * 16; // pixels per frame
  lastDragTime = now;
  dragX = e.clientX;
  target = clampT(target - dx);
  startLoop();
});
const endDrag = () => {
  if (!dragging) return;
  dragging = false;
  viewport.classList.remove("dragging");
  // Momentum / flick (skipped under prefers-reduced-motion)
  if (!reducedMotion.matches && Math.abs(velocity) > 2) {
    const momentum = velocity * 12;
    target = clampT(target + momentum);
    startLoop();
  }
};
viewport.addEventListener("pointerup", endDrag);
viewport.addEventListener("pointercancel", endDrag);

// keyboard: arrows browse the shelf; while the reader is open they page books
addEventListener("keydown", (e) => {
  if (reader.classList.contains("shown")) {
    if (e.key === "Escape") closeReader();
    else if (e.key === "ArrowLeft") readerStep(-1);
    else if (e.key === "ArrowRight") readerStep(1);
    return;
  }
  if (e.key === "Escape") { if (detail.classList.contains("shown")) closeDetail(); else clearSelection(); return; }
  const t = e.target;
  if (t instanceof Element && (t.matches("input, select, textarea") || t.isContentEditable)) return;
  if (detail.classList.contains("shown")) return;
  if (e.key === "ArrowRight") { target = clampT(target + 120); startLoop(); }
  if (e.key === "ArrowLeft") { target = clampT(target - 120); startLoop(); }
});

// ---------- detail panel ----------
const detailOpen = document.getElementById("detail-open");
const detailStatus = document.getElementById("detail-status");
const detailCopy = document.getElementById("detail-copy");

// click a spine: that book's cover pulls out and the neighbours part (no panel yet)
function selectBook(book, el) {
  if (dragMoved) return;
  document.querySelectorAll(".book.sel").forEach((b) => b.classList.remove("sel"));
  el.classList.add("sel");
  currentBook = book;
  centerOn(el);
  hint.classList.add("gone");
}

function clearSelection() {
  document.querySelectorAll(".book.sel").forEach((b) => b.classList.remove("sel"));
  currentBook = null;
  hint.classList.remove("gone");
}

// click the pulled-out cover: full-page book view
function openBook(book, el) {
  if (dragMoved) return;
  if (!el.classList.contains("sel")) selectBook(book, el);
  detailOpener = el.querySelector(".spine") || el;

  document.getElementById("detail-title").textContent = book.title;
  document.getElementById("detail-author").textContent = book.author || "Unknown author";
  document.getElementById("detail-cover").style.backgroundImage = `url("${book._coverURL}")`;

  document.getElementById("detail-eyebrow").textContent =
    [topOf(book.series) || "General", (window.ABOUT || {})[book.path]?.kind].filter(Boolean).join(" · ");
  document.getElementById("detail-line").textContent = (window.ABOUT || {})[book.path]?.takeaway || "";

  // notes written per book (app/about.js, built from data/about-*.json)
  const note = (window.ABOUT || {})[book.path];
  const aboutEl = document.getElementById("detail-about");
  if (note) {
    const chips = [note.kind, note.level].filter(Boolean)
      .map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join("");
    const tags = (note.topics || []).map((t, n) => `<li><span>${String(n + 1).padStart(2, "0")}</span>${escapeHtml(t)}</li>`).join("");
    aboutEl.innerHTML =
      (chips ? `<div class="chips">${chips}</div>` : "") +
      (note.about ? `<p class="about">${escapeHtml(note.about)}</p>` : "") +
            (note.readIf ? `<h3>Read it if</h3><p>${escapeHtml(note.readIf)}</p>` : "") +
      (tags ? `<h3>Topics</h3><ol class="topics">${tags}</ol>` : "");
  } else aboutEl.innerHTML = "";

  const meta = [];
  const row = (k, v, cls) => `<div class="row${cls ? " " + cls : ""}"><span>${k}</span><b>${v}</b></div>`;
  meta.push(row("Collection", escapeHtml(book.series || "General")));
  if (book.year) meta.push(row("Year", book.year));
  if (book.pages) meta.push(row("Pages", book.pages));
  meta.push(row("Format", escapeHtml(book.path.split(".").pop().toUpperCase())));
  meta.push(row("File", escapeHtml(book.path.replace(/^D:\/Books\//i, "")), "file"));
  document.getElementById("detail-meta").innerHTML = meta.join("");

  const url = fileUrl(book);
  detailOpen.href = url;
  const ext = book.path.toLowerCase().split(".").pop();
  detailOpen.textContent = ext === "epub" ? "Open EPUB" : ext === "pdf" ? "Open PDF" : "Open file";
  detailStatus.textContent = isRead(book) ? "Mark as unread" : "Mark as read";
  detailStatus.classList.toggle("done", isRead(book));

  detail.classList.add("shown");
  detail.setAttribute("aria-hidden", "false");
  detail.inert = false;
  hint.classList.add("gone");
  document.getElementById("detail-close").focus();
}

function closeDetail() {
  const opener = detailOpener;
  detailOpener = null;
  detail.classList.remove("shown");
  detail.setAttribute("aria-hidden", "true");
  detail.inert = true;
  if (opener && opener.isConnected) opener.focus();
}
document.getElementById("detail-close").addEventListener("click", () => closeDetail());

// Close detail on backdrop tap (mobile)
viewport.addEventListener("click", (e) => {
  // the drag handler captures the pointer, so clicks land here: hand them to the book under the cursor
  const hit = !dragMoved && document.elementFromPoint(e.clientX, e.clientY)?.closest(".book");
  if (hit && hit._open) { hit._open(); return; }
  if (dragMoved) return;
  if (detail.classList.contains("shown")) closeDetail();
  else clearSelection();
});

detailStatus.addEventListener("click", () => {
  if (!currentBook) return;
  toggleRead(currentBook);
  detailStatus.textContent = isRead(currentBook) ? "Mark as unread" : "Mark as read";
  detailStatus.classList.toggle("done", isRead(currentBook));
  toast(isRead(currentBook) ? "Marked as read" : "Marked as unread");
});
detailCopy.addEventListener("click", async () => {
  if (!currentBook) return;
  try {
    await navigator.clipboard.writeText(currentBook.path);
    toast("Path copied");
  } catch {
    toast(currentBook.path);
  }
});

// ---------- reader overlay ----------
const reader = document.getElementById("reader");
const readerFrame = document.getElementById("reader-frame");
const readerTitle = document.getElementById("reader-title");
const readerPrev = document.getElementById("reader-prev");
const readerNext = document.getElementById("reader-next");
const readerExternal = document.getElementById("reader-external");
const readerClose = document.getElementById("reader-close");
let readerBook = null;
let readerOpener = null;

function readerSpine(book) {
  return document.querySelector(`.book[data-path="${CSS.escape(book.path)}"] .spine`);
}

function updateReaderNav() {
  const i = readerBook ? shown.indexOf(readerBook) : -1;
  readerPrev.disabled = i <= 0;
  readerNext.disabled = i < 0 || i >= shown.length - 1;
}

function openReader(book, opener) {
  readerBook = book;
  readerOpener = opener || null;
  const url = fileUrl(book);
  readerFrame.src = url;
  readerExternal.href = url;
  readerTitle.textContent = book.title;
  updateReaderNav();
  reader.classList.add("shown");
  reader.setAttribute("aria-hidden", "false");
  reader.inert = false;
  hint.classList.add("gone");
  readerClose.focus();
}

function closeReader() {
  const opener = readerOpener;
  readerBook = null;
  readerOpener = null;
  reader.classList.remove("shown");
  reader.setAttribute("aria-hidden", "true");
  reader.inert = true;
  readerFrame.removeAttribute("src");
  if (opener && opener.isConnected) opener.focus();
}

function readerStep(dir) {
  if (!readerBook) return;
  const i = shown.indexOf(readerBook);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= shown.length) return;
  openReader(shown[j], readerSpine(shown[j]) || readerOpener);
}

readerPrev.addEventListener("click", () => readerStep(-1));
readerNext.addEventListener("click", () => readerStep(1));
readerClose.addEventListener("click", () => closeReader());

detailOpen.addEventListener("click", (e) => {
  if (!currentBook) return;
  if (currentBook.path.toLowerCase().endsWith(".pdf")) {
    e.preventDefault();
    openReader(currentBook, readerSpine(currentBook) || detailOpen);
  }
  // .epub and other types keep the default new-tab behavior via href
});

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
}

document.getElementById("empty-clear").addEventListener("click", () => {
  query = ""; filter = "";
  searchEl.value = "";
  buildTabs(); render();
});

searchEl.addEventListener("input", () => {
  query = searchEl.value;
  clearTimeout(searchEl._t);
  searchEl._t = setTimeout(render, 120);
});
sortEl.addEventListener("change", () => { sort = sortEl.value; render(); });

// ---------- Drive sync ----------
syncBtn.addEventListener("click", async () => {
  if (syncBtn.classList.contains("syncing")) return;

  syncBtn.classList.add("syncing");
  syncBtn.querySelector("span").textContent = "Syncing…";
  toast("Syncing books to Google Drive…");

  try {
    const res = await fetch("/api/sync-drive", { method: "POST" });
    const data = await res.json();

    if (!data.ok) {
      toast(data.message || "Sync failed");
      syncBtn.classList.remove("syncing");
      syncBtn.querySelector("span").textContent = "Sync Drive";
      return;
    }

    // Poll for completion
    const poll = setInterval(async () => {
      try {
        const sr = await fetch("/api/sync-status");
        const st = await sr.json();
        if (st.status === "done") {
          clearInterval(poll);
          syncBtn.classList.remove("syncing");
          syncBtn.classList.add("done");
          syncBtn.querySelector("span").textContent = "Synced ✓";
          toast("All books synced to Google Drive");
          setTimeout(() => {
            syncBtn.classList.remove("done");
            syncBtn.querySelector("span").textContent = "Sync Drive";
          }, 5000);
        } else if (st.status === "error") {
          clearInterval(poll);
          syncBtn.classList.remove("syncing");
          syncBtn.querySelector("span").textContent = "Sync Drive";
          toast(st.message || "Sync failed");
        }
      } catch { /* ignore poll errors */ }
    }, 1500);
  } catch (err) {
    syncBtn.classList.remove("syncing");
    syncBtn.querySelector("span").textContent = "Sync Drive";
    toast("Sync failed: " + err.message);
  }
});

// Resize: debounce ~150ms; re-render when crossing the 640px breakpoint,
// otherwise just recompute bounds and clamp so the tape is never stranded.
let resizeTimer = null;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (isMobile() !== lastMobile) {
      lastMobile = isMobile();
      render();
      return;
    }
    bounds();
    target = clampT(target);
    pos = target;
    apply();
  }, 150);
});

document.getElementById("shelf-prev").addEventListener("click", () => nudge(-1));
document.getElementById("shelf-next").addEventListener("click", () => nudge(1));
document.getElementById("shelf-random").addEventListener("click", () => { dragMoved = false; randomBook(); });

// ---------- go ----------
buildTabs();
render();
