# The Restore Report – page-turning reader

A free, self-hosted website that shows the latest issue of **The Restore Report** as a
page-turning magazine in any web browser. Two-page spreads on computers, one page at a
time on phones. Swipe, click, or use the arrow keys to turn pages.

No ads, no trackers, no third-party branding, and nothing is loaded from other websites.
Everything the site needs is in this repository.

- Temporary address: https://janthejandev.github.io/restore-report-reader/
- The site always shows `issues/current.pdf`.

---

## How to update each week

You only need a web browser. No code.

1. Export the new issue from Canva as a **PDF** (Share → Download → PDF Standard).
2. On your computer, **rename the file to exactly `current.pdf`** (all lower case).
3. Go to **https://github.com/janthejandev/restore-report-reader** and sign in.
4. Click the **`issues`** folder.
5. Click **Add file** (top right), then **Upload files**.
6. **Drag your `current.pdf`** into the box (or click "choose your files" and pick it).
   GitHub will replace last week's file because the name is the same.
7. Scroll down and click the green **Commit changes** button.
8. Wait about 1–2 minutes, then open the site. The new issue is live.
   If you still see last week's issue, refresh the page (on a phone, close and reopen the tab).

That's it. The title in the top bar comes from the PDF itself (Canva uses the design's name),
so give your Canva design a sensible name, e.g. "Issue 2 – 22 November 2026".

**Size limit:** keep the PDF under **25 MB** (Cloudflare Pages' limit per file; GitHub's web
upload also refuses files over 25 MB). Canva's "PDF Standard" with "Compress file" ticked is
usually a few MB.

### Optional extras (you can ignore these)

- **Change the title shown at the top** without changing the PDF: open `issues/current.json`,
  click the pencil icon, fill in `"title"` and `"date"` (e.g. `"2026-11-22"`), and commit.
  Remember to blank them again (`""`) next week, or the old title will stay.
- **Keep past issues online:** upload the old PDF to `issues/` with a dated name such as
  `2026-11-15.pdf`, then edit `issues/archive.json` like this:

  ```json
  { "issues": [
      { "title": "Issue 1", "date": "2026-11-15", "file": "2026-11-15.pdf" }
  ] }
  ```

  A "Past issues" menu then appears in the top bar. Each past issue also has its own link:
  `…/?issue=2026-11-15.pdf`. File names may only use letters, numbers, `-`, `_` and `.`.

---

## Moving to Cloudflare Pages later (free)

When there's a Cloudflare account, connect this repository in
Cloudflare → Workers & Pages → Create → Pages → Connect to Git, then use:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | *(leave blank)* |

Then add the custom domain (e.g. `read.therestorereport.uk`) under the project's
**Custom domains** tab. Weekly updates stay exactly the same: upload `current.pdf` to
GitHub and Cloudflare rebuilds automatically. The `_headers` file tells Cloudflare to make
browsers re-check the issue files so readers get the new PDF straight away.

## Hosting on GitHub Pages (the temporary address)

GitHub Pages serves this repository's `main` branch directly (Settings → Pages → Deploy from a
branch → `main` / root). Every commit, including a weekly PDF upload, republishes the site.
`deploy/github-pages-workflow.yml` is a ready-made GitHub Actions alternative that builds
`dist/` and deploys it. It is parked outside `.github/workflows/` because the tool that created
this repo wasn't allowed to add workflow files. To use it: move it to
`.github/workflows/pages.yml` (GitHub web editor: open the file, pencil icon, change the path),
then switch Settings → Pages → Source to "GitHub Actions". Not needed for normal use.

---

## For developers

Plain static site: `index.html`, `style.css`, `app.js`, plus vendored libraries in `vendor/`:

- [StPageFlip](https://github.com/Nodlik/StPageFlip) (`page-flip`, MIT) – page-turn effect
- [PDF.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`, Apache-2.0) – renders PDF pages

`app.js` renders each PDF page to a JPEG (1400 px wide) with PDF.js, shows the book after the
first 4 pages, and renders the rest in the background.

```sh
npm install          # only needed to refresh vendor/ or run tests
npm run vendor       # copy libraries from node_modules into vendor/
npm run build        # copy the site into dist/ (checks the 25 MiB file limit)
npm run serve        # http://localhost:8765
npm test             # headless Chrome smoke test + screenshots (needs Chrome)
```

UI accent colour: navy `#051E40`, sampled from the Restore Britain logo on
restorebritain.org.uk.

Code is MIT licensed; the vendored libraries keep their own licences (see `vendor/*/LICENSE`).
