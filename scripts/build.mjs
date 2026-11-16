// "Build" = copy the static site into dist/ (used by Cloudflare Pages).
// No bundler is needed: everything is plain HTML/CSS/JS with vendored libraries.
import { cpSync, rmSync, mkdirSync, existsSync, statSync, readdirSync } from "node:fs";
const files = ["index.html", "app.js", "style.css", ".nojekyll", "_headers", "favicon.svg", "manifest.webmanifest"];
const dirs = ["vendor", "issues", "assets"];
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
for (const f of files) if (existsSync(f)) cpSync(f, `dist/${f}`);
for (const d of dirs) if (existsSync(d)) cpSync(d, `dist/${d}`, { recursive: true });
const LIMIT = 25 * 1024 * 1024; // Cloudflare Pages per-file limit (25 MiB)
for (const f of readdirSync("dist/issues")) {
  const size = statSync(`dist/issues/${f}`).size;
  if (size > LIMIT) { console.error(`ERROR: issues/${f} is ${(size/1048576).toFixed(1)} MiB; Cloudflare Pages allows 25 MiB per file.`); process.exit(1); }
}
console.log("Built to dist/");
