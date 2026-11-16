// The Restore Report reader: renders a PDF with PDF.js and shows it as a
// page-turning book with StPageFlip, plus a magazine-style toolbar
// (pages strip, contents, search, zoom, share, download, full screen).
// No servers, trackers or external CDNs.
import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
const PDFJS_ASSETS = {
  cMapUrl: new URL("./vendor/pdfjs/cmaps/", import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL("./vendor/pdfjs/standard_fonts/", import.meta.url).href,
  wasmUrl: new URL("./vendor/pdfjs/wasm/", import.meta.url).href,
  iccUrl: new URL("./vendor/pdfjs/iccs/", import.meta.url).href,
};

const $ = (id) => document.getElementById(id);
const els = {
  title: $("issue-title"), download: $("download"), archive: $("archive"),
  stage: $("stage"), status: $("status"), statusText: $("status-text"), holder: $("book-holder"), book: $("book"),
  controls: $("controls"), prev: $("prev"), next: $("next"), info: $("page-info"), fs: $("fullscreen"),
  btnThumbs: $("btn-thumbs"), btnToc: $("btn-toc"), btnSearch: $("btn-search"), btnShare: $("btn-share"),
  zoomIn: $("zoom-in"), zoomOut: $("zoom-out"), zoomView: $("zoom-view"), zoomPages: $("zoom-pages"), zoomClose: $("zoom-close"),
  thumbs: $("thumbs"), toc: $("toc"),
  searchForm: $("search-form"), searchInput: $("search-input"), searchMsg: $("search-msg"), searchResults: $("search-results"),
  toast: $("toast"),
};
const panels = { thumbs: $("panel-thumbs"), toc: $("panel-toc"), search: $("panel-search") };
const panelButtons = { thumbs: els.btnThumbs, toc: els.btnToc, search: els.btnSearch };

const MOBILE_BREAKPOINT = 800;   // below this width: one page at a time, phone layout
const RENDER_WIDTH = 1400;       // pixel width each page is rendered at (sharp on most screens)
const FIRST_BATCH = 4;           // pages rendered before the book is shown
const ZOOM_STEPS = [1, 1.5, 2, 3, 4];
const SAFE_LINK = /^(https?:|mailto:|tel:)/i;

// Which issue to show: issues/current.pdf, or ?issue=<file>.pdf from the archive list.
const params = new URLSearchParams(location.search);
const requested = params.get("issue");
const issueFile = requested && /^[\w.-]+\.pdf$/i.test(requested) ? requested : "current.pdf";
const pdfUrl = `issues/${issueFile}`;
els.download.href = pdfUrl;

let pdf = null;
let pageFlip = null;
let pageCount = 0;
let ratio = 595 / 842; // width / height, replaced by the PDF's real page size
let issueTitle = "The Restore Report";
const pageUrls = [];   // rendered page image (blob URL) per page index
const pageLinks = [];  // link areas per page index: [{ left, top, width, height, url?, page? }]
let zoomIndex = 0;

async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function formatDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return String(value);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function setTitle(title, date) {
  const text = [title || "Latest issue", formatDate(date)].filter(Boolean).join(" · ");
  els.title.textContent = text;
  issueTitle = `${title || "Latest issue"} – The Restore Report`;
  document.title = issueTitle;
}

async function setupArchive() {
  // Optional: issues/archive.json = { "issues": [ { "title": "...", "date": "2026-11-15", "file": "2026-11-15.pdf" } ] }
  const data = await fetchJson("issues/archive.json");
  const list = data && Array.isArray(data.issues) ? data.issues.filter((i) => i && /^[\w.-]+\.pdf$/i.test(i.file || "")) : [];
  if (!list.length) return;
  const opt = (value, label, selected) => { const o = document.createElement("option"); o.value = value; o.textContent = label; o.selected = selected; return o; };
  els.archive.append(opt("current.pdf", "Latest issue", issueFile === "current.pdf"));
  for (const i of list) els.archive.append(opt(i.file, [i.title, formatDate(i.date)].filter(Boolean).join(" – ") || i.file, i.file === issueFile));
  els.archive.hidden = false;
  els.archive.addEventListener("change", () => {
    const v = els.archive.value;
    location.search = v === "current.pdf" ? "" : `?issue=${encodeURIComponent(v)}`;
  });
}

function showError(message) {
  els.status.hidden = false;
  els.status.classList.add("error");
  els.statusText.innerHTML = "";
  const p = document.createElement("span");
  p.textContent = message + " ";
  const a = document.createElement("a");
  a.href = pdfUrl; a.textContent = "Try downloading the PDF instead.";
  els.statusText.append(p, a);
}

let toastTimer = 0;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
}

