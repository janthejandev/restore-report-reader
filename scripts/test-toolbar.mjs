// Headless check of the toolbar: node scripts/test-toolbar.mjs [url] [screenshot dir]
// Works best with a PDF of 3+ pages that has bookmarks and links.
import { chromium } from "playwright-core";
const url = process.argv[2] || "http://localhost:8765/";
const out = process.argv[3] || "screenshots";
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
let ok = true;
const wait = (p, ms = 900) => p.waitForTimeout(ms);
for (const [name, vp, mobile] of [["desktop", { width: 1280, height: 800 }, false], ["mobile", { width: 390, height: 844 }, true]]) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.addInitScript(() => { try { delete Navigator.prototype.share; } catch {} });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(".book-holder.ready .page img", { timeout: 30000 });
  await wait(page, 1500);
  const r = { name };
  r.toolbarFits = await page.evaluate(() => { const t = document.querySelector("#controls"); return t.scrollWidth <= t.clientWidth + 1; });
  r.smallestTapTarget = await page.$$eval("#controls .tb:not([hidden])", (a) => Math.min(...a.filter((b) => b.offsetParent).map((b) => Math.min(b.offsetWidth, b.offsetHeight))));
  r.unlabelled = await page.$$eval("#controls button, #controls a", (a) => a.filter((b) => !b.getAttribute("aria-label")).length);
  r.links = await page.$$eval(".page .pdf-link", (a) => a.length);
  await page.screenshot({ path: `${out}/${name}-toolbar.png` });
  // Thumbnails
  await page.click("#btn-thumbs"); await wait(page);
  r.thumbs = await page.$$eval(".thumb", (a) => a.length);
  await page.screenshot({ path: `${out}/${name}-thumbs.png` });
  const lastThumb = r.thumbs - 1;
  await page.click(`.thumb[data-index="${Math.min(2, lastThumb)}"]`); await wait(page);
  r.afterThumb = await page.textContent("#page-info");
  if (!mobile) await page.click("#btn-thumbs");
  // Contents
  r.tocShown = await page.isVisible("#btn-toc");
  if (r.tocShown) {
    await page.click("#btn-toc"); await wait(page, 300);
    await page.locator(".toc-item").last().click(); await wait(page);
    r.afterToc = await page.textContent("#page-info");
    if (await page.isVisible("#panel-toc")) await page.click("#btn-toc");
  }
  // Search
  await page.click("#btn-search"); await page.fill("#search-input", "join"); await page.press("#search-input", "Enter");
  await page.waitForFunction(() => !/Searching/.test(document.querySelector("#search-msg").textContent));
  r.search = await page.textContent("#search-msg");
  await page.screenshot({ path: `${out}/${name}-search.png` });
  await page.locator(".result").first().click(); await wait(page);
  r.afterSearch = await page.textContent("#page-info");
  if (await page.isVisible("#panel-search")) await page.click("#btn-search");
  // Clickable external link opens a new tab
  await page.click("#prev").catch(() => {}); await page.keyboard.press("Home"); await wait(page);
  const link = page.locator(".stf__item.--left .pdf-link[target=_blank], .stf__item.--right .pdf-link[target=_blank], .stf__item .pdf-link[target=_blank]").first();
  if (await link.count()) {
    const href = await link.getAttribute("href");
    const [popup] = await Promise.all([ctx.waitForEvent("page", { timeout: 5000 }).catch(() => null), link.click({ force: true })]);
    r.linkClick = popup ? `opened new tab for ${href}` : `NO new tab for ${href}`;
    if (popup) await popup.close();
    r.infoAfterLinkClick = await page.textContent("#page-info");
  }
  // Zoom
  await page.click("#zoom-in"); await wait(page, 1500);
  r.zoomOpen = await page.isVisible("#zoom-view");
  r.zoomSharp = await page.$$eval(".zoom-page canvas, .zoom-page img", (a) => a.map((e) => e.tagName + ":" + (e.width || e.naturalWidth)));
  r.zoomLinks = await page.$$eval(".zoom-page .pdf-link", (a) => a.length);
  await page.click("#zoom-in"); await wait(page, 1500);
  await page.screenshot({ path: `${out}/${name}-zoom.png` });
  await page.click("#zoom-out"); await page.click("#zoom-out"); await wait(page, 300);
  r.zoomClosed = !(await page.isVisible("#zoom-view"));
  // Share (no Web Share API here → copies the link)
  await page.click("#btn-share"); await wait(page, 300);
  r.shareToast = await page.isVisible("#toast") ? await page.textContent("#toast") : "no toast";
  r.clipboard = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "unreadable");
  r.download = await page.getAttribute("#download", "href") + " download=" + (await page.getAttribute("#download", "download") !== null);
  r.errors = errors;
  console.log(JSON.stringify(r, null, 1));
  if (errors.length || !r.toolbarFits || r.smallestTapTarget < 44 || r.unlabelled || !r.zoomOpen || !r.zoomClosed || !/copied/i.test(r.shareToast)) ok = false;
  await ctx.close();
}
await browser.close();
process.exit(ok ? 0 : 1);
