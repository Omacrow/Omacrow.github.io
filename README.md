# Umer Khan — Portfolio

Horizontal-scroll portfolio with a procedural Three.js world: a floating autumn island with a golden
tree, a ruined temple and falling leaves. Every object is generated in code, so the site ships no
3D model files. As you scroll, the camera orbits the island and finishes on a top-down isometric
view, a teaser for the walkable 2.5D version in development.

**Stack:** Vite · Three.js · GSAP ScrollTrigger · Lenis

## Run locally

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build in dist/
npm run preview   # serve the build
```

## Colour themes

Three palettes: `amethyst` (default), `gold` and `crimson`. Visitors switch with the colour swatches in the
top bar, and their pick is remembered. `?theme=crimson` in the URL forces one.

- Change the default: `data-theme` on `<html>` in `index.html`.
- Edit or add a palette: the `[data-theme='…']` blocks in `src/style.css` **and** `WORLD_THEMES` in
  `src/world.js` (the 3D island), plus a button in the `.themes` group.

## Live demo: invoice extraction

Runs entirely in the browser; invoices never leave the device. Code in `src/demo/`.

| Stage | How |
| --- | --- |
| OCR | **PaddleOCR** (PP-OCRv3 det + PP-OCRv5 English rec, ONNX, ~10 MB) on onnxruntime-web, with a small custom pipeline (`paddle.js`): DBNet probability map → connected regions → unclipped boxes → SVTR recognition → CTC decoding. **Tesseract.js** (~4 MB) as a lighter alternative. Both output text segments with boxes. |
| Regex pull | A catalogue of labelled fields (invoice no., dates, PO, terms, subtotal / tax / shipping / discount / total, bank details, tax IDs…) with many label variants, plus label-free patterns (emails, phones, websites, IBAN with mod-97 check, VAT IDs, postcodes). |
| NLP pull | `compromise` for people and places, a company-suffix rule for organisations, and a layout rule for the customer ("Bill To"). |
| Table detection | Header row → column bands → rows clustered by position → line items, with wrapped descriptions merged. Falls back to a row-pattern detector when no header is readable. |
| Checks and repair | qty × price = amount, lines = subtotal, subtotal + tax = total, due ≥ issue date. Misread numbers are repaired only when the maths proves the fix (dropped decimal point, digit confirmed by the subtotal), and every repair is shown. |

Models and runtimes load from jsDelivr / Hugging Face only when someone presses Run, and are cached afterwards.
Sample invoices (fictional companies) are rendered by `node scripts/build-samples.mjs` into `public/demo/`.

## Game

The last panel is a small Geometry Dash–style runner (`src/game/dash.js`): 2D canvas, fixed-timestep
physics, procedural obstacle patterns and a speed ramp. Space / ↑ / click or tap to jump, hold to keep
jumping. After a crash the player chooses whether to save the run; saved runs are kept in
`localStorage` as AES-GCM encrypted JSON (`src/game/scores.js`). The key ships with the page, so this
deters casual edits rather than determined cheating; a shared leaderboard would need a server.

## CV

`cv/cv.html` is the source of the CV. `npm run cv` renders it to `public/cv.pdf` (one A4 page) with
your local Chrome; set `CHROME_PATH` if Chrome isn't in the default location.

## Deploy (GitHub Pages)

1. Push to a GitHub repo on the `main` branch. Name it `Omacrow.github.io` to get the clean URL
   `https://omacrow.github.io` (the CV links there).
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. Every push to `main` builds and deploys via `.github/workflows/deploy.yml`.

## Project layout

| File | What it does |
| --- | --- |
| `index.html` | All content (readable without JavaScript) |
| `src/main.js` | Horizontal scroll, navigation, section reveals, progress |
| `src/world.js` | The procedural 3D island, lighting and camera rig |
| `src/style.css` | Design tokens, layout, responsive and reduced-motion styles |
| `public/` | Static files copied as-is (put `cv.pdf` here) |

## Behaviour

- **Desktop (> 900px):** vertical scroll drives horizontal travel; ← / → jump between sections.
- **Mobile:** a normal vertical page with the world dimmed behind it.
- **`prefers-reduced-motion`:** no smooth scroll, reveals or ambient animation.
- **No WebGL:** the canvas is hidden and the site still works.
- Three.js is lazy-loaded so text renders before the 3D world.