// Size the book so a whole page (mobile) or spread (desktop) fits the screen.
function isSpread() { return window.innerWidth >= MOBILE_BREAKPOINT && pageCount > 1; }
function sizeHolder() {
  const cs = getComputedStyle(els.stage);
  const availW = els.stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = els.stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const pages = isSpread() ? 2 : 1;
  const w = Math.max(200, Math.min(availW, availH * ratio * pages));
  els.holder.style.width = `${Math.floor(w)}px`;
}

// Page indexes (0-based) currently on screen.
function visiblePages() {
  if (!pageFlip) return [0];
  const i = pageFlip.getCurrentPageIndex();
  const landscape = pageFlip.getOrientation() === "landscape";
  if (landscape && i > 0 && i + 1 < pageCount) {
    const left = i % 2 === 1 ? i : i - 1;
    return [left, left + 1];
  }
  return [i];
}

function updateInfo() {
  if (!pageFlip) return;
  const vis = visiblePages();
  const phone = window.innerWidth < MOBILE_BREAKPOINT;
  els.info.textContent = vis.length === 2
    ? `Pages ${vis[0] + 1}–${vis[1] + 1} of ${pageCount}`
    : phone ? `${vis[0] + 1} / ${pageCount}` : `Page ${vis[0] + 1} of ${pageCount}`;
  els.info.setAttribute("aria-label", `Page ${vis[0] + 1} of ${pageCount}`);
  els.prev.disabled = vis[0] <= 0;
  els.next.disabled = vis[vis.length - 1] >= pageCount - 1;
  for (const t of els.thumbs.querySelectorAll(".thumb")) {
    const on = vis.includes(Number(t.dataset.index));
    t.classList.toggle("current", on);
    if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  }
  if (zoomIndex > 0) renderZoom();
}

function goToPage(index) {
  if (!pageFlip) return;
  index = Math.max(0, Math.min(pageCount - 1, index));
  if (visiblePages().includes(index)) return;
  pageFlip.turnToPage(index);
  updateInfo();
}

// ---------- Rendering ----------

async function resolveDest(dest) {
  try {
    const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || !explicit.length) return null;
    const ref = explicit[0];
    return typeof ref === "number" ? ref : await pdf.getPageIndex(ref);
  } catch { return null; }
}

// Link annotations on a page, as percentages of the page size.
async function getLinks(page) {
  const viewport = page.getViewport({ scale: 1 });
  const links = [];
  let annots = [];
  try { annots = await page.getAnnotations({ intent: "display" }); } catch { return links; }
  for (const a of annots) {
    if (a.subtype !== "Link" || !a.rect) continue;
    const url = a.url || (a.unsafeUrl && SAFE_LINK.test(a.unsafeUrl) ? a.unsafeUrl : null);
    let target = null;
    if (!url && a.dest) target = await resolveDest(a.dest);
    if (!url && target == null) continue;
    const [ta, tb, tc, td, te, tf] = viewport.transform; // PDF space → screen space
    const pt = (x, y) => [ta * x + tc * y + te, tb * x + td * y + tf];
    const [x1, y1] = pt(a.rect[0], a.rect[1]), [x2, y2] = pt(a.rect[2], a.rect[3]);
    const left = Math.min(x1, x2), top = Math.min(y1, y2);
    links.push({
      left: (left / viewport.width) * 100, top: (top / viewport.height) * 100,
      width: (Math.abs(x2 - x1) / viewport.width) * 100, height: (Math.abs(y2 - y1) / viewport.height) * 100,
      url, page: target,
    });
  }
  return links;
}

