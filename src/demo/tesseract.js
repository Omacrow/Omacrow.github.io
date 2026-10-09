// Tesseract.js engine, normalised to the same segment format as the PaddleOCR engine.
// Tesseract reports words; words that sit close together on a line are joined into phrases
// so both engines hand the table detector comparable segments.

import { createWorker } from 'tesseract.js';

let workerPromise = null;
let progressHandler = () => {};

function loadTesseract() {
  workerPromise ??= createWorker('eng', 1, {
    logger: (m) => progressHandler(m),
  }).catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

function wordsToSegments(words) {
  const segments = [];
  // words arrive in reading order; join neighbours on the same line separated by a small gap
  for (const w of words) {
    const box = { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 };
    const h = box.y1 - box.y0;
    const last = segments.at(-1);
    const sameLine = last && Math.abs((last.y0 + last.y1) / 2 - (box.y0 + box.y1) / 2) < h * 0.5;
    const gap = last ? box.x0 - last.x1 : Infinity;
    if (sameLine && gap >= -2 && gap < h * 1.1) {
      last.text += ` ${w.text}`;
      last.x1 = Math.max(last.x1, box.x1);
      last.y0 = Math.min(last.y0, box.y0);
      last.y1 = Math.max(last.y1, box.y1);
      last.confidence = (last.confidence * last.words + w.confidence / 100) / (last.words + 1);
      last.words += 1;
    } else {
      segments.push({ text: w.text, confidence: w.confidence / 100, words: 1, ...box });
    }
  }
  return segments.filter((s) => s.text.trim() && s.confidence > 0.35).map(({ words, ...s }) => s);
}

export async function recognizeWithTesseract(image, { onProgress = () => {}, onStage = () => {} } = {}) {
  progressHandler = (m) => {
    if (m.status?.startsWith('loading') || m.status?.startsWith('initializ')) onProgress('load', m.progress ?? 0);
    else if (m.status === 'recognizing text') onProgress('recognize', m.progress ?? 0);
  };
  const worker = await loadTesseract();
  onStage('recognize');
  const { data } = await worker.recognize(image, {}, { blocks: true });
  const words = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) words.push(...line.words);
    }
  }
  return { segments: wordsToSegments(words), width: image.width, height: image.height };
}
