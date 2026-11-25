// Page-turn PDF reader (PDF.js). Pages fitted to the screen like an e-reader, two side by side on
// a wide screen (cover alone, then 2–3, 4–5… like a printed book): tap the left/right edge or
// swipe to turn, tap the middle to hide the bars, arrows on a keyboard.
// Select text to highlight it or attach a note; the panel lists contents and notes.
// The page you were on is remembered per book; notes are saved through window.noteStore.

(() => {
  const $ = (id) => document.getElementById(id);
  const reader = $("reader"), stage = $("reader-stage"), pageWrap = $("reader-page");
  // the two page sheets (the second only shows in a spread); each knows which page it holds
  // and its { scale, box }, for mapping selections back to page units
  const sheets = [...pageWrap.querySelectorAll(".rd-sheet")].map((sheet) => ({
    sheet, canvas: sheet.querySelector("canvas"), inner: sheet.querySelector(".rd-inner"),
    hl: sheet.querySelector(".rd-hl"), text: sheet.querySelector(".textLayer"),
    n: 0, view: null, task: null, textTask: null,
  }));
  const signinBtn = $("reader-signin");
  signinBtn.addEventListener("click", () => { if (book) open(book, opener); });
  const msg = $("reader-msg"), titleEl = $("reader-title"), range = $("reader-range"), count = $("reader-count");
  const fitBtn = $("reader-fit"), cropBtn = $("reader-crop"), prevBtn = $("reader-prev"), nextBtn = $("reader-next");
  const closeBtn = $("reader-close"), panelBtn = $("reader-panel-btn"), panel = $("reader-panel");
  const pop = $("hl-pop"), editor = $("hl-editor"), noteInput = $("hl-note");

  const lib = window.pdfjsLib;
  if (lib) lib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  // ---------- saved place + view settings (localStorage) ----------
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  // positions live in the note store so they sync between devices; carry over the old local ones
  try {
    const old = JSON.parse(load("bookshelf-pages-v1") || "{}");
    for (const [path, n] of Object.entries(old)) if (!window.noteStore.getPos(path)) window.noteStore.setPos(path, n, 0);
    localStorage.removeItem("bookshelf-pages-v1");
  } catch {}
  const savePlace = (b, n) => window.noteStore.setPos(b.path, n, doc ? doc.numPages : 0);
  const placeOf = (b) => window.noteStore.getPos(b.path)?.page || 0;
  // page to resume on, or 0 when the book is unopened or on page 1
  window.readerProgress = (b) => (placeOf(b) > 1 ? placeOf(b) : 0);

  let fitWidth = load("bookshelf-fit-v1") === "1";
  let crop = load("bookshelf-crop-v1") !== "0";
  const syncToggles = () => {
    fitBtn.setAttribute("aria-pressed", fitWidth);
    cropBtn.setAttribute("aria-pressed", crop);
    reader.classList.toggle("fit-width", fitWidth);
  };
  syncToggles();
  fitBtn.addEventListener("click", () => { fitWidth = !fitWidth; store("bookshelf-fit-v1", fitWidth ? "1" : "0"); syncToggles(); draw(); });
  cropBtn.addEventListener("click", () => { crop = !crop; store("bookshelf-crop-v1", crop ? "1" : "0"); syncToggles(); draw(); });

  // two pages side by side on a wide landscape screen (not in fit-width or text mode)
  const spreadBtn = $("reader-spread");
  let spreadPref = load("bookshelf-spread-v1") !== "0";
  spreadBtn.setAttribute("aria-pressed", spreadPref);
  spreadBtn.addEventListener("click", () => {
    spreadPref = !spreadPref;
    store("bookshelf-spread-v1", spreadPref ? "1" : "0");
    spreadBtn.setAttribute("aria-pressed", spreadPref);
    draw();
  });
  const isSpread = () => spreadPref && !fitWidth && !textMode &&
    stage.clientWidth >= 900 && stage.clientWidth > stage.clientHeight * 1.1;
  // first page of the spread holding page n: the cover stands alone, then even pages lead
  const lead = (n) => (isSpread() && n > 1 ? n - (n % 2) : n);
  const lastShown = () => (isSpread() && page > 1 && doc && page < doc.numPages ? page + 1 : page);

  let doc = null, book = null, page = 1, opener = null, loading = null;

  // ---------- margins ----------
  // the printed area of a page (in page units), found by rendering a thumbnail and
  // scanning for ink; lets small screens drop the white margins like an e-reader does
  const boxes = new Map();
  async function inkBox(p, n) {
    if (boxes.has(n)) return boxes.get(n);
    const base = p.getViewport({ scale: 1 });
    const s = 240 / base.width;
    const vp = p.getViewport({ scale: s });
    const c = document.createElement("canvas");
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const g = c.getContext("2d", { willReadFrequently: true });
    await p.render({ canvasContext: g, viewport: vp }).promise;
    const { data, width: W, height: H } = g.getImageData(0, 0, c.width, c.height);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (data[i] + data[i + 1] + data[i + 2] < 690) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    let box = { x: 0, y: 0, w: base.width, h: base.height };
    if (x1 > x0 && y1 > y0) {
      const m = 10; // keep a little breathing room around the text
      box = { x: Math.max(0, x0 - m) / s, y: Math.max(0, y0 - m) / s };
      box.w = Math.min(W, x1 + m) / s - box.x;
      box.h = Math.min(H, y1 + m) / s - box.y;
      // a near-empty page (chapter opener) shouldn't zoom in wildly
      const minW = base.width * 0.62;
      if (box.w < minW) { box.x = Math.max(0, box.x - (minW - box.w) / 2); box.w = Math.min(minW, base.width - box.x); }
    }
    boxes.set(n, box);
    return box;
  }

  // ---------- text mode: the page's words reflowed as paragraphs, like an e-reader ----------
  // Each PDF text item becomes a <span data-i>, so a selection here maps back to rectangles on
  // the PDF page and highlights are shared with the page view.
  const flow = $("reader-flow");
  let textMode = load("bookshelf-textmode-v1") === "1";
  let flowSize = +(load("bookshelf-flowsize-v1") || 19);
  let flowItems = null; // [{ x, y, w, h, str }] in page units for the page on screen
  const textBtn = $("reader-textmode");
  const sizeDown = $("reader-smaller"), sizeUp = $("reader-larger");
  const pageBtn = $("reader-pagemode"), aaBtn = $("reader-aa"), display = $("rd-display");
  const syncText = () => {
    textBtn.setAttribute("aria-pressed", textMode);
    pageBtn.setAttribute("aria-pressed", !textMode);
    reader.classList.toggle("text-mode", textMode);
    flow.style.setProperty("--flow-size", flowSize + "px");
  };
  syncText();
  const setMode = (on) => { if (on === textMode) return; textMode = on; store("bookshelf-textmode-v1", on ? "1" : "0"); syncText(); draw(); };
  textBtn.addEventListener("click", () => setMode(true));
  pageBtn.addEventListener("click", () => setMode(false));
  const toggleDisplay = (on = display.hidden) => {
    display.hidden = !on;
    aaBtn.setAttribute("aria-expanded", on);
    if (on) reader.classList.remove("chrome-off");
  };
  aaBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleDisplay(); });
  document.addEventListener("pointerdown", (e) => {
    if (!display.hidden && !display.contains(e.target) && e.target !== aaBtn) toggleDisplay(false);
  });
  const resize = (d) => {
    flowSize = Math.max(14, Math.min(28, flowSize + d));
    store("bookshelf-flowsize-v1", flowSize);
    syncText();
  };
  sizeDown.addEventListener("click", () => resize(-1));
  sizeUp.addEventListener("click", () => resize(1));

  function buildFlow(content, vp) {
    // items -> lines (by baseline) -> paragraphs (by gaps, indents, short lines, size changes)
    const items = [];
    for (const it of content.items) {
      if (!it.str) { if (it.hasEOL && items.length) items[items.length - 1].eol = true; continue; }
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      const h = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      items.push({ x, y: y - h, base: y, w: it.width, h, str: it.str, eol: it.hasEOL });
    }
    const lines = [];
    let cur = null;
    items.forEach((it, i) => {
      if (!cur || Math.abs(it.base - cur.base) > cur.h * 0.5) {
        cur = { base: it.base, h: it.h, x0: it.x, x1: it.x + it.w, items: [] };
        lines.push(cur);
      }
      cur.items.push(i);
      cur.x1 = Math.max(cur.x1, it.x + it.w);
      cur.h = Math.max(cur.h, it.h);
      if (it.eol) cur = null;
    });
    const text = (l) => l.items.map((i) => items[i].str).join("").trim();
    // running page numbers and headers at the very top/bottom
    const H = vp.height;
    const body = lines.filter((l) => !((l.base < H * 0.07 || l.base > H * 0.95) && (text(l).length < 60 || /^\d+$/.test(text(l)))));
    if (!body.length) return { html: "", items };
    const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
    const size = med(body.map((l) => l.h));
    const gaps = body.slice(1).map((l, i) => l.base - body[i].base).filter((g) => g > 0);
    const gap = gaps.length ? med(gaps) : size * 1.3;
    const left = med(body.map((l) => l.x0));
    const right = Math.max(...body.map((l) => l.x1));

    let html = "", para = [], kind = "p";
    const flush = () => {
      if (para.length) html += `<${kind}>${para.join("")}</${kind}>`;
      para = [];
    };
    body.forEach((l, k) => {
      const prev = body[k - 1];
      const head = l.h > size * 1.2;
      const lk = head ? "h3" : "p";
      const brk = !prev || lk !== kind || l.base - prev.base > gap * 1.45 || l.base < prev.base ||
        l.x0 > left + size * 0.8 || prev.x1 < right - size * 3 || Math.abs(l.h - prev.h) > size * 0.18;
      if (brk) { flush(); kind = lk; }
      else {
        // join lines: drop a line-end hyphen before a lowercase word, otherwise add a space
        const last = para[para.length - 1];
        const nextStr = items[l.items[0]].str;
        if (/-<\/span>$/.test(last) && /^[a-z]/.test(nextStr)) para[para.length - 1] = last.replace(/-<\/span>$/, "</span>");
        else para.push(" ");
      }
      l.items.forEach((i, j) => {
        const it = items[i], before = j ? items[l.items[j - 1]] : null;
        if (before && it.x - (before.x + before.w) > it.h * 0.15 && !/\s$/.test(before.str) && !/^\s/.test(it.str)) para.push(" ");
        para.push(`<span data-i="${i}">${escapeHtml(it.str)}</span>`);
      });
    });
    flush();
    return { html, items };
  }
  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  async function drawFlow(p, n, dir) {
    const content = await p.getTextContent();
    if (n !== page) return true;
    const { html, items } = buildFlow(content, p.getViewport({ scale: 1 }));
    if (!html) { flowItems = null; return false; } // scanned or image-only page: show the page itself
    flowItems = items;
    flow.innerHTML = html;
    reader.classList.add("flow-on");
    stage.scrollTop = 0;
    if (dir && !reducedMotion.matches) {
      flow.style.animation = "none";
      void flow.offsetWidth;
      flow.style.animation = `${dir > 0 ? "turn-next" : "turn-prev"} .28s cubic-bezier(.2,.8,.2,1)`;
    }
    msg.textContent = "";
    markFlow();
    return true;
  }

  // wrap the parts of each text item that fall inside a highlight's rectangles
  function markFlow() {
    if (!flowItems) return;
    for (const m of flow.querySelectorAll("mark")) m.replaceWith(...m.childNodes);
    if (!flow.isConnected) return;
    flow.normalize();
    for (const h of notesOf().filter((h) => h.page === page)) {
      for (const span of flow.querySelectorAll("span[data-i]")) {
        const it = flowItems[+span.dataset.i];
        const node = span.firstChild;
        if (!node || node.nodeType !== 3) continue;
        for (const [x, y, w, hh] of h.rects) {
          const cy = it.y + it.h / 2;
          if (cy < y || cy > y + hh || it.x + it.w <= x || it.x >= x + w) continue;
          const len = node.length;
          const a = Math.max(0, Math.round(((x - it.x) / it.w) * len));
          const b = Math.min(len, Math.round(((x + w - it.x) / it.w) * len));
          if (b <= a) continue;
          const r = document.createRange();
          r.setStart(node, a); r.setEnd(node, b);
          const mk = document.createElement("mark");
          mk.dataset.id = h.id;
          mk.dataset.c = h.c || "y";
          if (h.note) mk.className = "has-note";
          r.surroundContents(mk);
          break;
        }
      }
    }
    // fill the spaces between two marked pieces of the same highlight
    for (const sp of [...flow.querySelectorAll("p, h3")].flatMap((el) => [...el.childNodes])) {
      if (sp.nodeType !== 3 || sp.textContent.trim()) continue;
      const a = sp.previousSibling?.querySelector?.("mark:last-child");
      const b = sp.nextSibling?.querySelector?.("mark:first-child");
      if (!a || !b || a.dataset.id !== b.dataset.id) continue;
      if (a.nextSibling?.textContent || b.previousSibling?.textContent) continue; // only when the marks touch the gap
      const mk = document.createElement("mark");
      mk.dataset.id = a.dataset.id;
      mk.dataset.c = a.dataset.c;
      mk.className = a.className;
      sp.replaceWith(mk);
      mk.appendChild(sp);
    }
  }

  // a selection in text mode, as page-unit rectangles (one per line)
  function flowSelectionRects(r) {
    const spans = [...flow.querySelectorAll("span[data-i]")].filter((s) => r.intersectsNode(s));
    const lines = [];
    for (const s of spans) {
      const it = flowItems[+s.dataset.i];
      const len = s.textContent.length || 1;
      // character offsets of the selection inside this span
      const off = (container, offset) => {
        const pre = document.createRange();
        pre.selectNodeContents(s);
        pre.setEnd(container, offset);
        return pre.toString().length;
      };
      const a = s.contains(r.startContainer) ? off(r.startContainer, r.startOffset) : 0;
      const b = s.contains(r.endContainer) ? off(r.endContainer, r.endOffset) : len;
      if (b <= a) continue;
      const x = it.x + (it.w * a) / len, w = (it.w * (b - a)) / len;
      const same = lines.find((l) => Math.abs(l[1] - it.y) < it.h * 0.5);
      if (same) { const x1 = Math.max(same[0] + same[2], x + w); same[0] = Math.min(same[0], x); same[2] = x1 - same[0]; }
      else lines.push([x, it.y, w, it.h]);
    }
    return lines;
  }

  // ---------- drawing ----------
  // render one page into an offscreen canvas (so the swap never flashes white); null if cancelled
  async function renderOff(s, p, box, scale) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const k = scale * dpr;
    const vp = p.getViewport({ scale: k, offsetX: -box.x * k, offsetY: -box.y * k });
    if (s.task) s.task.cancel();
    const off = document.createElement("canvas");
    off.width = Math.floor(box.w * k);
    off.height = Math.floor(box.h * k);
    s.task = p.render({ canvasContext: off.getContext("2d", { alpha: false }), viewport: vp });
    try { await s.task.promise; } catch { return null; } // cancelled
    s.task = null;
    return off;
  }

  // put a rendered page on a sheet; the full page sits behind the crop window and its text and
  // highlights are laid out on it
  function place(s, off, p, n, box, scale) {
    s.canvas.width = off.width;
    s.canvas.height = off.height;
    s.sheet.style.width = Math.floor(box.w * scale) + "px";
    s.sheet.style.height = Math.floor(box.h * scale) + "px";
    s.canvas.getContext("2d").drawImage(off, 0, 0);
    const full = p.getViewport({ scale: 1 });
    s.n = n;
    s.view = { scale, box };
    s.inner.style.width = full.width * scale + "px";
    s.inner.style.height = full.height * scale + "px";
    s.inner.style.transform = `translate(${-box.x * scale}px, ${-box.y * scale}px)`;
    drawText(s, p, scale, n);
  }

  async function draw(dir = 0) {
    if (!doc) return;
    page = lead(page); // the window may have become (or stopped being) wide enough for a spread
    label();
    const n = page;
    const p = await doc.getPage(n);
    if (n !== page) return; // turned again while loading
    reader.classList.remove("flow-on");
    if (textMode && await drawFlow(p, n, dir)) return;
    if (n !== page) return;
    flowItems = null;
    const two = isSpread() && n > 1 && n < doc.numPages;
    const pages = two ? [p, await doc.getPage(n + 1)] : [p];
    if (n !== page) return;
    const boxOf = async (pg, num) => {
      const f = pg.getViewport({ scale: 1 });
      return crop ? inkBox(pg, num) : { x: 0, y: 0, w: f.width, h: f.height };
    };
    let box = await boxOf(p, n);
    if (two) {
      // one crop window for both pages so they stand level, like an open book
      const b2 = await boxOf(pages[1], n + 1);
      const x0 = Math.min(box.x, b2.x), y0 = Math.min(box.y, b2.y);
      box = { x: x0, y: y0, w: Math.max(box.x + box.w, b2.x + b2.w) - x0, h: Math.max(box.y + box.h, b2.y + b2.h) - y0 };
    }
    if (n !== page) return;
    const pad = 28;
    const w = stage.clientWidth - pad, h = stage.clientHeight - pad;
    // fit width caps the column so long lines stay readable on a wide screen
    const scale = fitWidth ? Math.min(w, 1000) / box.w : Math.min(w / (box.w * pages.length), h / box.h);
    const offs = await Promise.all(pages.map((pg, i) => renderOff(sheets[i], pg, box, scale)));
    if (n !== page || offs.some((o) => !o)) return;

    reader.classList.toggle("spread", two);
    sheets.forEach((s, i) => {
      s.sheet.hidden = i >= pages.length;
      if (s.sheet.hidden) { s.view = null; s.n = 0; s.hl.innerHTML = s.text.innerHTML = ""; }
    });
    pages.forEach((pg, i) => place(sheets[i], offs[i], pg, n + i, box, scale));
    if (dir && !reducedMotion.matches) {
      pageWrap.style.animation = "none";
      void pageWrap.offsetWidth;
      pageWrap.style.animation = `${dir > 0 ? "turn-next" : "turn-prev"} .28s cubic-bezier(.2,.8,.2,1)`;
    }
    if (fitWidth) stage.scrollTop = 0;
    msg.textContent = "";
    drawHighlights();

    // warm the next pages so the turn feels instant
    const last = n + pages.length - 1;
    for (let k = last + 1; k <= Math.min(doc.numPages, last + pages.length); k++) doc.getPage(k).catch(() => {});
  }

  async function drawText(s, p, scale, n) {
    if (s.textTask) s.textTask.cancel();
    s.text.innerHTML = "";
    s.text.style.setProperty("--scale-factor", scale);
    try {
      const content = await p.getTextContent();
      if (s.n !== n) return;
      s.textTask = lib.renderTextLayer({
        textContentSource: content, container: s.text,
        viewport: p.getViewport({ scale }), textDivs: [],
      });
      await s.textTask.promise;
      // a block behind the text: while dragging over gaps between lines it catches the pointer,
      // so the selection grows smoothly instead of jumping or dropping lines
      const end = document.createElement("div");
      end.className = "endOfContent";
      s.text.appendChild(end);
    } catch { /* cancelled or no text (scanned book) */ }
  }

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  // "12 / 300", or "12–13 / 300" for a spread
  function label() {
    if (!doc) return;
    const last = lastShown();
    range.value = page;
    count.textContent = `${last > page ? `${page}–${last}` : page} / ${doc.numPages}`;
    prevBtn.disabled = page <= 1;
    nextBtn.disabled = last >= doc.numPages;
  }

  function go(n, dir = 0) {
    if (!doc) return;
    n = lead(Math.max(1, Math.min(doc.numPages, n)));
    if (n === page && sheets[0].canvas.width) return;
    hidePop();
    page = n;
    label();
    savePlace(book, n);
    draw(dir);
  }

  // ---------- open / close ----------
  async function open(b, from) {
    // start the source lookup first: on the hosted site it may need a Google sign-in popup,
    // which browsers only allow straight from the click
    const source = window.bookSource(b);
    source.catch(() => {});
    if (!lib) { source.then((s) => window.open(s.url, "_blank", "noopener")); return; }
    close(false);
    boxes.clear();
    if (book !== b) { undos = []; redos = []; }
    book = b;
    opener = from || null;
    titleEl.textContent = b.title.replace(/^\[[^\]]+\]\s*/, "");
    count.textContent = "";
    for (const s of sheets) {
      s.canvas.width = 0;
      s.sheet.style.width = s.sheet.style.height = "0";
      s.hl.innerHTML = s.text.innerHTML = "";
      s.view = null; s.n = 0;
    }
    msg.textContent = "Opening…";
    signinBtn.hidden = true;
    reader.classList.remove("chrome-off");
    panel.hidden = true;
    panelBtn.setAttribute("aria-expanded", "false");
    reader.classList.add("shown");
    reader.setAttribute("aria-hidden", "false");
    reader.inert = false;
    closeBtn.focus();
    window.noteStore.ready().then(() => { if (book === b) drawHighlights(); });

    let src;
    try { src = await source; } catch (err) {
      if (book === b) {
        msg.textContent = err.message || "Couldn’t open this book.";
        // the popup must open straight from a click, so offer one
        signinBtn.hidden = !window.bookNeedsSignIn();
        if (!signinBtn.hidden) signinBtn.focus();
      }
      return;
    }
    if (book !== b || !reader.classList.contains("shown")) return;
    // range requests: only the pages being read are downloaded, so big books open fast on a phone
    // after the first page, keep fetching the rest in the background (pieces are cached, so page
    // turns and the next open are instant); very large books only load what's read, to spare data
    const opts = { disableAutoFetch: !src.length || src.length > 40 * 1048576, disableStream: true, rangeChunkSize: 262144 };
    if (src.length) {
      // fetch the byte ranges ourselves (the host hides range support from PDF.js)
      const t = new lib.PDFDataRangeTransport(src.length, null);
      t.requestDataRange = (a, z) => src.fetchRange(a, z)
        .then((buf) => t.onDataRange(a, new Uint8Array(buf)))
        .catch(() => { if (book === b) { msg.textContent = "Couldn’t load this book — check your connection."; window.bookSourceFailed?.(); } });
      loading = lib.getDocument({ ...opts, range: t });
    } else loading = lib.getDocument({ ...src, ...opts });
    const mine = loading;
    try {
      const d = await mine.promise;
      if (mine !== loading) { d.destroy(); return; }
      doc = d;
    } catch (err) {
      if (mine === loading) { msg.textContent = "Couldn’t open this book."; window.bookSourceFailed?.(); }
      return;
    }
    range.max = doc.numPages;
    page = 0;
    const d0 = doc;
    // wait for the synced position (another device may be further along)
    await Promise.race([window.noteStore.ready(), new Promise((r) => setTimeout(r, 2500))]);
    if (book !== b || doc !== d0) return;
    go(placeOf(b) || 1);
  }

  function close(restoreFocus = true) {
    for (const s of sheets) {
      if (s.task) { s.task.cancel(); s.task = null; }
      if (s.textTask) { s.textTask.cancel(); s.textTask = null; }
    }
    if (loading) { loading.destroy(); loading = null; }
    doc = null;
    hidePop();
    closeEditor();
    if (!reader.classList.contains("shown")) return;
    reader.classList.remove("shown");
    reader.setAttribute("aria-hidden", "true");
    reader.inert = true;
    window.shelfRefreshProgress?.();
    if (restoreFocus && opener && opener.isConnected) opener.focus();
    opener = null;
  }

  // a whole spread at a time when two pages are showing
  const step = (dir) => {
    if (!doc) return false;
    const n = dir > 0 ? lastShown() + 1 : page - 1;
    if (n < 1 || n > doc.numPages) return false;
    go(n, dir);
    return true;
  };
  const turn = (dir) => { if (step(dir)) reader.classList.add("chrome-off"); };

  // ---------- highlights ----------
  const notesOf = () => (book ? window.noteStore.list(book.path) : []);

  function drawHighlights() {
    markFlow();
    for (const sh of sheets) {
      sh.hl.innerHTML = "";
      if (!sh.view || sh.sheet.hidden) continue;
      const s = sh.view.scale;
      for (const h of notesOf().filter((h) => h.page === sh.n)) {
        for (const [x, y, w, hh] of h.rects) {
          const d = document.createElement("div");
          d.className = "hl" + (h.note ? " has-note" : "");
          d.dataset.id = h.id;
          d.dataset.c = h.c || "y";
          d.style.cssText = `left:${x * s}px;top:${y * s}px;width:${w * s}px;height:${hh * s}px`;
          sh.hl.appendChild(d);
        }
      }
    }
  }

  // the current text selection inside the page, as rectangles in page units (one per line)
  function selectionRects() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (flowItems && flow.contains(r.commonAncestorContainer)) {
      const rects = flowSelectionRects(r).map((l) => l.map((v) => Math.round(v * 10) / 10));
      return rects.length && text ? [{ rects, text, page }] : null;
    }
    // each page the selection touches (both sides of a spread) gets its own piece
    const pieces = [];
    for (const sh of sheets) {
      if (!sh.view || sh.sheet.hidden || !r.intersectsNode(sh.text)) continue;
      const pr = r.cloneRange();
      if (!sh.text.contains(r.startContainer)) pr.setStart(sh.text, 0);
      if (!sh.text.contains(r.endContainer)) pr.setEnd(sh.text, sh.text.childNodes.length);
      const o = sh.inner.getBoundingClientRect(), s = sh.view.scale;
      const box = sh.sheet.getBoundingClientRect();
      const lines = [];
      for (const c of pr.getClientRects()) {
        if (c.width < 1 || c.height < 1 || c.right <= box.left || c.left >= box.right || c.bottom <= box.top || c.top >= box.bottom) continue;
        const x = (c.left - o.left) / s, y = (c.top - o.top) / s, w = c.width / s, h = c.height / s;
        const same = lines.find((l) => Math.abs(l[1] - y) < h * 0.5 && Math.abs(l[3] - h) < h * 0.6);
        if (same) {
          const x1 = Math.max(same[0] + same[2], x + w);
          same[0] = Math.min(same[0], x); same[2] = x1 - same[0];
        } else lines.push([x, y, w, h]);
      }
      const t = pr.toString().replace(/\s+/g, " ").trim();
      if (lines.length && t) pieces.push({ rects: lines.map((l) => l.map((v) => Math.round(v * 10) / 10)), text: t, page: sh.n });
    }
    return pieces.length ? pieces : null;
  }

  let pending = null;
  function showPop() {
    const s = selectionRects();
    if (!s) { hidePop(); return; }
    pending = s;
    const rr = getSelection().getRangeAt(0).getBoundingClientRect();
    const rs = reader.getBoundingClientRect();
    pop.hidden = false;
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    // under the selection on touch screens (the system menu sits above), above it with a mouse
    const below = matchMedia("(pointer: coarse)").matches || rr.top - ph - 10 < 60;
    let top = below ? rr.bottom + 12 : rr.top - ph - 10;
    top = Math.min(top, rs.height - ph - 70);
    pop.style.left = Math.max(8, Math.min(rs.width - pw - 8, rr.left + rr.width / 2 - pw / 2)) + "px";
    pop.style.top = Math.max(8, top) + "px";
  }
  function hidePop() { pop.hidden = true; pending = null; }

  // ---------- undo / redo (Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z) ----------
  // each step is a highlight before and after (null = didn't exist), for the open book only
  let undos = [], redos = [];
  const set = (before, after) => {
    if (after) window.noteStore.put(book.path, after);
    else window.noteStore.remove(book.path, before.id);
  };
  // pairs: [[before, after], …], undone and redone as one step
  function changeAll(pairs) {
    for (const [a, z] of pairs) set(a, z);
    undos.push(pairs);
    if (undos.length > 200) undos.shift();
    redos = [];
  }
  const change = (before, after) => changeAll([[before, after]]);
  function replay(fromStack, toStack, back) {
    const pairs = fromStack.pop();
    if (!pairs || !book) return;
    for (const [a, z] of back ? [...pairs].reverse() : pairs) back ? set(z, a) : set(a, z);
    toStack.push(pairs);
    const pg = (pairs[0][0] || pairs[0][1]).page;
    if (pg && (pg < page || pg > lastShown())) go(pg);
    window.shelfToast?.(back ? "Undone" : "Redone");
  }
  const undo = () => replay(undos, redos, true);
  const redo = () => replay(redos, undos, false);

  // highlight colour: the last one picked is the default
  const COLOR_KEY = "bookshelf-hl-color";
  let color = "y";
  try { color = localStorage.getItem(COLOR_KEY) || "y"; } catch {}
  const markColor = () => { for (const b of document.querySelectorAll("#hl-pop .sw")) b.setAttribute("aria-pressed", b.dataset.c === color); };
  markColor();
  for (const b of document.querySelectorAll("#hl-pop .sw")) b.addEventListener("click", () => {
    color = b.dataset.c;
    try { localStorage.setItem(COLOR_KEY, color); } catch {}
    markColor();
    addHighlight(false);
  });

  function addHighlight(withNote) {
    if (!pending || !book) return;
    const made = pending.map((p) => ({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), page, ...p, c: color, note: "", at: Date.now() }));
    changeAll(made.map((h) => [null, h]));
    const h = made[0];
    getSelection().removeAllRanges();
    hidePop();
    drawHighlights();
    renderNotes();
    if (withNote) openEditor(h.id);
  }
  $("hl-add").addEventListener("click", () => addHighlight(false));
  $("hl-add-note").addEventListener("click", () => addHighlight(true));
  pop.addEventListener("pointerdown", (e) => e.preventDefault()); // keep the selection alive

  let editing = null;
  function openEditor(id) {
    const h = notesOf().find((x) => x.id === id);
    if (!h) return;
    editing = h;
    $("hl-quote").textContent = h.text;
    $("hl-quote").dataset.c = h.c || "y";
    for (const b of document.querySelectorAll("#hl-recolor .sw")) b.setAttribute("aria-pressed", b.dataset.c === (h.c || "y"));
    noteInput.value = h.note || "";
    editor.hidden = false;
    reader.classList.remove("chrome-off");
    noteInput.focus();
  }
  function closeEditor(save = true) {
    if (!editing) { editor.hidden = true; return; }
    if (save && noteInput.value.trim() !== (editing.note || "")) {
      change(editing, { ...editing, note: noteInput.value.trim(), at: Date.now() });
    }
    editing = null;
    editor.hidden = true;
    drawHighlights();
    renderNotes();
  }
  $("hl-done").addEventListener("click", () => closeEditor());
  $("hl-delete").addEventListener("click", () => {
    if (!editing) return;
    change(editing, null);
    editing = null;
    closeEditor(false);
    removedToast();
  });
  const removedToast = () => window.shelfToast?.(matchMedia("(pointer: coarse)").matches ? "Highlight removed" : "Highlight removed · Ctrl+Z to undo");
  // recolour a highlight from its note card
  for (const b of document.querySelectorAll("#hl-recolor .sw")) b.addEventListener("click", () => {
    if (!editing || (editing.c || "y") === b.dataset.c) return;
    const next = { ...editing, c: b.dataset.c, at: Date.now() };
    change(editing, next);
    editing = next;
    $("hl-quote").dataset.c = next.c;
    for (const x of document.querySelectorAll("#hl-recolor .sw")) x.setAttribute("aria-pressed", x === b);
  });
  noteInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); closeEditor(); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeEditor(); }
  });

  // which highlight (if any) is under a point
  function highlightAt(x, y) {
    if (flowItems) return document.elementFromPoint(x, y)?.closest("mark")?.dataset.id || null;
    for (const sh of sheets) for (const d of sh.hl.children) {
      const r = d.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return d.dataset.id;
    }
    return null;
  }

  // ---------- panel: contents + notes ----------
  let outline = null;
  async function renderContents() {
    const list = $("rp-contents");
    list.innerHTML = "";
    if (!doc) return;
    if (!outline) {
      const items = (await doc.getOutline().catch(() => null)) || [];
      const flat = [];
      const walk = async (arr, depth) => {
        for (const it of arr) {
          let n = null;
          try {
            const dest = typeof it.dest === "string" ? await doc.getDestination(it.dest) : it.dest;
            if (dest) n = (typeof dest[0] === "object" ? await doc.getPageIndex(dest[0]) : dest[0]) + 1;
          } catch {}
          flat.push({ title: it.title, depth, n });
          if (depth < 1 && it.items?.length) await walk(it.items, depth + 1);
        }
      };
      await walk(items, 0);
      outline = flat;
    }
    if (!outline.length) { list.innerHTML = `<p class="rp-empty">This book has no table of contents.</p>`; return; }
    for (const it of outline) {
      const b = document.createElement("button");
      b.className = "rp-item" + (it.depth ? " sub" : "");
      b.innerHTML = `<span></span><i>${it.n || ""}</i>`;
      b.firstChild.textContent = it.title;
      b.disabled = !it.n;
      b.onclick = () => { go(it.n); togglePanel(false); };
      list.appendChild(b);
    }
  }

  function renderNotes() {
    const list = $("rp-notes");
    if (!list || !book) return;
    const items = notesOf().slice().sort((a, b) => a.page - b.page || a.rects[0][1] - b.rects[0][1]);
    $("rp-count").textContent = items.length ? items.length : "";
    $("rp-export").hidden = !items.length;
    list.innerHTML = items.length ? "" :
      `<p class="rp-empty">Select text on a page to highlight it or add a note.</p>`;
    for (const h of items) {
      const row = document.createElement("div");
      row.className = "rp-note-row";
      const b = document.createElement("button");
      b.className = "rp-note";
      b.dataset.c = h.c || "y";
      b.innerHTML = `<i>p. ${h.page}</i><q></q>` + (h.note ? `<span></span>` : "");
      b.querySelector("q").textContent = h.text;
      if (h.note) b.querySelector("span").textContent = h.note;
      b.onclick = () => { go(h.page); togglePanel(false); };
      const del = document.createElement("button");
      del.className = "rp-del";
      del.textContent = "×";
      del.setAttribute("aria-label", `Remove highlight on page ${h.page}`);
      del.onclick = () => { change(h, null); removedToast(); };
      row.append(b, del);
      list.appendChild(row);
    }
  }

  function togglePanel(on = panel.hidden) {
    panel.hidden = !on;
    panelBtn.setAttribute("aria-expanded", on);
    if (on) { reader.classList.remove("chrome-off"); renderNotes(); if (!panel.dataset.tab || panel.dataset.tab === "contents") renderContents(); }
  }
  panelBtn.addEventListener("click", () => togglePanel());
  $("rp-close").addEventListener("click", () => togglePanel(false));
  for (const t of panel.querySelectorAll("[data-tab]")) {
    t.addEventListener("click", () => {
      panel.dataset.tab = t.dataset.tab;
      for (const x of panel.querySelectorAll("[data-tab]")) x.setAttribute("aria-selected", x === t);
      if (t.dataset.tab === "contents") renderContents(); else renderNotes();
    });
  }
  $("rp-export").addEventListener("click", async () => {
    const title = titleEl.textContent;
    const md = `# ${title}\n\n` + notesOf().slice().sort((a, b) => a.page - b.page)
      .map((h) => `> ${h.text}\n\n— p. ${h.page}` + (h.note ? `\n\n${h.note}` : "")).join("\n\n---\n\n") + "\n";
    try { await navigator.clipboard.writeText(md); window.shelfToast?.("Notes copied as Markdown"); }
    catch { window.shelfToast?.("Couldn’t copy"); }
  });
  window.noteStore.onChange(() => { if (book) { drawHighlights(); renderNotes(); } });

  // ---------- input ----------
  prevBtn.addEventListener("click", () => step(-1));
  nextBtn.addEventListener("click", () => step(1));
  closeBtn.addEventListener("click", () => close());
  range.addEventListener("input", () => { count.textContent = `${range.value} / ${doc ? doc.numPages : ""}`; });
  range.addEventListener("change", () => go(+range.value));

  // tap zones + swipe on the page area; text selection takes priority over both
  let sx = 0, sy = 0, st = 0, multi = false;
  stage.addEventListener("pointerdown", (e) => {
    sx = e.clientX; sy = e.clientY; st = performance.now();
    multi = !e.isPrimary;
    for (const x of stage.querySelectorAll(".textLayer .endOfContent")) x.classList.add("active");
  });
  addEventListener("pointerup", () => { for (const x of stage.querySelectorAll(".endOfContent.active")) x.classList.remove("active"); });
  stage.addEventListener("pointerup", (e) => {
    if (!e.isPrimary || multi) return;
    if (!editor.hidden) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed) { setTimeout(showPop, 0); return; }
    // pinch-zoomed in: let the finger pan instead of turning pages
    if (window.visualViewport && window.visualViewport.scale > 1.05) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { turn(dx < 0 ? 1 : -1); return; }
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8 || performance.now() - st > 500) return;
    const hit = highlightAt(e.clientX, e.clientY);
    if (hit) { openEditor(hit); return; }
    if (!pop.hidden) { hidePop(); return; }
    const x = e.clientX / stage.clientWidth;
    if (x < 0.3) turn(-1);
    else if (x > 0.7) turn(1);
    else reader.classList.toggle("chrome-off");
  });
  // long-press selections on phones finish without a pointerup on the stage
  document.addEventListener("selectionchange", () => {
    if (!reader.classList.contains("shown")) return;
    clearTimeout(stage._sel);
    stage._sel = setTimeout(() => { if (matchMedia("(pointer: coarse)").matches) showPop(); else if (!selectionRects()) hidePop(); }, 350);
  });

  addEventListener("keydown", (e) => {
    if (!reader.classList.contains("shown")) return;
    if (e.target === range || e.target === noteInput) return;
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[zy]$/i.test(k)) {
      e.preventDefault();
      if (/y/i.test(k) || e.shiftKey) redo(); else undo();
      return;
    }
    if (k === "Escape") {
      e.preventDefault();
      if (!pop.hidden) { hidePop(); getSelection().removeAllRanges(); }
      else if (!panel.hidden) togglePanel(false);
      else close();
    }
    else if (k === "ArrowRight" || k === "PageDown" || (k === " " && !e.shiftKey && !fitWidth && !flowItems)) { e.preventDefault(); turn(1); }
    else if (k === "ArrowLeft" || k === "PageUp" || (k === " " && e.shiftKey && !fitWidth && !flowItems)) { e.preventDefault(); turn(-1); }
    else if (k === "Home") go(1);
    else if (k === "End" && doc) go(doc.numPages);
  });

  // fit page: the wheel turns pages; fit width: scrolling past the bottom moves on
  stage.addEventListener("wheel", (e) => {
    if (!fitWidth && !flowItems) {
      if (Math.abs(e.deltaY) < 4) return;
      e.preventDefault();
      if (performance.now() - (stage._last || 0) < 250) return;
      stage._last = performance.now();
      turn(e.deltaY > 0 ? 1 : -1);
      return;
    }
    const atEnd = stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 2;
    if (e.deltaY > 0 && atEnd && performance.now() - (stage._last || 0) > 400) { stage._last = performance.now(); turn(1); }
  }, { passive: false });

  let rz;
  addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => doc && draw(), 150); });

  const _open = open;
  window.openReader = (b, from) => { outline = null; return _open(b, from); };
})();