function linkLayer(index) {
  const layer = document.createElement("div");
  layer.className = "links-layer";
  for (const l of pageLinks[index] || []) {
    const a = document.createElement("a"); // no child elements: StPageFlip forwards clicks on <a> only
    a.className = "pdf-link";
    a.style.left = `${l.left}%`; a.style.top = `${l.top}%`;
    a.style.width = `${l.width}%`; a.style.height = `${l.height}%`;
    if (l.url) {
      a.href = l.url; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", `Open link: ${l.url.replace(/^mailto:/i, "email ")}`);
      a.title = l.url.replace(/^mailto:/i, "");
    } else {
      a.href = `#page=${l.page + 1}`;
      a.setAttribute("aria-label", `Go to page ${l.page + 1}`);
      a.addEventListener("click", (e) => { e.preventDefault(); closeZoom(); goToPage(l.page); });
    }
    layer.append(a);
  }
  return layer;
}

async function renderCanvas(n, width) {
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  return { page, canvas };
}

async function renderPage(n) {
  const { page, canvas } = await renderCanvas(n, RENDER_WIDTH);
  try { pageLinks[n - 1] = await getLinks(page); } catch (err) { console.warn("Links unavailable", err); pageLinks[n - 1] = []; }
  page.cleanup();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  canvas.width = canvas.height = 0; // free memory
  return URL.createObjectURL(blob);
}

// ---------- Thumbnails ----------

function buildThumbs() {
  els.thumbs.replaceChildren();
  for (let i = 0; i < pageCount; i++) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "thumb"; b.dataset.index = i;
    b.setAttribute("role", "listitem");
    b.setAttribute("aria-label", `Go to page ${i + 1}`);
    b.innerHTML = `<span class="thumb-img"><span class="thumb-ph">${i + 1}</span></span><span class="thumb-num">${i + 1}</span>`;
    b.addEventListener("click", () => { goToPage(i); if (window.innerWidth < MOBILE_BREAKPOINT) closePanels(); });
    els.thumbs.append(b);
  }
}
function fillThumb(i) {
  const box = els.thumbs.querySelector(`.thumb[data-index="${i}"] .thumb-img`);
  if (!box || !pageUrls[i]) return;
  const img = new Image(); img.src = pageUrls[i]; img.alt = ""; img.loading = "lazy";
  box.replaceChildren(img);
}

// ---------- Panels ----------

function closePanels() {
  for (const [k, p] of Object.entries(panels)) { p.hidden = true; panelButtons[k].setAttribute("aria-expanded", "false"); panelButtons[k].classList.remove("active"); }
}
function togglePanel(name) {
  const opening = panels[name].hidden;
  closePanels();
  if (!opening) return;
  panels[name].hidden = false;
  panelButtons[name].setAttribute("aria-expanded", "true");
  panelButtons[name].classList.add("active");
  if (name === "search") els.searchInput.focus();
  if (name === "thumbs") {
    const cur = els.thumbs.querySelector(".thumb.current");
    if (cur) cur.scrollIntoView({ block: "nearest", inline: "center" });
  }
}
for (const name of Object.keys(panels)) {
  panelButtons[name].addEventListener("click", () => togglePanel(name));
  panels[name].querySelector("[data-close]").addEventListener("click", () => { closePanels(); panelButtons[name].focus(); });
}

// ---------- Contents (only when the PDF has bookmarks) ----------

