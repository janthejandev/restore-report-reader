// The Restore Report reader: renders a PDF with PDF.js and shows it as a
// page-turning book with StPageFlip. No servers, trackers or external CDNs.
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
  status: $("status"), statusText: $("status-text"), holder: $("book-holder"), book: $("book"),
  controls: $("controls"), prev: $("prev"), next: $("next"), info: $("page-info"), fs: $("fullscreen"),
};

const MOBILE_BREAKPOINT = 768;   // below this width: one page at a time
const RENDER_WIDTH = 1400;       // pixel width each page is rendered at (sharp on most screens)
const FIRST_BATCH = 4;           // pages rendered before the book is shown

// Which issue to show: issues/current.pdf, or ?issue=<file>.pdf from the archive list.
const params = new URLSearchParams(location.search);
const requested = params.get("issue");
const issueFile = requested && /^[\w.-]+\.pdf$/i.test(requested) ? requested : "current.pdf";
const pdfUrl = `issues/${issueFile}`;
els.download.href = pdfUrl;

let pageFlip = null;
let pageCount = 0;
let ratio = 595 / 842; // width / height, replaced by the PDF's real page size

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
  document.title = `${title || "Latest issue"} – The Restore Report`;
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

// Size the book so a whole page (mobile) or spread (desktop) fits the screen.
function isSpread() { return window.innerWidth >= MOBILE_BREAKPOINT && pageCount > 1; }
function sizeHolder() {
  const stage = $("stage");
  const cs = getComputedStyle(stage);
  const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const pages = isSpread() ? 2 : 1;
  const w = Math.max(200, Math.min(availW, availH * ratio * pages));
  els.holder.style.width = `${Math.floor(w)}px`;
}

function updateInfo() {
  if (!pageFlip) return;
  const i = pageFlip.getCurrentPageIndex();
  const landscape = pageFlip.getOrientation() === "landscape";
  // With a cover, spreads are [1], [2,3], [4,5] … (1-based page numbers)
  let label;
  if (landscape && i > 0 && i + 1 < pageCount) {
    const left = i % 2 === 1 ? i : i - 1;
    label = `Pages ${left + 1}–${left + 2} of ${pageCount}`;
  } else {
    label = `Page ${i + 1} of ${pageCount}`;
  }
  els.info.textContent = label;
  els.prev.disabled = i <= 0;
  const lastVisible = landscape && i > 0 ? (i % 2 === 1 ? i + 1 : i) : i;
  els.next.disabled = lastVisible >= pageCount - 1;
}

async function renderPage(pdf, n) {
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  page.cleanup();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  canvas.width = canvas.height = 0; // free memory
  return URL.createObjectURL(blob);
}

async function main() {
  setupArchive();
  // Optional override file. Normally left blank so the title comes from the PDF itself
  // and nothing goes stale when only current.pdf is replaced.
  const meta = issueFile === "current.pdf" ? (await fetchJson("issues/current.json")) || {} : {};

  let pdf;
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
    const img = new Image();
    img.src = url; img.alt = `Page ${n}`; img.draggable = false;
    pageEls[n - 1].replaceChildren(img);
  };

  const firstBatch = Math.min(FIRST_BATCH, pageCount);
  for (let n = 1; n <= firstBatch; n++) {
    els.statusText.textContent = `Preparing page ${n} of ${pageCount}…`;
    fill(n, await renderPage(pdf, n));
  }

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
  els.controls.hidden = false;
  sizeHolder(); pageFlip.update();
  updateInfo();

  // Render the remaining pages in the background.
  for (let n = firstBatch + 1; n <= pageCount; n++) {
    try { fill(n, await renderPage(pdf, n)); } catch (err) { console.warn(`Page ${n} failed to render`, err); }
  }
}

els.prev.addEventListener("click", () => pageFlip && pageFlip.flipPrev());
els.next.addEventListener("click", () => pageFlip && pageFlip.flipNext());
document.addEventListener("keydown", (e) => {
  if (!pageFlip || e.target.closest("select, input, textarea")) return;
  if (["ArrowRight", "PageDown"].includes(e.key)) { e.preventDefault(); pageFlip.flipNext(); }
  else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); pageFlip.flipPrev(); }
  else if (e.key === "Home") pageFlip.turnToPage(0), updateInfo();
  else if (e.key === "End") pageFlip.turnToPage(pageCount - 1), updateInfo();
});

if (document.fullscreenEnabled) {
  els.fs.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
} else {
  els.fs.hidden = true; // e.g. iPhone Safari has no fullscreen API
}

main().catch((err) => { console.error(err); showError("Sorry, something went wrong opening this issue."); });
