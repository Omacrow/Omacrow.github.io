// PDF input for the demo (page 1).
// Digital PDFs carry a text layer with exact positions, so OCR can be skipped entirely; scanned
// PDFs are just images, so the rendered page goes through OCR like any photo.

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const TARGET_SIDE = 2000; // render resolution, matching the image path
const MIN_TEXT_ITEMS = 8; // fewer than this and the PDF is treated as scanned

// Text-layer items → segments in canvas pixels. Items on one line that nearly touch are joined,
// since some PDFs emit a run per word or even per glyph.
function itemsToSegments(items, viewport) {
  const raw = [];
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const size = Math.hypot(tx[2], tx[3]);
    const x0 = tx[4];
    const baseline = tx[5];
    raw.push({ text: item.str, x0, x1: x0 + item.width * viewport.scale, y0: baseline - size * 0.85, y1: baseline + size * 0.2, size });
  }
  raw.sort((a, b) => a.y1 - b.y1 || a.x0 - b.x0);

  const segments = [];
  for (const r of raw) {
    const last = segments.at(-1);
    const sameLine = last && Math.abs(last.y1 - r.y1) < r.size * 0.4;
    const gap = last ? r.x0 - last.x1 : Infinity;
    if (sameLine && gap > -r.size * 0.5 && gap < r.size * 0.6) {
      last.text += (gap > r.size * 0.15 && !last.text.endsWith(' ') && !r.text.startsWith(' ') ? ' ' : '') + r.text;
      last.x1 = Math.max(last.x1, r.x1);
      last.y0 = Math.min(last.y0, r.y0);
      last.y1 = Math.max(last.y1, r.y1);
    } else {
      segments.push({ ...r });
    }
  }
  return segments.map(({ size, ...s }) => ({ ...s, text: s.text.replace(/\s+/g, ' ').trim(), confidence: 1 }));
}

export async function readPdf(blob) {
  const data = new Uint8Array(await blob.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(4, TARGET_SIDE / Math.max(base.width, base.height)) });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    const { items } = await page.getTextContent();
    const segments = itemsToSegments(items, viewport);
    return { canvas, pages: doc.numPages, textSegments: segments.length >= MIN_TEXT_ITEMS ? segments : null };
  } finally {
    task.destroy(); // v6: cleanup lives on the loading task
  }
}
