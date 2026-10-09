# Umer Khan · Portfolio

**Live:** https://omacrow.github.io · **Demo:** https://omacrow.github.io/#demo

Portfolio of a Senior AI Engineer working on document AI, automation and backend systems. It's a
horizontal-scroll site over a procedural Three.js island, with a live invoice-extraction demo that
runs entirely in the browser.

**Stack:** Vite · Three.js · GSAP ScrollTrigger · Lenis · onnxruntime-web · Tesseract.js · PDF.js · compromise

## Sections

Intro → About → Experience → AI & automation work → **Live demo** → Skills → Contact → a small game.

## Live demo: invoice extraction

Drop in an invoice photo, scan or PDF and watch it become structured data. Everything runs on the
visitor's device; nothing is uploaded. Code lives in `src/demo/`.

| Stage | How |
| --- | --- |
| Input | Images, or PDFs via PDF.js. A **digital PDF's text layer** is read directly (exact text and positions, no OCR); **scanned PDFs** are rendered and sent through OCR. Page 1 only. |
| OCR | **PaddleOCR** (PP-OCRv3 detection + PP-OCRv5 English recognition, ONNX, ~10 MB) on onnxruntime-web with a small custom pipeline in `paddle.js`: DBNet probability map → connected regions → unclipped boxes → SVTR recognition → CTC decoding. No OpenCV. **Tesseract.js** (~4 MB) as a lighter alternative. Every engine outputs text segments with boxes. |
| Regex pull | A catalogue of labelled fields (invoice no., dates, PO, customer ID, payment terms, subtotal / discount / shipping / tax / total, sort code, account, routing, BIC/SWIFT, tax and company IDs) with many label variants, plus label-free patterns (emails, phones, websites, IBAN with mod-97 check, EU VAT IDs, postcodes). Impossible dates are rejected. |
| NLP pull | `compromise` for people and places, a company-suffix rule for organisations, and a layout rule for the customer ("Bill To"). Each entity records the method that found it. |
| Table detection | Header row → column bands → rows clustered by position → line items, with wrapped descriptions merged. Falls back to a row-pattern detector when no header is readable (e.g. white-on-colour headers). |
| Checks and repair | qty × price = amount, lines = subtotal, subtotal + tax (+ shipping − discount) = total, due ≥ issue date. Misread numbers are repaired only when the maths proves the fix (dropped decimal point; digit confirmed by the subtotal), and every repair is shown. |

The UI overlays every detected segment, the table region and column bands on the invoice, links each
result to its source text on hover, and exports the result as JSON.

Models and runtimes load from Hugging Face and jsDelivr only when someone presses Run, then stay in
the browser cache. Sample invoices are fictional and rendered by `node scripts/build-samples.mjs` into
`public/demo/`.

## Game

The last section is a small Geometry Dash–style runner (`src/game/dash.js`): 2D canvas, fixed-timestep
physics, procedural obstacle patterns and a speed ramp. Space / ↑ / click or tap to jump; hold to keep
jumping. Runs are saved only when the player chooses to, in `localStorage` as AES-GCM encrypted JSON
(`src/game/scores.js`). The key ships with the page, so this deters casual edits rather than
determined cheating.

## Run locally

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build in dist/
npm run preview   # serve the build
npm run cv        # render cv/cv.html to public/cv.pdf (needs local Chrome)
node scripts/build-samples.mjs   # re-render the demo's sample invoices
```

Set `CHROME_PATH` if Chrome isn't in its default location (used by the CV and sample scripts).

## Deploy

GitHub Pages via GitHub Actions: every push to `main` builds and deploys with
`.github/workflows/deploy.yml` (repo **Settings → Pages → Source: GitHub Actions**).

## Customising

- **Colour themes:** `amethyst` (default), `gold` and `crimson`, switched from the top bar and
  remembered per visitor; `?theme=crimson` forces one. Change the default with `data-theme` on
  `<html>` in `index.html`. A palette lives in two places: the `[data-theme='…']` blocks in
  `src/style.css` and `WORLD_THEMES` in `src/world.js`.
- **Stores section:** built but hidden. Remove `hidden` from `#stores` in `index.html`, restore its nav
  link and renumber the later sections. Screenshots are in `public/work/`.
- **Fonts:** headings use PP Mori (Pangram Pangram), self-hosted from `public/fonts/`; body and labels
  use Geist and Geist Mono from Google Fonts. PP Mori is a commercial typeface, so check its licence
  covers web use.

## Project layout

| Path | What it does |
| --- | --- |
| `index.html` | All content (readable without JavaScript) |
| `src/main.js` | Horizontal scroll, navigation, reveals, theme switcher, lazy-loading of the world, demo and game |
| `src/world.js` | Procedural 3D island, lighting, camera rig and theme palettes |
| `src/style.css` | Design tokens, themes, layout, responsive and reduced-motion styles |
| `src/cursor.js` | Windows 98 pixel cursors, generated as SVG |
| `src/demo/` | Invoice demo: `demo.js` (UI), `paddle.js`, `tesseract.js`, `pdf.js` (inputs and OCR), `extract.js` (regex, NLP, tables, checks) |
| `src/game/` | Runner game and encrypted score storage |
| `cv/cv.html` | CV source, rendered to `public/cv.pdf` |
| `scripts/` | CV and sample-invoice renderers |
| `public/` | Static files: CV, fonts, demo samples, store screenshots |

## Behaviour

- **Desktop (> 900px):** vertical scroll drives horizontal travel; ← / → jump between sections. Inner
  areas (demo viewer and results) scroll on their own and hand the wheel back to the page at their ends.
- **Mobile:** a normal vertical page with the island dimmed behind it; the demo accepts camera photos.
- **Performance:** Three.js, the demo, OCR engines, PDF.js and the game load lazily. The island renders
  at a capped resolution, drops to 30 fps when idle and pauses while OCR runs.
- **`prefers-reduced-motion`:** no smooth scroll, reveals or ambient animation.
- **No WebGL:** the island is hidden and everything else still works.