async function setupToc() {
  let outline = null;
  try { outline = await pdf.getOutline(); } catch {}
  if (!outline || !outline.length) return;
  // Some design tools (e.g. Canva) turn every heading and text box into a bookmark.
  // Only treat the outline as a real contents list if it is reasonably sparse.
  const count = (items) => items.reduce((n, i) => n + 1 + count(i.items || []), 0);
  if (count(outline) > Math.max(6, pageCount * 3)) return;
  const add = async (items, list, depth) => {
    for (const item of items) {
      const li = document.createElement("li");
      const target = item.dest ? await resolveDest(item.dest) : null;
      if (target != null || item.url) {
        const b = document.createElement(item.url ? "a" : "button");
        b.className = "toc-item"; b.style.paddingLeft = `${12 + depth * 16}px`;
        b.textContent = item.title || "Untitled";
        if (item.url) { b.href = item.url; b.target = "_blank"; b.rel = "noopener noreferrer"; }
        else {
          b.type = "button";
          const pn = document.createElement("span"); pn.className = "toc-page"; pn.textContent = target + 1;
          b.append(pn);
          b.addEventListener("click", () => { goToPage(target); if (window.innerWidth < MOBILE_BREAKPOINT) closePanels(); });
        }
        li.append(b);
      }
      list.append(li);
      if (item.items && item.items.length && depth < 3) await add(item.items, list, depth + 1);
    }
  };
  await add(outline, els.toc, 0);
  if (els.toc.children.length) els.btnToc.hidden = false;
}

// ---------- Search (PDF.js text extraction) ----------

let pageTexts = null;
async function loadTexts() {
  if (pageTexts) return pageTexts;
  const texts = [];
  for (let n = 1; n <= pageCount; n++) {
    try {
      const page = await pdf.getPage(n);
      const tc = await page.getTextContent();
      texts.push(tc.items.map((it) => it.str + (it.hasEOL ? " " : "")).join("").replace(/\s+/g, " ").trim());
    } catch { texts.push(""); }
  }
  pageTexts = texts;
  return texts;
}
els.searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = els.searchInput.value.trim();
  els.searchResults.replaceChildren();
  if (q.length < 2) { els.searchMsg.textContent = "Type at least 2 letters."; return; }
  els.searchMsg.textContent = "Searching…";
  const texts = await loadTexts();
  const needle = q.toLowerCase();
  let hits = 0;
  texts.forEach((text, i) => {
    const lower = text.toLowerCase();
    let pos = lower.indexOf(needle), shown = 0;
    while (pos !== -1 && shown < 3) {
      hits++; shown++;
      const start = Math.max(0, pos - 40), end = Math.min(text.length, pos + needle.length + 40);
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button"; b.className = "result";
      const pg = document.createElement("span"); pg.className = "result-page"; pg.textContent = `Page ${i + 1}`;
      const snip = document.createElement("span"); snip.className = "result-text";
      const mark = document.createElement("mark"); mark.textContent = text.slice(pos, pos + needle.length);
      snip.append((start > 0 ? "…" : "") + text.slice(start, pos), mark, text.slice(pos + needle.length, end) + (end < text.length ? "…" : ""));
      b.append(pg, snip);
      b.addEventListener("click", () => { goToPage(i); if (window.innerWidth < MOBILE_BREAKPOINT) closePanels(); });
      li.append(b); els.searchResults.append(li);
      pos = lower.indexOf(needle, pos + needle.length);
    }
  });
  els.searchMsg.textContent = hits ? `Found ${hits} match${hits === 1 ? "" : "es"}.` : `No matches for “${q}”.`;
});

// ---------- Zoom ----------

