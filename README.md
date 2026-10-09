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

Three palettes: `gold` (default), `amethyst` and `crimson`. Visitors switch with the diamonds in the
top bar, and their pick is remembered. `?theme=crimson` in the URL forces one.

- Change the default: `data-theme` on `<html>` in `index.html`.
- Edit or add a palette: the `[data-theme='…']` blocks in `src/style.css` **and** `WORLD_THEMES` in
  `src/world.js` (the 3D island), plus a button in the `.themes` group.

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
