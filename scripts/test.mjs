// Headless smoke test: node scripts/test.mjs [url]
import { chromium } from "playwright-core";
const url = process.argv[2] || "http://localhost:8765/";
const out = process.argv[3] || "screenshots";
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
let ok = true;
for (const [name, vp, mobile] of [["desktop", { width: 1280, height: 800 }, false], ["mobile", { width: 390, height: 844 }, true]]) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 });
  const page = await ctx.newPage();
  const errors = [], external = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("request", (r) => { const u = new URL(r.url()); if (!["localhost", new URL(url).hostname].includes(u.hostname) && !u.protocol.startsWith("blob") && !u.protocol.startsWith("data")) external.push(r.url()); });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(".book-holder.ready .page img", { timeout: 30000 });
  await page.waitForTimeout(800);
  const info1 = await page.textContent("#page-info");
  const title = await page.textContent("#issue-title");
  const imgs = await page.$$eval(".page img", (a) => a.map((i) => i.complete && i.naturalWidth));
  const orient = await page.evaluate(() => document.querySelector(".stf__wrapper").className);
  await page.screenshot({ path: `${out}/${name}-cover.png` });
  await page.click("#next"); await page.waitForTimeout(1200);
  const info2 = await page.textContent("#page-info");
  await page.screenshot({ path: `${out}/${name}-page2.png` });
  await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(1200);
  const info3 = await page.textContent("#page-info");
  await page.waitForTimeout(500);
  // swipe (touch on mobile) / drag (mouse on desktop) to turn
  const box = await page.locator("#book-holder").boundingBox();
  const y = box.y + box.height / 2, startX = box.x + box.width - 20, endX = box.x + 20;
  if (mobile) {
    const cdp = await ctx.newCDPSession(page);
    const t = (type, x) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await t("touchStart", startX);
    for (let s = 1; s <= 4; s++) await t("touchMove", startX - ((startX - endX) * s) / 4); // quick swipe
    await t("touchEnd");
  } else {
    await page.mouse.move(startX, y); await page.mouse.down();
    for (let s = 1; s <= 10; s++) await page.mouse.move(startX - ((startX - endX) * 0.6 * s) / 10, y);
    await page.mouse.up();
  }
  await page.waitForTimeout(1200);
  const info4 = await page.textContent("#page-info");
  console.log(JSON.stringify({ name, title, orient, imgs, info1, info2_afterNext: info2, info3_afterArrowLeft: info3, info4_afterDrag: info4, errors, external }, null, 1));
  if (errors.length || external.length || info1 === info2) ok = false;
  await ctx.close();
}
await browser.close();
process.exit(ok ? 0 : 1);