let zoomJob = 0;
async function renderZoom() {
  const job = ++zoomJob;
  const z = ZOOM_STEPS[zoomIndex];
  const vis = visiblePages();
  const holderW = els.holder.getBoundingClientRect().width || els.stage.clientWidth;
  const pageW = Math.round((vis.length === 2 ? holderW / 2 : holderW) * z);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const wrap = document.createElement("div");
  wrap.className = "zoom-spread";
  for (const i of vis) {
    const box = document.createElement("div");
    box.className = "zoom-page";
    box.style.width = `${pageW}px`;
    box.style.aspectRatio = String(ratio);
    if (pageUrls[i]) { const img = new Image(); img.src = pageUrls[i]; img.alt = `Page ${i + 1}`; img.draggable = false; box.append(img); }
    box.append(linkLayer(i));
    wrap.append(box);
  }
  els.zoomPages.replaceChildren(wrap);
  // Re-render sharper for the zoom level (the book images are 1400px wide).
  const target = Math.min(4096, Math.round(pageW * dpr));
  if (target <= RENDER_WIDTH * 1.05) return;
  for (const [k, i] of vis.entries()) {
    try {
      const { page, canvas } = await renderCanvas(i + 1, target);
      page.cleanup();
      if (job !== zoomJob) { canvas.width = canvas.height = 0; return; }
      canvas.className = "zoom-canvas";
      canvas.setAttribute("aria-hidden", "true");
      const box = wrap.children[k];
      const old = box.querySelector("img, canvas");
      if (old) old.replaceWith(canvas); else box.prepend(canvas);
    } catch (err) { console.warn("Zoom render failed", err); }
  }
}
function setZoom(index) {
  zoomIndex = Math.max(0, Math.min(ZOOM_STEPS.length - 1, index));
  const on = zoomIndex > 0;
  els.zoomView.hidden = !on;
  els.zoomClose.hidden = !on;
  els.holder.classList.toggle("zoomed", on);
  els.zoomOut.disabled = !on;
  document.body.classList.toggle("is-zoomed", on);
  els.zoomIn.disabled = zoomIndex === ZOOM_STEPS.length - 1;
  els.zoomIn.setAttribute("aria-label", on ? `Zoom in (now ${ZOOM_STEPS[zoomIndex] * 100}%)` : "Zoom in");
  if (on) {
    const v = els.zoomView;
    const cx = v.scrollWidth ? (v.scrollLeft + v.clientWidth / 2) / v.scrollWidth : 0.5;
    const cy = v.scrollHeight ? (v.scrollTop + v.clientHeight / 2) / v.scrollHeight : 0.5;
    renderZoom().then(() => {});
    requestAnimationFrame(() => {
      v.scrollLeft = cx * v.scrollWidth - v.clientWidth / 2;
      v.scrollTop = cy * v.scrollHeight - v.clientHeight / 2;
    });
  } else {
    zoomJob++;
    els.zoomPages.replaceChildren();
  }
}
function closeZoom() { if (zoomIndex > 0) setZoom(0); }
els.zoomIn.addEventListener("click", () => setZoom(zoomIndex + 1));
els.zoomOut.addEventListener("click", () => setZoom(zoomIndex - 1));
els.zoomClose.addEventListener("click", () => { setZoom(0); els.zoomIn.focus(); });

// ---------- Pinch and double-tap zoom (phones) ----------
// StPageFlip cancels the browser's own touch gestures on the book, so two-finger
// pinches are caught here first (capture phase) and turned into the reader's zoom.
let pinch = null;
const touchDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
function cancelFlipTouch() {
  const ui = pageFlip && pageFlip.ui;
  if (ui) ui.touchPoint = null;
  try { if (pageFlip && pageFlip.getState() !== "read") pageFlip.flipController && pageFlip.flipController.stopMove(); } catch {}
}
window.addEventListener("touchstart", (e) => {
  if (e.touches.length < 2 || !e.target.closest || !e.target.closest("#stage")) return;
  if (e.target.closest(".panel")) return;
  cancelFlipTouch();
  const target = zoomIndex > 0 ? els.zoomPages : els.holder;
  pinch = { d0: touchDist(e.touches), scale: 1, target, startZoom: zoomIndex };
  target.style.transformOrigin = "50% 50%";
  e.stopPropagation(); if (e.cancelable) e.preventDefault();
}, { capture: true, passive: false });
window.addEventListener("touchmove", (e) => {
  if (!pinch) return;
  e.stopPropagation(); if (e.cancelable) e.preventDefault();
  if (e.touches.length < 2) return;
  pinch.scale = Math.max(0.25, Math.min(4, touchDist(e.touches) / pinch.d0));
  pinch.target.style.transform = `scale(${pinch.scale})`;
}, { capture: true, passive: false });
const endPinch = (e) => {
  if (!pinch) return;
  e.stopPropagation();
  if (e.touches.length > 0) return; // wait for the last finger
  const { scale, target, startZoom } = pinch;
  pinch = null;
  target.style.transform = "";
  const want = ZOOM_STEPS[startZoom] * scale;
  let best = 0;
  for (let i = 0; i < ZOOM_STEPS.length; i++) if (Math.abs(ZOOM_STEPS[i] - want) < Math.abs(ZOOM_STEPS[best] - want)) best = i;
  if (scale > 1.1 && best <= startZoom) best = Math.min(startZoom + 1, ZOOM_STEPS.length - 1);
  if (scale < 0.9 && best >= startZoom) best = Math.max(startZoom - 1, 0);
  if (best !== startZoom) setZoom(best);
};
window.addEventListener("touchend", endPinch, { capture: true });
window.addEventListener("touchcancel", endPinch, { capture: true });
// Quick one-finger swipes turn the page. StPageFlip's own swipe only works
// forwards in single-page mode, so quick swipes are handled here instead.
let swipe = null;
window.addEventListener("touchstart", (e) => {
  swipe = null;
  if (e.touches.length !== 1 || zoomIndex > 0 || !pageFlip) return;
  if (!e.target.closest || !e.target.closest("#book-holder")) return;
  const t = e.touches[0];
  swipe = { x: t.clientX, y: t.clientY, t: Date.now() };
}, { capture: true, passive: true });
window.addEventListener("touchend", (e) => {
  if (!swipe || pinch || e.changedTouches.length !== 1) { swipe = null; return; }
  const t = e.changedTouches[0];
  const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y, dt = Date.now() - swipe.t;
  swipe = null;
  if (dt > 240 || Math.abs(dx) < 40 || Math.abs(dx) < 1.5 * Math.abs(dy)) return; // let StPageFlip handle drags and taps
  e.stopPropagation();
  if (pageFlip.ui) pageFlip.ui.touchPoint = null;
  if (dx < 0) pageFlip.flipNext(); else pageFlip.flipPrev();
}, { capture: true });

