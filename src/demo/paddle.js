// Minimal PaddleOCR (PP-OCRv4 mobile) in the browser on onnxruntime-web.
//
//  1. Detection (DBNet) turns the page into a text-probability map.
//  2. The map is binarised and split into connected regions; each region becomes a box,
//     expanded ("unclipped") the way PaddleOCR does, so every text segment keeps its own box.
//  3. Recognition (SVTR) reads each box; CTC greedy decoding maps outputs to characters.
//
// Invoices are axis-aligned, so boxes are axis-aligned rectangles: no OpenCV needed.

import * as ort from 'onnxruntime-web/wasm';

const ORT_VERSION = '1.30.0';
// PP-OCRv3 mobile detection (2.3 MB) + PP-OCRv5 English mobile recognition (7.5 MB), ONNX, Apache-2.0.
const MODELS = 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/';
const DET_URL = `${MODELS}detection/v3/det.onnx`;
const REC_URL = `${MODELS}languages/english/rec.onnx`;
const DICT_URL = `${MODELS}languages/english/dict.txt`;

const DET_MAX_SIDE = 1280; // longer side fed to the detector (multiple of 32)
const BIN_THRESHOLD = 0.3; // probability map → text mask
const BOX_THRESHOLD = 0.5; // minimum mean probability inside a region
const UNCLIP_RATIO = 1.6;
const MIN_REGION = 12; // pixels, in detector space
const REC_HEIGHT = 48; // fixed by the model's input shape
const REC_MAX_WIDTH = 1280;

ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
// Static hosting can't send the cross-origin-isolation headers threads need, so run single-threaded.
ort.env.wasm.numThreads = 1;

let enginePromise = null;

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(received / total);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function loadPaddle(onProgress = () => {}) {
  enginePromise ??= (async () => {
    const parts = { det: 0, rec: 0 };
    const report = () => onProgress(0.3 * parts.det + 0.7 * parts.rec);
    const [detBytes, recBytes, dictText] = await Promise.all([
      fetchWithProgress(DET_URL, (p) => ((parts.det = p), report())),
      fetchWithProgress(REC_URL, (p) => ((parts.rec = p), report())),
      fetch(DICT_URL).then((r) => r.text()),
    ]);
    const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    const [det, rec] = await Promise.all([
      ort.InferenceSession.create(detBytes, options),
      ort.InferenceSession.create(recBytes, options),
    ]);
    // CTC: index 0 is the blank; the dictionary follows; PaddleOCR appends a space character.
    const lines = dictText.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    const dictionary = ['', ...lines, ' '];
    return { det, rec, dictionary };
  })().catch((err) => {
    enginePromise = null;
    throw err;
  });
  return enginePromise;
}

// ---------- detection ----------

function detectorInput(image) {
  const scale = Math.min(1, DET_MAX_SIDE / Math.max(image.width, image.height));
  const w = Math.max(32, Math.round((image.width * scale) / 32) * 32);
  const h = Math.max(32, Math.round((image.height * scale) / 32) * 32);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const tensor = new Float32Array(3 * w * h);
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) tensor[c * w * h + i] = (data[i * 4 + c] / 255 - mean[c]) / std[c];
  }
  return { input: new ort.Tensor('float32', tensor, [1, 3, h, w]), w, h };
}

// Connected regions of the binarised probability map → axis-aligned boxes in detector space.
function regionsToBoxes(prob, w, h) {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = prob[i] > BIN_THRESHOLD ? 1 : 0;
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const boxes = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, count = 0, score = 0;
    while (top) {
      const p = stack[--top];
      const x = p % w;
      const y = (p - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      count++;
      score += prob[p];
      const neighbours = [p - 1, p + 1, p - w, p + w];
      for (let k = 0; k < 4; k++) {
        const q = neighbours[k];
        if (q < 0 || q >= w * h || seen[q] || !mask[q]) continue;
        if ((k === 0 && x === 0) || (k === 1 && x === w - 1)) continue;
        seen[q] = 1;
        stack[top++] = q;
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (Math.min(bw, bh) < 3 || count < MIN_REGION || score / count < BOX_THRESHOLD) continue;
    // PaddleOCR's unclip: grow the shrunk text kernel by area * ratio / perimeter.
    const d = (bw * bh * UNCLIP_RATIO) / (2 * (bw + bh));
    boxes.push({ x0: x0 - d, y0: y0 - d, x1: x1 + 1 + d, y1: y1 + 1 + d });
  }
  return boxes;
}

// ---------- recognition ----------

function recognizerInput(image, box) {
  const sw = box.x1 - box.x0;
  const sh = box.y1 - box.y0;
  const w = Math.min(REC_MAX_WIDTH, Math.max(16, Math.ceil((REC_HEIGHT * sw) / sh)));
  const canvas = new OffscreenCanvas(w, REC_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, box.x0, box.y0, sw, sh, 0, 0, w, REC_HEIGHT);
  const { data } = ctx.getImageData(0, 0, w, REC_HEIGHT);
  const n = w * REC_HEIGHT;
  const tensor = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) tensor[c * n + i] = (data[i * 4 + c] / 255 - 0.5) / 0.5;
  }
  return new ort.Tensor('float32', tensor, [1, 3, REC_HEIGHT, w]);
}

function ctcDecode(output, dictionary) {
  const [, steps, classes] = output.dims;
  const data = output.data;
  let text = '';
  let confidence = 0;
  let kept = 0;
  let prev = -1;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    let bestP = -Infinity;
    const base = t * classes;
    for (let c = 0; c < classes; c++) {
      if (data[base + c] > bestP) {
        bestP = data[base + c];
        best = c;
      }
    }
    if (best !== 0 && best !== prev) {
      text += dictionary[best] ?? '';
      confidence += bestP;
      kept++;
    }
    prev = best;
  }
  return { text: text.trim(), confidence: kept ? confidence / kept : 0 };
}

/**
 * Run OCR on an image (ImageBitmap / HTMLImageElement / canvas).
 * Returns text segments with boxes in the image's own pixel space.
 */
export async function recognizeWithPaddle(image, { onProgress = () => {}, onStage = () => {} } = {}) {
  const { det, rec, dictionary } = await loadPaddle((p) => onProgress('load', p));

  onStage('detect');
  const { input, w, h } = detectorInput(image);
  const detOut = await det.run({ [det.inputNames[0]]: input });
  const probTensor = detOut[det.outputNames[0]];
  const boxes = regionsToBoxes(probTensor.data, w, h);

  const sx = image.width / w;
  const sy = image.height / h;
  const scaled = boxes
    .map((b) => ({
      x0: Math.max(0, b.x0 * sx),
      y0: Math.max(0, b.y0 * sy),
      x1: Math.min(image.width, b.x1 * sx),
      y1: Math.min(image.height, b.y1 * sy),
    }))
    .filter((b) => b.x1 - b.x0 > 4 && b.y1 - b.y0 > 4)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

  onStage('recognize');
  const segments = [];
  for (let i = 0; i < scaled.length; i++) {
    const box = scaled[i];
    const out = await rec.run({ [rec.inputNames[0]]: recognizerInput(image, box) });
    const { text, confidence } = ctcDecode(out[rec.outputNames[0]], dictionary);
    if (text && confidence > 0.5) segments.push({ text, confidence, ...box });
    onProgress('recognize', (i + 1) / scaled.length);
  }
  return { segments, width: image.width, height: image.height };
}
