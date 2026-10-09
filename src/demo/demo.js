// UI for the in-browser invoice extraction demo.
// The OCR engines and the extractor are imported only when someone presses Run.

const ENGINES = {
  paddle: { label: 'PaddleOCR', size: '≈10 MB', load: () => import('./paddle.js').then((m) => m.recognizeWithPaddle) },
  tesseract: { label: 'Tesseract', size: '≈4 MB', load: () => import('./tesseract.js').then((m) => m.recognizeWithTesseract) },
};
const MAX_SIDE = 2000; // phone photos are downscaled before OCR

const fmtMoney = (v, cur) => {
  if (v == null) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: cur ? 'currency' : 'decimal', currency: cur || undefined, minimumFractionDigits: 2 }).format(v);
  } catch {
    return v.toFixed(2);
  }
};
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
};

export function mountDemo(root, { onBusy = () => {} } = {}) {
  const $ = (sel) => root.querySelector(sel);
  const canvas = $('.demo__canvas');
  const ctx = canvas.getContext('2d');
  const status = $('[data-status]');
  const bar = $('[data-progress]');
  const runBtn = $('[data-run]');
  const results = $('[data-results]');
  const fileInput = $('[data-upload]');

  let source = null; // canvas holding the image at OCR resolution
  let sourceName = '';
  let engine = 'paddle';
  let result = null; // { ocr, data, engine, ms }
  let highlight = new Set();
  let busy = false;

  // ---------- image loading ----------

  async function loadImage(blob, name) {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bitmap.width * scale);
    c.height = Math.round(bitmap.height * scale);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bitmap, 0, 0, c.width, c.height);
    bitmap.close?.();
    source = c;
    sourceName = name;
    result = null;
    highlight = new Set();
    renderResults();
    draw();
    setStatus(`Ready: ${name}. Pick an engine and run.`);
    runBtn.disabled = false;
  }

  async function loadSample(button) {
    root.querySelectorAll('[data-sample]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    const res = await fetch(button.dataset.sample);
    await loadImage(await res.blob(), button.dataset.name);
  }

  root.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', () => !busy && loadSample(b)));
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file || busy) return;
    if (!file.type.startsWith('image/')) return setStatus('Images only (JPG, PNG, WebP). For a PDF, take a screenshot.', true);
    root.querySelectorAll('[data-sample]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    await loadImage(file, file.name);
  });

  root.querySelectorAll('[name="engine"]').forEach((input) =>
    input.addEventListener('change', () => {
      engine = input.value;
    }),
  );

  // ---------- run ----------

  function setStatus(text, error = false) {
    status.textContent = text;
    status.classList.toggle('is-error', error);
  }
  const setProgress = (p) => bar.style.setProperty('--p', String(Math.max(0, Math.min(1, p))));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  runBtn.addEventListener('click', async () => {
    if (!source || busy) return;
    busy = true;
    runBtn.disabled = true;
    root.classList.add('is-busy');
    onBusy(true);
    const { label, size, load } = ENGINES[engine];
    try {
      setProgress(0.02);
      setStatus(`Loading ${label} (${size}, cached after the first run)…`);
      const [recognize, { extractInvoice }] = await Promise.all([load(), import('./extract.js')]);
      const t0 = performance.now();
      let lastPaint = 0;
      const ocr = await recognize(source, {
        onStage: (stage) => setStatus(stage === 'detect' ? 'Detecting text segments…' : 'Reading text…'),
        onProgress: async (phase, p) => {
          setProgress(phase === 'load' ? p * 0.5 : 0.5 + p * 0.45);
          if (phase === 'load') setStatus(`Downloading ${label} models… ${Math.round(p * 100)}%`);
          if (performance.now() - lastPaint > 120) {
            lastPaint = performance.now();
            await nextFrame();
          }
        },
      });
      setStatus('Extracting fields, entities and line items…');
      await nextFrame();
      const data = extractInvoice(ocr);
      const ms = Math.round(performance.now() - t0);
      result = { ocr, data, engine, ms };
      setProgress(1);
      const passed = data.checks.filter((c) => c.ok).length;
      setStatus(
        `${label}: ${ocr.segments.length} segments in ${(ms / 1000).toFixed(1)}s · ${data.table?.items.length ?? 0} line items · ${passed}/${data.checks.length} checks passed`,
      );
      renderResults();
      draw();
    } catch (err) {
      console.error(err);
      setStatus(`Something went wrong: ${err.message ?? err}. Check your connection and try again.`, true);
      setProgress(0);
    } finally {
      busy = false;
      runBtn.disabled = false;
      root.classList.remove('is-busy');
      onBusy(false);
    }
  });

  // ---------- overlay ----------

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const rgba = (triplet, a) => `rgba(${triplet.split(/\s+/).join(',')},${a})`;

  function draw() {
    const wrap = canvas.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = wrap.clientWidth;
    if (!source) {
      canvas.width = canvas.height = 0;
      return;
    }
    const scale = cssW / source.width;
    const cssH = source.height * scale;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.drawImage(source, 0, 0);
    if (!result) return;

    const accent = css('--accent-rgb');
    const ember = css('--ember-rgb');
    const lw = 1.5 / scale;
    const { ocr, data } = result;
    const segById = new Map(ocr.segments.map((s, i) => [i, s]));

    // table region, column bands and item rows
    const t = data.table;
    if (t) {
      const { x0, y0, x1, y1 } = t.region;
      ctx.fillStyle = rgba(accent, 0.07);
      ctx.fillRect(x0 - 6, y0 - 6, x1 - x0 + 12, y1 - y0 + 12);
      ctx.strokeStyle = rgba(accent, 0.9);
      ctx.lineWidth = lw * 1.5;
      ctx.strokeRect(x0 - 6, y0 - 6, x1 - x0 + 12, y1 - y0 + 12);
      ctx.setLineDash([6 / scale, 5 / scale]);
      ctx.lineWidth = lw;
      for (const band of t.columns.slice(1)) {
        ctx.beginPath();
        ctx.moveTo(band.from, y0 - 6);
        ctx.lineTo(band.from, y1 + 6);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const item of t.items) {
        const ry0 = Math.min(...item.rows.map((r) => r.y0)) - 3;
        const ry1 = Math.max(...item.rows.map((r) => r.y1)) + 3;
        if (item.check === false) {
          ctx.fillStyle = 'rgba(229,85,75,0.18)';
          ctx.fillRect(x0 - 6, ry0, x1 - x0 + 12, ry1 - ry0);
        } else if (item.repairs.some((r) => r.from !== undefined)) {
          ctx.fillStyle = rgba(ember, 0.16);
          ctx.fillRect(x0 - 6, ry0, x1 - x0 + 12, ry1 - ry0);
        }
      }
    }

    // every detected segment
    ctx.lineWidth = lw;
    for (const s of ocr.segments) {
      ctx.strokeStyle = rgba(accent, 0.45);
      ctx.strokeRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
    }
    // hovered result
    for (const id of highlight) {
      const s = segById.get(id);
      if (!s) continue;
      ctx.fillStyle = rgba(accent, 0.25);
      ctx.fillRect(s.x0 - 3, s.y0 - 3, s.x1 - s.x0 + 6, s.y1 - s.y0 + 6);
      ctx.strokeStyle = rgba(accent, 1);
      ctx.lineWidth = lw * 2;
      ctx.strokeRect(s.x0 - 3, s.y0 - 3, s.x1 - s.x0 + 6, s.y1 - s.y0 + 6);
    }
  }

  new ResizeObserver(() => draw()).observe(canvas.parentElement);
  new MutationObserver(() => draw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------- results ----------

  const tabs = [...root.querySelectorAll('[role="tab"]')];
  tabs.forEach((tab) =>
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      root.querySelectorAll('[role="tabpanel"]').forEach((p) => (p.hidden = p.id !== tab.getAttribute('aria-controls')));
    }),
  );

  // hovering (or tapping) any result highlights its source segments on the invoice
  results.addEventListener('pointerover', (e) => {
    const target = e.target.closest('[data-segs]');
    const next = new Set(target ? target.dataset.segs.split(',').filter(Boolean).map(Number) : []);
    if ([...next].join() === [...highlight].join()) return;
    highlight = next;
    draw();
  });
  results.addEventListener('pointerleave', () => {
    highlight = new Set();
    draw();
  });

  const withSegs = (node, ids) => {
    node.dataset.segs = (ids ?? []).join(',');
    return node;
  };

  function renderResults() {
    const panels = {
      items: $('#demo-items'),
      regex: $('#demo-regex'),
      nlp: $('#demo-nlp'),
      checks: $('#demo-checks'),
      raw: $('#demo-raw'),
    };
    const empty = (msg) => el('p', { className: 'demo__empty' }, msg);
    if (!result) {
      Object.values(panels).forEach((p) => p.replaceChildren(empty(source ? 'Press Run to extract.' : 'Pick a sample or upload an invoice.')));
      $('[data-download]').hidden = true;
      return;
    }
    const { data } = result;
    const currency = data.fields.find((f) => f.key === 'currency')?.value;

    // line items
    const t = data.table;
    if (!t) {
      panels.items.replaceChildren(empty('No line-item table found on this document.'));
    } else {
      const head = el('tr', {}, ['Description', 'Qty', 'Unit price', 'Amount', ''].map((h) => el('th', { scope: 'col' }, h)));
      const rows = t.items.map((i) => {
        const fixed = (field) => i.repairs.find((r) => r.field === field && r.from !== undefined);
        const cell = (field, text) => {
          const fix = fixed(field);
          const td = el('td', { className: fix ? 'is-fixed' : '' }, text);
          if (fix) td.title = `OCR read ${fix.from}; corrected: ${fix.reason}`;
          return td;
        };
        return withSegs(
          el(
            'tr',
            { className: i.check === false ? 'is-bad' : '' },
            el('td', {}, i.description || '—'),
            cell('qty', i.qty ?? '—'),
            cell('unitPrice', fmtMoney(i.unitPrice, currency)),
            cell('amount', fmtMoney(i.amount, currency)),
            el('td', { className: 'demo__tick', title: i.check === null ? 'not enough values to check' : '' }, i.check === null ? '·' : i.check ? '✓' : '✗'),
          ),
          i.segIds,
        );
      });
      panels.items.replaceChildren(
        el('p', { className: 'demo__meta' }, `Detected by ${t.method} · ${t.columns.length} columns · ${t.items.length} rows`),
        el('div', { className: 'demo__table-wrap' }, el('table', { className: 'demo__table' }, el('thead', {}, head), el('tbody', {}, rows))),
      );
    }

    // regex pull
    panels.regex.replaceChildren(
      data.fields.length
        ? el(
            'dl',
            { className: 'demo__fields' },
            data.fields.map((f) =>
              withSegs(
                el('div', {}, el('dt', {}, f.label, el('span', { className: 'demo__chip' }, f.method === 'label' ? 'label' : 'pattern')), el('dd', {}, f.value, f.note ? el('small', {}, ` ${f.note}`) : null)),
                f.segIds,
              ),
            ),
          )
        : empty('No fields matched.'),
    );

    // NLP pull
    panels.nlp.replaceChildren(
      data.entities.length
        ? el(
            'ul',
            { className: 'demo__entities' },
            data.entities.map((e) =>
              withSegs(el('li', {}, el('span', { className: `demo__type demo__type--${e.type.toLowerCase()}` }, e.type), el('b', {}, e.text), el('small', {}, e.method)), e.segIds),
            ),
          )
        : empty('No entities found.'),
    );

    // checks
    panels.checks.replaceChildren(
      data.checks.length
        ? el(
            'ul',
            { className: 'demo__checks' },
            data.checks.map((c) => el('li', { className: c.warn ? 'is-warn' : c.ok ? 'is-ok' : 'is-bad' }, el('span', {}, c.warn ? '!' : c.ok ? '✓' : '✗'), el('b', {}, c.label), el('small', {}, c.detail))),
          )
        : empty('Not enough numbers to reconcile.'),
    );

    // raw text, row by row
    panels.raw.replaceChildren(
      el('ol', { className: 'demo__raw' }, data.rows.map((r) => withSegs(el('li', {}, r.text), r.segs.map((s) => s.id)))),
    );

    $('[data-download]').hidden = false;
  }

  $('[data-download]').addEventListener('click', () => {
    if (!result) return;
    const { data, engine: used, ms } = result;
    const json = {
      source: sourceName,
      engine: ENGINES[used].label,
      ms,
      fields: Object.fromEntries(data.fields.map((f) => [f.key, f.amount?.value ?? f.value])),
      entities: data.entities.map(({ type, text, method }) => ({ type, text, method })),
      lineItems: (data.table?.items ?? []).map((i) => ({
        description: i.description,
        qty: i.qty,
        unitPrice: i.unitPrice,
        amount: i.amount,
        valid: i.check,
        corrections: i.repairs.filter((r) => r.from !== undefined).map(({ field, from, to, reason }) => ({ field, from, to, reason })),
      })),
      checks: data.checks.map(({ label, ok, detail }) => ({ label, ok, detail })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
    const a = el('a', { href: url, download: `${sourceName.replace(/\.[^.]+$/, '') || 'invoice'}-extracted.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // start with the first sample loaded so the stage isn't empty
  const first = root.querySelector('[data-sample]');
  if (first) loadSample(first);
  else renderResults();
}