// Double-tap the page to zoom in to 200%; double-tap again to go back.
let lastTap = 0;
els.stage.addEventListener("touchend", (e) => {
  if (e.changedTouches.length !== 1 || e.target.closest("a, button, .panel, .pdf-link")) return;
  const now = Date.now();
  if (now - lastTap < 300) { lastTap = 0; setZoom(zoomIndex > 0 ? 0 : 2); }
  else lastTap = now;
});

// ---------- Share ----------

els.btnShare.addEventListener("click", async () => {
  const url = location.href.split("#")[0];
  if (navigator.share) {
    try { await navigator.share({ title: issueTitle, text: "Read The Restore Report", url }); return; }
    catch (err) { if (err && err.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied – paste it into a message to share.");
  } catch {
    window.prompt("Copy this link to share:", url);
  }
});

// ---------- Main ----------

async function main() {
  setupArchive();
  // Optional override file. Normally left blank so the title comes from the PDF itself
  // and nothing goes stale when only current.pdf is replaced.
  const meta = issueFile === "current.pdf" ? (await fetchJson("issues/current.json")) || {} : {};

  try {
    pdf = await pdfjsLib.getDocument({ url: pdfUrl, ...PDFJS_ASSETS }).promise;
  } catch (err) {
    console.warn("Could not open PDF:", err);
    setTitle("Issue unavailable");
    showError("Sorry, this issue couldn't be opened.");
    return;
  }

  // Title: current.json "title" → the PDF's own title → "Latest issue".
  // Date: current.json "date" → the date the PDF was created.
  let pdfTitle = "", pdfDate = null;
  try {
    const info = (await pdf.getMetadata())?.info || {};
    pdfTitle = String(info.Title || "").trim().replace(/^the restore report\s*[-–—:|]\s*/i, "");
    if (info.CreationDate) pdfDate = pdfjsLib.PDFDateString.toDateObject(info.CreationDate);
  } catch {}
  const fallbackName = issueFile === "current.pdf" ? "Latest issue" : issueFile.replace(/\.pdf$/i, "");
  setTitle(meta.title || pdfTitle || fallbackName, meta.date || pdfDate);

  pageCount = pdf.numPages;
  const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
  ratio = first.width / first.height;
  buildThumbs();

  // Build one element per page with a placeholder; images are filled in as they render.
  const pageEls = [];
  for (let n = 1; n <= pageCount; n++) {
    const div = document.createElement("div");
    div.className = "page";
    div.dataset.density = n === 1 || n === pageCount ? "hard" : "soft";
    div.innerHTML = `<div class="ph">Loading page ${n}…</div>`;
    els.book.append(div);
    pageEls.push(div);
  }
  const fill = (n, url) => {
    pageUrls[n - 1] = url;
    const img = new Image();
    img.src = url; img.alt = `Page ${n}`; img.draggable = false;
    pageEls[n - 1].replaceChildren(img, linkLayer(n - 1));
    fillThumb(n - 1);
  };

  const firstBatch = Math.min(FIRST_BATCH, pageCount);
  for (let n = 1; n <= firstBatch; n++) {
    els.statusText.textContent = `Preparing page ${n} of ${pageCount}…`;
    fill(n, await renderPage(n));
  }

  els.controls.hidden = false; // show the toolbar first so the book is sized around it
  sizeHolder();
  window.addEventListener("resize", sizeHolder); // registered before StPageFlip's own resize handler
  pageFlip = new St.PageFlip(els.book, {
    width: Math.round(first.width), height: Math.round(first.height),
    size: "stretch", minWidth: 240, maxWidth: 2000, minHeight: 200, maxHeight: 3000,
    showCover: true, usePortrait: true, mobileScrollSupport: false,
    maxShadowOpacity: 0.4, flippingTime: 700, swipeDistance: 30, showPageCorners: true,
  });
  pageFlip.loadFromHTML(pageEls);
  pageFlip.on("flip", updateInfo);
  pageFlip.on("changeOrientation", () => { sizeHolder(); pageFlip.update(); updateInfo(); });
  pageFlip.on("init", updateInfo);

  els.status.hidden = true;
  els.holder.classList.add("ready");
  sizeHolder(); pageFlip.update();

  // Open at a shared page: …/#page=3
  const m = /page=(\d+)/.exec(location.hash);
  if (m) pageFlip.turnToPage(Math.max(0, Math.min(pageCount - 1, Number(m[1]) - 1)));
  updateInfo();

  setupToc();

  // Render the remaining pages in the background.
  for (let n = firstBatch + 1; n <= pageCount; n++) {
    try { fill(n, await renderPage(n)); } catch (err) { console.warn(`Page ${n} failed to render`, err); }
  }
}

els.prev.addEventListener("click", () => pageFlip && pageFlip.flipPrev());
els.next.addEventListener("click", () => pageFlip && pageFlip.flipNext());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (zoomIndex > 0) { setZoom(0); return; }
    if (Object.values(panels).some((p) => !p.hidden)) { closePanels(); return; }
  }
  if (!pageFlip || e.target.closest("select, input, textarea")) return;
  if (["ArrowRight", "PageDown"].includes(e.key)) { e.preventDefault(); pageFlip.flipNext(); }
  else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); pageFlip.flipPrev(); }
  else if (e.key === "Home") goToPage(0);
  else if (e.key === "End") goToPage(pageCount - 1);
  else if (e.key === "+" || e.key === "=") setZoom(zoomIndex + 1);
  else if (e.key === "-") setZoom(zoomIndex - 1);
});

// Full screen hides the browser's own bars (Android Chrome, Brave, desktop).
// iPhone Safari has no Fullscreen API, so the buttons stay hidden there;
// "Add to Home Screen" (see manifest.webmanifest) is the iPhone route.
const fsButtons = [els.fs, $("fullscreen-top")].filter(Boolean);
const fsEl = document.documentElement;
const canFullscreen = !!(document.fullscreenEnabled && fsEl.requestFullscreen);
if (canFullscreen) {
  for (const b of fsButtons) {
    b.hidden = false;
    b.addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else fsEl.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    });
  }
  document.addEventListener("fullscreenchange", () => {
    const on = !!document.fullscreenElement;
    document.body.classList.toggle("is-fullscreen", on);
    for (const b of fsButtons) { b.setAttribute("aria-label", on ? "Exit full screen" : "Full screen"); b.title = on ? "Exit full screen" : "Full screen"; }
  });
} else {
  for (const b of fsButtons) b.hidden = true;
}

main().catch((err) => { console.error(err); showError("Sorry, something went wrong opening this issue."); });
