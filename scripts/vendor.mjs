// Copies the two open-source libraries from node_modules into vendor/ so the
// site has no external CDN dependencies. Run after `npm install` when upgrading.
import { cpSync, rmSync, mkdirSync } from "node:fs";
const nm = "node_modules";
rmSync("vendor", { recursive: true, force: true });
mkdirSync("vendor/pdfjs", { recursive: true });
mkdirSync("vendor/page-flip", { recursive: true });
for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) cpSync(`${nm}/pdfjs-dist/build/${f}`, `vendor/pdfjs/${f}`);
for (const d of ["cmaps", "standard_fonts", "wasm", "iccs"]) cpSync(`${nm}/pdfjs-dist/${d}`, `vendor/pdfjs/${d}`, { recursive: true });
cpSync(`${nm}/pdfjs-dist/LICENSE`, "vendor/pdfjs/LICENSE");
cpSync(`${nm}/page-flip/dist/js/page-flip.browser.js`, "vendor/page-flip/page-flip.browser.js");
cpSync(`${nm}/page-flip/LICENSE`, "vendor/page-flip/LICENSE");
console.log("vendor/ refreshed");
