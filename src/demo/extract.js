// Turns OCR segments (text + box) into structured invoice data.
//
//   rows      segments clustered into reading-order lines by vertical position
//   regex     labelled fields (invoice no., dates, PO, totals, tax, IBAN, emails…)
//   nlp       entities: people and places (compromise), companies (suffix rule), customer (layout rule)
//   table     header detection → column bands → row segmentation → line items
//   checks    qty × unit price = amount per line, Σ lines = subtotal, subtotal + tax = total
//
// Pure functions with no DOM access, so the same code runs for either OCR engine.

import nlp from 'compromise';

// ---------- helpers ----------

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const near = (a, b) => Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 0.002);
const round2 = (n) => Math.round(n * 100) / 100;

const CURRENCY = {
  '£': 'GBP', $: 'USD', '€': 'EUR', '¥': 'JPY', '₹': 'INR', '₨': 'PKR', Rs: 'PKR',
  GBP: 'GBP', USD: 'USD', EUR: 'EUR', CAD: 'CAD', AUD: 'AUD', NZD: 'NZD', CHF: 'CHF', JPY: 'JPY',
  INR: 'INR', PKR: 'PKR', AED: 'AED', SAR: 'SAR', SGD: 'SGD', HKD: 'HKD', ZAR: 'ZAR', SEK: 'SEK',
};
const SYM = '[£$€¥₹₨]|Rs\\.?';
const CODE = 'GBP|USD|EUR|CAD|AUD|NZD|CHF|JPY|INR|PKR|AED|SAR|SGD|HKD|ZAR|SEK';
const CURRENCY_TOKEN_RE = new RegExp(`${SYM}|\\b(?:${CODE})\\b`, 'g');
const GROUPED = '-?\\d{1,3}(?:[,.\\s]\\d{3})*[.,]\\d{2}';
const NUM = '-?\\d{1,3}(?:[,.\\s]\\d{3})+(?:[.,]\\d{1,2})?|-?\\d+(?:[.,]\\d{1,2})?';
const PRE = `(?:(?:${SYM})\\s?|\\b(?:${CODE})\\s?)`;
// currency before the number, currency after it (1.206,50 €), or a bare grouped decimal
const AMOUNT_RE = new RegExp(`${PRE}(?:${NUM})|(?:${GROUPED})\\s?(?:${SYM}|\\b(?:${CODE})\\b)|${GROUPED}\\b`);
const AMOUNT_RE_G = new RegExp(AMOUNT_RE.source, 'g');
const NUMBER_RE = /^-?\d+(?:[.,]\d+)?$/;

/** "£1,206.50" → { value: 1206.5, currency: 'GBP' }; handles 1.206,50 € and 1 206,50 too. */
export function parseAmount(raw) {
  if (!raw) return null;
  const cur = raw.match(new RegExp(`${SYM}|\\b(?:${CODE})\\b`))?.[0]?.replace('.', '');
  let s = raw.replace(CURRENCY_TOKEN_RE, '').replace(/\s/g, '').trim();
  if (!/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = s.length - lastComma - 1 === 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  const value = Number.parseFloat(s);
  return Number.isFinite(value) ? { value, currency: cur ? CURRENCY[cur] : null } : null;
}

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE_RES = [
  /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/, // 2026-09-12, 2026/09/12
  /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/, // 12/09/2026, 12.09.2026, 12-09-26
  new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, 'i'), // September 3, 2026
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s*[-\\s]?${MONTH}\\.?[-,\\s]+\\d{2,4}\\b`, 'i'), // 3rd Sept 2026, 12-Sep-26
  new RegExp(`\\b${MONTH}\\.?\\s+\\d{4}\\b`, 'i'), // September 2026
];
// Numeric dates must be real: 20-45-77 is a sort code, not a date.
const plausible = (s) => {
  const parts = s.split(/[/.-]/).map(Number);
  if (parts[0] > 999) return parts[1] >= 1 && parts[1] <= 12 && parts[2] >= 1 && parts[2] <= 31;
  const [a, b] = parts;
  return a >= 1 && b >= 1 && ((a <= 31 && b <= 12) || (a <= 12 && b <= 31));
};
const findDate = (text) => {
  for (const re of DATE_RES) {
    for (const m of text.matchAll(new RegExp(re.source, `${re.flags}g`))) {
      if (!/^\d/.test(m[0]) || !/^[\d/.-]+$/.test(m[0]) || plausible(m[0])) return m[0];
    }
  }
  return null;
};
// Only unambiguous formats become comparable dates (dd/mm vs mm/dd can't be told apart).
const toDate = (s) => {
  if (!s || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(s)) return null;
  const d = new Date(s.replace(/(\d)(st|nd|rd|th)\b/i, '$1').replace(/-(?=[a-z])/i, ' '));
  return Number.isNaN(d.getTime()) ? null : d;
};

// ---------- rows ----------

export function buildRows(segments) {
  const segs = segments
    .map((s, id) => ({ ...s, id, cy: (s.y0 + s.y1) / 2, h: s.y1 - s.y0 }))
    .sort((a, b) => a.cy - b.cy);
  const lineHeight = median(segs.map((s) => s.h)) || 16;
  const rows = [];
  for (const s of segs) {
    const row = rows.at(-1);
    if (row && Math.abs(s.cy - row.cy) < lineHeight * 0.45) {
      row.segs.push(s);
      row.cy = row.segs.reduce((sum, x) => sum + x.cy, 0) / row.segs.length;
    } else {
      rows.push({ segs: [s], cy: s.cy });
    }
  }
  for (const r of rows) {
    r.segs.sort((a, b) => a.x0 - b.x0);
    r.y0 = Math.min(...r.segs.map((s) => s.y0));
    r.y1 = Math.max(...r.segs.map((s) => s.y1));
    r.text = r.segs.map((s) => s.text).join('   ');
  }
  return { rows, lineHeight };
}

// ---------- regex pull ----------

// Value next to a label: rest of the same segment, then segments to the right, then the one below.
function findLabeled(rows, labelRe, pick, { skipRow, skipSeg } = {}) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (skipRow?.(row)) continue;
    for (let i = 0; i < row.segs.length; i++) {
      const seg = row.segs[i];
      const m = seg.text.match(labelRe);
      if (!m || skipSeg?.(seg)) continue;
      const rest = seg.text.slice(m.index + m[0].length).replace(/^[\s:#.)-]+/, '');
      const own = rest && pick(rest);
      if (own) return { value: own, segIds: [seg.id] };
      for (const right of row.segs.slice(i + 1)) {
        const v = pick(right.text);
        if (v) return { value: v, segIds: [seg.id, right.id] };
      }
      // the value may sit directly under its label, but only on the very next line
      const next = rows[r + 1];
      const close = next && next.y0 - row.y1 < (seg.y1 - seg.y0) * 1.5;
      const below = close && next.segs.find((b) => b.x0 < seg.x1 && b.x1 > seg.x0);
      const v = below && pick(below.text);
      if (v) return { value: v, segIds: [seg.id, below.id] };
    }
  }
  return null;
}

// ---------- value pickers ----------

// IDs contain a digit and aren't money ("24.50" is a price, not a PO number).
const pickId = (t) => {
  for (const m of t.matchAll(/\b(?=[A-Z0-9/#._-]*\d)[A-Z0-9][A-Z0-9/._-]{1,}\b/gi)) {
    const before = t.slice(Math.max(0, m.index - 1), m.index);
    if (/^\d{1,3}(?:[,.]\d{3})*[.,]\d{2}$/.test(m[0]) || /[£$€¥₹]/.test(before)) continue;
    return m[0];
  }
  return null;
};
const pickAmount = (t) => t.match(AMOUNT_RE)?.[0]?.trim() ?? null;
const pickTerms = (t) =>
  t.match(/\b(?:net\s*\d{1,3}(?:\s*days)?|\d{1,3}\s*days?(?:\s*(?:net|from\s*invoice|eom))?|due\s*(?:on|upon)\s*receipt|cash\s*on\s*delivery|c\.?o\.?d\.?|e\.?o\.?m\.?|end\s*of\s*month|immediate(?:ly)?|prepaid|payment\s*in\s*advance)\b/i)?.[0] ?? null;
const pickDigits = (min, max) => (t) => t.match(new RegExp(`\\b\\d{${min},${max}}\\b`))?.[0] ?? null;
const pickSortCode = (t) => t.match(/\b\d{2}[-\s]\d{2}[-\s]\d{2}\b/)?.[0] ?? null;
const pickSwift = (t) => t.match(/\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/)?.[0] ?? null;
const pickTaxId = (t) =>
  t.match(/\b(?:[A-Z]{2}\s?)?\d[\dA-Z\s-]{5,16}[\dA-Z]\b|\b\d{2}-\d{7}\b|\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]{2}\b/)?.[0]?.trim() ?? null;

// ---------- label catalogue ----------
// Each field lists label patterns from most to least specific; the first that yields a value wins.

const SUBTOTAL_LABEL =
  /\b(?:sub\s*-?\s*total|net\s*(?:total|amount|value)|total\s*(?:excl\.?|excluding|ex\.?|before|net\s*of|w\/o|without)\s*(?:vat|tax|gst)?|amount\s*(?:before|excl\.?|excluding)\s*(?:vat|tax)|taxable\s*(?:amount|value)|goods\s*total)\b/i;
const TOTAL_EXCLUDE = /\b(?:sub\s*-?\s*total|total\s*(?:excl|excluding|ex\b|before|net|w\/o|without)|total\s*(?:qty|quantity|items|units|hours|weight))/i;

const LABELLED_FIELDS = [
  {
    key: 'invoiceNumber', label: 'Invoice number', pick: pickId,
    labels: [
      // note: '#' can't satisfy a trailing \b, so it gets its own branch in every suffix group
      /\b(?:tax\s*)?(?:invoice|inv)\.?\s*(?:(?:no|nr|num(?:ber)?|id|ref(?:erence)?|code)\b|#)\.?/i,
      /\b(?:bill|receipt|document|doc|credit\s*note|statement)\s*(?:(?:no|nr|num(?:ber)?|id)\b|#)\.?/i,
      /\brechnungs?\s*(?:nr|nummer)\b|\bfactura\s*(?:no|n[º°])|\bfacture\s*(?:no|n[º°])/i,
      /\b(?:our\s*)?ref(?:erence)?\b\.?\s*(?:no|#)?/i,
    ],
  },
  {
    key: 'invoiceDate', label: 'Invoice date', pick: findDate,
    labels: [
      /\b(?:invoice|bill(?:ing)?|document|issue|tax\s*point|statement|receipt)\s*date\b|\bdate\s*(?:of\s*)?(?:issue|invoice|supply)\b|\b(?:issued|dated)(?:\s*on)?\b|\brechnungsdatum\b/i,
      /^\s*date\b|\bdate\s*:/i,
    ],
  },
  {
    key: 'dueDate', label: 'Due date', pick: findDate,
    labels: [/\b(?:due\s*date|payment\s*due(?:\s*date)?|due\s*(?:by|on)|pay(?:ment)?\s*by|payable\s*(?:by|on)|expiry\s*date|f[aä]llig(?:keit)?)\b/i, /\bdue\b/i],
  },
  {
    key: 'deliveryDate', label: 'Delivery / service date', pick: findDate,
    labels: [/\b(?:delivery|ship(?:ping|ment)?|despatch|dispatch|service|supply|performance)\s*(?:date|period)\b/i],
  },
  {
    key: 'poNumber', label: 'PO number', pick: pickId,
    labels: [
      /\bP\.?\s?O\.?(?=[\s:#-]|$)(?:\s*(?:No|Nr|Number|Num|#))?\.?/, // case-sensitive: "Portland" isn't a PO
      /\bpurchase\s*order\b(?:\s*(?:no|nr|number|#))?/i,
      /\b(?:your|customer|client|sales)?\s*order\s*(?:(?:no|nr|num(?:ber)?|ref(?:erence)?)\b|#)\.?/i,
    ],
  },
  {
    key: 'customerId', label: 'Customer ID', pick: pickId,
    labels: [/\b(?:customer|client|member|buyer)\s*(?:(?:no|nr|num(?:ber)?|id|code|ref)\b|#)\.?|\bkunden\s*(?:nr|nummer)\b/i],
  },
  {
    key: 'paymentTerms', label: 'Payment terms', pick: pickTerms,
    labels: [/\b(?:payment\s*)?terms(?:\s*of\s*payment)?\b|\bzahlungs(?:bedingungen|ziel)\b/i],
  },
  { key: 'subtotal', label: 'Subtotal', pick: pickAmount, amount: true, labels: [SUBTOTAL_LABEL] },
  {
    key: 'discount', label: 'Discount', pick: pickAmount, amount: true,
    labels: [/\b(?:discount|less\s*discount|rebate|rabatt|promo(?:tion)?)\b/i],
  },
  {
    key: 'shipping', label: 'Shipping', pick: pickAmount, amount: true,
    labels: [/\b(?:shipping|delivery|freight|postage|carriage|handling|s\s*&\s*h|versand)\b(?!\s*(?:address|to|date|terms|method|note))/i],
  },
  {
    key: 'tax', label: 'Tax', pick: pickAmount, amount: true,
    labels: [
      /\b(?:vat|sales\s*tax|tax|gst|hst|pst|qst|mwst|ust|iva|tva|btw|igst|cgst|sgst|moms)\b(?!\s*(?:reg(?:istration)?|no\b|nr\b|number|id\b|code|#|-?\s*id))(?!-?idnr)/i,
    ],
    skipSeg: (s) => SUBTOTAL_LABEL.test(s.text) || /\btotal\b/i.test(s.text),
  },
  {
    key: 'total', label: 'Total', pick: pickAmount, amount: true,
    labels: [
      /\b(?:grand\s*total|total\s*(?:due|amount|payable|to\s*pay|incl\.?(?:uding)?\s*(?:vat|tax|gst)?|\(\s*[A-Z]{3}\s*\))|invoice\s*(?:total|amount)|amount\s*(?:due|payable|to\s*pay)|balance\s*(?:due|owing|payable)|gesamt(?:betrag)?|endbetrag)\b/i,
      /\btotal\b/i,
    ],
    skipSeg: (s) => TOTAL_EXCLUDE.test(s.text),
  },
  {
    key: 'amountPaid', label: 'Amount paid', pick: pickAmount, amount: true,
    labels: [/\b(?:amount\s*paid|paid(?:\s*to\s*date)?|payments?\s*(?:received|made)|deposit(?:\s*paid)?|credits?\s*applied)\b/i],
  },
  { key: 'sortCode', label: 'Sort code', pick: pickSortCode, labels: [/\bsort\s*code\b/i] },
  {
    key: 'accountNumber', label: 'Account number', pick: pickDigits(6, 12),
    labels: [/\b(?:account|acct|a\/c|konto)\b\s*(?:(?:no|nr|num(?:ber)?)\b|#)?\.?/i],
  },
  { key: 'routingNumber', label: 'Routing number', pick: pickDigits(6, 9), labels: [/\b(?:routing|aba|bsb|transit)\b\s*(?:(?:no|nr|number)\b|#)?/i] },
  { key: 'swift', label: 'BIC / SWIFT', pick: pickSwift, labels: [/\b(?:bic|swift)(?:\s*code)?\b/i] },
  {
    key: 'taxId', label: 'Tax / VAT ID', pick: pickTaxId,
    labels: [
      /\b(?:vat\s*(?:reg(?:istration)?\.?\s*(?:no|number)?|no|nr|number|id)|tax\s*(?:id|no|number|reg(?:istration)?)|ust-?\s*id(?:nr)?|steuer\s*(?:nr|nummer)|ein|tin|gstin|abn|ntn|siret|uid)\b\.?:?/i,
    ],
  },
  {
    key: 'companyNumber', label: 'Company number', pick: (t) => t.match(/\b[A-Z]{0,2}\d{6,10}\b/)?.[0] ?? null,
    labels: [/\b(?:company|reg(?:istration)?|registered|crn|cin|hrb)\s*(?:(?:no|nr|num(?:ber)?)\b|#)\.?|\bhrb\b/i],
  },
];

// Patterns that need no label; every distinct match is reported.
const PATTERN_FIELDS = [
  { key: 'email', label: 'Email', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { key: 'website', label: 'Website', re: /\b(?:https?:\/\/)?www\.[\w-]+(?:\.[\w-]+)+(?:\/[^\s]*)?|\bhttps?:\/\/[^\s]+/gi },
  {
    key: 'phone', label: 'Phone', re: /(?:\b(?:tel|phone|ph|mob(?:ile)?|fax|t|m)\.?\s*:?\s*)(\+?\(?\d[\d\s().-]{7,18}\d)|(\+\d{1,3}[\s.-]?\(?\d[\d\s().-]{6,16}\d)/gi,
    clean: (m) => (m[1] ?? m[2]).trim(), valid: (v) => v.replace(/\D/g, '').length >= 9,
  },
  {
    key: 'iban', label: 'IBAN', re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?\b/g,
    valid: (v) => ibanValid(v), note: 'checksum valid',
  },
  {
    key: 'vatId', label: 'EU VAT ID', re: /\b(?:GB|DE|FR|IE|NL|ES|IT|BE|AT|PL|PT|SE|DK|FI|LU|CZ)\s?(?:\d[\d\s]{7,13}\d|[A-Z]\d{7}[A-Z])\b/g,
    valid: (v) => !ibanValid(v),
  },
  { key: 'postcode', label: 'Postcode', re: /\b[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}\b|\b[A-Z]{2}\s\d{5}(?:-\d{4})?\b/g },
];

// ISO 13616 mod-97 checksum.
function ibanValid(raw) {
  const iban = raw.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

function regexPull(rows, allText, tableRegion) {
  const fields = [];
  const inTable = (row) => tableRegion && row.cy >= tableRegion.y0 - 2 && row.cy <= tableRegion.y1 + 2;

  for (const spec of LABELLED_FIELDS) {
    for (const re of spec.labels) {
      const hit = findLabeled(rows, re, spec.pick, { skipRow: inTable, skipSeg: spec.skipSeg });
      if (!hit) continue;
      const field = { key: spec.key, label: spec.label, value: hit.value, segIds: hit.segIds, method: 'label' };
      if (spec.amount) field.amount = parseAmount(hit.value);
      fields.push(field);
      break;
    }
  }

  const taxRate = allText.match(/\b(?:vat|tax|gst|hst|mwst|ust|iva|tva)\b[^%\n]{0,14}?(\d{1,2}(?:[.,]\d{1,2})?)\s?%/i)?.[1];
  if (taxRate) fields.push({ key: 'taxRate', label: 'Tax rate', value: `${taxRate}%`, segIds: [], method: 'pattern' });

  const symbols = allText.match(CURRENCY_TOKEN_RE) ?? [];
  if (symbols.length) {
    const counts = symbols.reduce((acc, c) => ((acc[c.replace('.', '')] = (acc[c.replace('.', '')] ?? 0) + 1), acc), {});
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    fields.push({ key: 'currency', label: 'Currency', value: CURRENCY[top] ?? top, segIds: [], method: 'pattern' });
  }

  if (!fields.some((f) => f.key === 'paymentTerms')) {
    for (const row of rows) {
      const seg = row.segs.find((s) => pickTerms(s.text));
      if (seg) {
        fields.push({ key: 'paymentTerms', label: 'Payment terms', value: pickTerms(seg.text), segIds: [seg.id], method: 'pattern' });
        break;
      }
    }
  }

  for (const spec of PATTERN_FIELDS) {
    const seen = new Set();
    for (const row of rows) {
      for (const seg of row.segs) {
        for (const m of seg.text.matchAll(spec.re)) {
          const value = (spec.clean ? spec.clean(m) : m[0]).trim();
          const norm = value.replace(/\s/g, '').toLowerCase();
          if (seen.has(norm) || (spec.valid && !spec.valid(value))) continue;
          // skip anything already captured, or a fragment of something captured (e.g. the start of an IBAN)
          const overlaps = (f) => {
            const other = f.value.replace(/\s/g, '').toLowerCase();
            return other.includes(norm) || norm.includes(other);
          };
          if (fields.some(overlaps)) continue;
          const sameSegment = seg.text.match(PATTERN_FIELDS.find((p) => p.key === 'iban').re);
          if (spec.key !== 'iban' && sameSegment?.some((iban) => ibanValid(iban) && iban.replace(/\s/g, '').toLowerCase().includes(norm))) continue;
          seen.add(norm);
          fields.push({ key: spec.key, label: spec.label, value, segIds: [seg.id], method: 'pattern', note: spec.note });
        }
      }
    }
  }
  return fields;
}

// ---------- NLP pull ----------

nlp.plugin({ words: { bill: 'Noun', attn: 'Noun', payable: 'Adjective', owner: 'Noun', invoice: 'Noun' } });
const LABELS = /^(?:bill(?:ed)?\s*to|ship\s*to|sold\s*to|invoice|attn|owner|accounts\s*payable|description|qty|amount)$/i;
const ORG_SUFFIX_RE =
  /\b(?:[A-Z][\w&'-]*\.?\s+){1,5}(?:Ltd|Limited|Inc|Incorporated|GmbH|LLC|PLC|Corp|Corporation|Co|Group|Company|AG|SA|BV|Pty)\b\.?/;
const clean = (s) => s.replace(/^[\s,.;:]+|[\s,.;:]+$/g, '');

function nlpPull(rows, tableRegion) {
  const entities = [];
  const seen = new Set();
  const add = (type, text, segId, method) => {
    const t = clean(text);
    const key = `${type}:${t.toLowerCase()}`;
    if (!t || t.length < 3 || LABELS.test(t) || seen.has(key)) return;
    seen.add(key);
    entities.push({ type, text: t, segIds: [segId], method });
  };

  const textRows = rows.filter((r) => !tableRegion || r.cy < tableRegion.y0 || r.cy > tableRegion.y1);
  for (const row of textRows) {
    for (const seg of row.segs) {
      if (AMOUNT_RE.test(seg.text) && seg.text.replace(AMOUNT_RE_G, '').trim().length < 3) continue;
      const org = seg.text.match(ORG_SUFFIX_RE)?.[0];
      if (org) add('Organization', org, seg.id, 'suffix rule');
      const doc = nlp(seg.text.replace(/^(?:attn|owner|accounts payable)\s*[:,]\s*/i, ''));
      doc.people().out('array').forEach((p) => add('Person', p, seg.id, 'compromise'));
      doc.places().out('array').forEach((p) => add('Place', p.replace(/^\d+\s+/, ''), seg.id, 'compromise'));
      if (!org) doc.organizations().out('array').filter((o) => o.split(/\s+/).length > 1).forEach((o) => add('Organization', o, seg.id, 'compromise'));
    }
  }

  // Layout rule: the first line under "Bill To" is the customer.
  for (let r = 0; r < rows.length; r++) {
    const label = rows[r].segs.find((s) => /^(?:bill(?:ed)?\s*to|invoice\s*to|sold\s*to|customer)\b/i.test(s.text));
    if (!label) continue;
    const rest = label.text.replace(/^(?:bill(?:ed)?\s*to|invoice\s*to|sold\s*to|customer)\s*:?\s*/i, '');
    const under = rest
      ? label
      : rows.slice(r + 1, r + 3).flatMap((row) => row.segs).find((s) => s.x0 < label.x0 + 40 && s.x1 > label.x0);
    if (under) entities.unshift({ type: 'Customer', text: clean(rest || under.text), segIds: [under.id], method: 'layout rule' });
    break;
  }
  // Vendor: a company found above the customer block, else the first line on the page.
  const customerY = rows.find((r) => r.segs.some((s) => /^(?:bill(?:ed)?\s*to|invoice\s*to|sold\s*to)\b/i.test(s.text)))?.cy ?? Infinity;
  const vendorOrg = entities.find((e) => e.type === 'Organization' && rows.some((r) => r.cy < customerY && r.segs.some((s) => s.id === e.segIds[0])));
  if (vendorOrg) entities.unshift({ type: 'Vendor', text: vendorOrg.text, segIds: vendorOrg.segIds, method: 'suffix rule + position' });
  return entities;
}

// ---------- table detection ----------

const HEADER_VOCAB = {
  description: /\b(?:description|item|items|product|service|services|details|particulars)\b/i,
  qty: /\b(?:qty|quantity|units?|hours|hrs|pcs)\b/i,
  unitPrice: /\b(?:unit\s*price|price|rate|unit\s*cost|cost)\b/i,
  amount: /\b(?:amount|line\s*total|total|net|ext(?:ended)?)\b/i,
};
const TOTALS_RE = /\b(?:sub\s*-?\s*total|total|vat|tax|gst|balance|amount\s*due)\b/i;

function detectHeader(rows) {
  let best = null;
  rows.forEach((row, index) => {
    const columns = [];
    for (const seg of row.segs) {
      // a segment may hold several headers if the OCR merged them, e.g. "Qty Unit Price"
      let text = seg.text;
      const found = [];
      for (const [key, re] of Object.entries(HEADER_VOCAB)) {
        if (columns.some((c) => c.key === key) || found.some((f) => f.key === key)) continue;
        const m = text.match(re);
        if (m) {
          found.push({ key, at: m.index, len: m[0].length });
          text = text.slice(0, m.index) + ' '.repeat(m[0].length) + text.slice(m.index + m[0].length);
        }
      }
      found.sort((a, b) => a.at - b.at);
      const charW = (seg.x1 - seg.x0) / Math.max(1, seg.text.length);
      for (const f of found) {
        columns.push({
          key: f.key,
          label: seg.text.substr(f.at, f.len),
          x0: seg.x0 + f.at * charW,
          x1: found.length > 1 ? seg.x0 + (f.at + f.len) * charW : seg.x1,
          segId: seg.id,
        });
      }
    }
    const numeric = columns.filter((c) => c.key !== 'description').length;
    const score = columns.length + (columns.some((c) => c.key === 'description') ? 1 : 0);
    if (numeric >= 2 && score >= 3 && (!best || score > best.score)) best = { index, columns, score };
  });
  return best;
}

function columnBands(columns, pageWidth) {
  const sorted = [...columns].sort((a, b) => a.x0 - b.x0).map((c) => ({ ...c, cx: (c.x0 + c.x1) / 2 }));
  return sorted.map((c, i) => ({
    ...c,
    from: i === 0 ? 0 : (sorted[i - 1].cx + c.cx) / 2,
    to: i === sorted.length - 1 ? pageWidth : (c.cx + sorted[i + 1].cx) / 2,
  }));
}

// Split a row's segments into column cells; segments spanning several bands are split by token position.
function rowCells(row, bands) {
  const cells = Object.fromEntries(bands.map((b) => [b.key, { text: [], segIds: [] }]));
  for (const seg of row.segs) {
    const covered = bands.filter((b) => seg.x1 > b.from && seg.x0 < b.to);
    const target = (x) => bands.find((b) => x >= b.from && x < b.to) ?? bands.at(-1);
    if (covered.length <= 1) {
      const band = target((seg.x0 + seg.x1) / 2);
      cells[band.key].text.push(seg.text);
      cells[band.key].segIds.push(seg.id);
      continue;
    }
    const charW = (seg.x1 - seg.x0) / Math.max(1, seg.text.length);
    let offset = 0;
    for (const token of seg.text.split(/(\s+)/)) {
      if (token.trim()) {
        const band = target(seg.x0 + (offset + token.length / 2) * charW);
        cells[band.key].text.push(token);
        if (!cells[band.key].segIds.includes(seg.id)) cells[band.key].segIds.push(seg.id);
      }
      offset += token.length;
    }
  }
  for (const k of Object.keys(cells)) cells[k].text = cells[k].text.join(' ').trim();
  return cells;
}

// Rows from the header down to the totals block (or a large vertical gap).
function bodyRows(rows, startIndex, bands) {
  const body = [];
  const gaps = [];
  for (let r = startIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (TOTALS_RE.test(row.text) && !row.segs.some((s) => s.x1 < (bands[1]?.from ?? 0))) break;
    if (TOTALS_RE.test(row.text) && /\b(?:sub\s*-?\s*total|total\s*due|balance)\b/i.test(row.text)) break;
    const prev = body.at(-1) ?? rows[startIndex];
    gaps.push(row.y0 - prev.y1);
    if (body.length > 1 && row.y0 - prev.y1 > median(gaps) * 4 + 20) break;
    body.push(row);
  }
  return body;
}

const isNumeric = (text) => /^[£$€¥₹₨]?\s?-?[\d.,\s]*\d[£$€]?$/.test(text.replace(/\b(?:GBP|USD|EUR|AUD|CAD)\b/g, '').trim());

// No header row (or the OCR missed it, e.g. white-on-colour headers): find a run of rows shaped
// like line items (text on the left, aligned numbers on the right) and infer the columns.
function layoutFromPattern(rows, pageWidth) {
  const isItemRow = (row) =>
    !TOTALS_RE.test(row.text) &&
    row.segs.filter((s) => isNumeric(s.text)).length >= 2 &&
    row.segs.some((s) => !isNumeric(s.text) && s.x0 < pageWidth * 0.45);
  let best = [];
  let run = [];
  for (const row of rows) {
    if (isItemRow(row)) run.push(row);
    else if (run.length && row.segs.every((s) => !isNumeric(s.text) && s.x1 < pageWidth * 0.55) && run.length) run.push(row); // wrapped description
    else {
      if (run.filter(isItemRow).length > best.filter(isItemRow).length) best = run;
      run = [];
    }
  }
  if (run.filter(isItemRow).length > best.filter(isItemRow).length) best = run;
  while (best.length && !isItemRow(best.at(-1))) best.pop();
  if (best.filter(isItemRow).length < 2) return null;

  // cluster the right edges of numeric cells: right-aligned columns share an edge
  const edges = best.flatMap((r) => r.segs.filter((s) => isNumeric(s.text)).map((s) => s));
  const tol = pageWidth * 0.03;
  const clusters = [];
  for (const s of edges.sort((a, b) => a.x1 - b.x1)) {
    const c = clusters.find((k) => Math.abs(k.x1 - s.x1) < tol);
    if (c) c.segs.push(s);
    else clusters.push({ x1: s.x1, segs: [s] });
  }
  const cols = clusters.filter((c) => c.segs.length >= 2).sort((a, b) => a.x1 - b.x1).slice(-3);
  if (cols.length < 2) return null;
  const keys = cols.length === 3 ? ['qty', 'unitPrice', 'amount'] : ['unitPrice', 'amount'];
  if (cols.length === 2 && cols[0].segs.every((s) => /^\d{1,4}$/.test(s.text.trim()))) keys[0] = 'qty';
  const labels = { qty: 'Qty', unitPrice: 'Unit price', amount: 'Amount' };
  const numeric = cols.map((c, i) => ({
    key: keys[i],
    label: labels[keys[i]],
    x0: Math.min(...c.segs.map((s) => s.x0)),
    x1: Math.max(...c.segs.map((s) => s.x1)),
  }));
  const descRight = Math.min(...numeric.map((c) => c.x0)) - 1;
  const columns = [{ key: 'description', label: 'Description', x0: 0, x1: descRight * 0.6 }, ...numeric];
  return { method: 'row pattern (no header found)', headerRow: null, bands: columnBands(columns, pageWidth), body: best };
}

function layoutFromHeader(rows, header, pageWidth) {
  const bands = columnBands(header.columns, pageWidth);
  if (!bands.some((b) => b.key === 'description')) bands[0] = { ...bands[0], key: 'description' };
  return { method: 'header + column bands', headerRow: rows[header.index], bands, body: bodyRows(rows, header.index, bands) };
}

function buildItems(body, bands) {
  const items = [];
  let pendingDescription = null;
  for (const row of body) {
    const cells = rowCells(row, bands);
    const numbers = ['qty', 'unitPrice', 'amount'].filter((k) => cells[k]?.text);
    if (!numbers.length) {
      // wrapped description line: attach to the item above (or the next one if none yet)
      if (items.length) {
        items.at(-1).description += ` ${cells.description.text}`;
        items.at(-1).segIds.push(...cells.description.segIds);
        items.at(-1).rows.push(row);
      } else {
        pendingDescription = cells.description;
      }
      continue;
    }
    const qtyText = cells.qty?.text.replace(/[^\d.,-]/g, '');
    const item = {
      description: [pendingDescription?.text, cells.description?.text].filter(Boolean).join(' '),
      qty: qtyText && NUMBER_RE.test(qtyText) ? Number.parseFloat(qtyText.replace(',', '.')) : null,
      unitPrice: parseAmount(cells.unitPrice?.text)?.value ?? null,
      amount: parseAmount(cells.amount?.text)?.value ?? null,
      cells,
      segIds: [...(pendingDescription?.segIds ?? []), ...Object.values(cells).flatMap((c) => c.segIds)],
      rows: [row],
      repairs: [],
    };
    pendingDescription = null;
    if (item.amount == null && item.qty != null && item.unitPrice != null) {
      item.amount = round2(item.qty * item.unitPrice);
      item.repairs.push({ field: 'amount', to: item.amount, reason: 'missing, computed from qty × price' });
    }
    if (item.qty == null && item.unitPrice && item.amount) {
      const q = item.amount / item.unitPrice;
      if (Math.abs(q - Math.round(q)) < 0.01) {
        item.qty = Math.round(q);
        item.repairs.push({ field: 'qty', to: item.qty, reason: 'missing, computed from amount ÷ price' });
      }
    }
    item.check = lineCheck(item);
    items.push(item);
  }
  return items;
}

const lineCheck = (i) => (i.qty != null && i.unitPrice != null && i.amount != null ? near(i.qty * i.unitPrice, i.amount) : null);
const digitsOf = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');

// OCR slips are common in numbers. When a line doesn't add up, try the smallest explanation:
//  1. a dropped decimal point ("£4275" for £42.75): the digits match what the maths says
//  2. one misread digit ("£204.00" for £294.00): replacing it makes the lines hit the subtotal exactly
// Every change is recorded on the item so the UI can show it.
function repairItems(items, subtotal) {
  const sum = () => round2(items.reduce((s, i) => s + (i.amount ?? 0), 0));
  for (const item of items) {
    if (item.check !== false) continue;
    const { qty, unitPrice, amount } = item;
    const expectedPrice = qty ? round2(amount / qty) : null;
    const expectedAmount = round2(qty * unitPrice);
    if (expectedPrice != null && digitsOf(item.cells.unitPrice?.text) === digitsOf(expectedPrice.toFixed(2))) {
      item.repairs.push({ field: 'unitPrice', from: unitPrice, to: expectedPrice, reason: 'decimal point lost in OCR' });
      item.unitPrice = expectedPrice;
    } else if (digitsOf(item.cells.amount?.text) === digitsOf(expectedAmount.toFixed(2))) {
      item.repairs.push({ field: 'amount', from: amount, to: expectedAmount, reason: 'decimal point lost in OCR' });
      item.amount = expectedAmount;
    } else if (subtotal != null) {
      const withFix = round2(sum() - amount + expectedAmount);
      if (near(withFix, subtotal)) {
        item.repairs.push({ field: 'amount', from: amount, to: expectedAmount, reason: 'misread digit, confirmed by subtotal' });
        item.amount = expectedAmount;
      } else if (near(sum(), subtotal) && expectedPrice != null) {
        item.repairs.push({ field: 'unitPrice', from: unitPrice, to: expectedPrice, reason: 'misread digit, amount confirmed by subtotal' });
        item.unitPrice = expectedPrice;
      }
    }
    item.check = lineCheck(item);
  }
}

function detectTable(rows, pageWidth) {
  const header = detectHeader(rows);
  const layout = (header && layoutFromHeader(rows, header, pageWidth)) || layoutFromPattern(rows, pageWidth);
  if (!layout) return null;
  let items = buildItems(layout.body, layout.bands);
  if (!items.length && header) {
    const fallback = layoutFromPattern(rows, pageWidth);
    if (fallback) {
      Object.assign(layout, fallback);
      items = buildItems(layout.body, layout.bands);
    }
  }
  if (!items.length) return null;

  const allRows = [layout.headerRow, ...layout.body].filter(Boolean);
  return {
    method: layout.method,
    headerRow: layout.headerRow,
    columns: layout.bands,
    region: {
      x0: Math.min(...allRows.flatMap((r) => r.segs.map((s) => s.x0))),
      x1: Math.max(...allRows.flatMap((r) => r.segs.map((s) => s.x1))),
      y0: allRows[0].y0,
      y1: Math.max(...allRows.map((r) => r.y1)),
    },
    items,
  };
}

// ---------- checks ----------

function reconcile(fields, table) {
  const checks = [];
  const get = (k) => fields.find((f) => f.key === k)?.amount?.value;
  const subtotal = get('subtotal');
  const tax = get('tax');
  const total = get('total');
  if (table) {
    repairItems(table.items, subtotal);
    const repaired = table.items.flatMap((i) => i.repairs.filter((r) => r.from !== undefined));
    if (repaired.length) checks.push({ label: 'OCR errors auto-corrected', ok: true, warn: true, detail: `${repaired.length} value${repaired.length > 1 ? 's' : ''}` });
    const lines = table.items.filter((i) => i.check !== null);
    const ok = lines.filter((i) => i.check).length;
    if (lines.length) checks.push({ label: 'Qty × unit price = amount', ok: ok === lines.length, detail: `${ok}/${lines.length} lines` });
    const sum = round2(table.items.reduce((s, i) => s + (i.amount ?? 0), 0));
    if (subtotal != null) checks.push({ label: 'Line items add up to subtotal', ok: near(sum, subtotal), detail: `${sum.toFixed(2)} vs ${subtotal.toFixed(2)}` });
    else if (total != null) checks.push({ label: 'Line items add up to total', ok: near(sum, total), detail: `${sum.toFixed(2)} vs ${total.toFixed(2)}` });
  }
  if (subtotal != null && tax != null && total != null) {
    const extras = (get('shipping') ?? 0) - Math.abs(get('discount') ?? 0);
    const expected = round2(subtotal + tax + extras);
    checks.push({ label: 'Subtotal + tax = total', ok: near(expected, total), detail: `${expected.toFixed(2)} vs ${total.toFixed(2)}` });
  }
  const issued = toDate(fields.find((f) => f.key === 'invoiceDate')?.value);
  const due = toDate(fields.find((f) => f.key === 'dueDate')?.value);
  if (issued && due) checks.push({ label: 'Due date is on or after invoice date', ok: due >= issued, detail: `${Math.round((due - issued) / 864e5)} days` });
  const iban = fields.find((f) => f.key === 'iban');
  if (iban) checks.push({ label: 'IBAN checksum (mod 97)', ok: true, detail: iban.value });
  return checks;
}

// ---------- entry point ----------

export function extractInvoice({ segments, width }) {
  const { rows } = buildRows(segments);
  const allText = rows.map((r) => r.text).join('\n');
  const table = detectTable(rows, width);
  const fields = regexPull(rows, allText, table?.region);
  const entities = nlpPull(rows, table?.region);
  const checks = reconcile(fields, table);
  return { rows, text: allText, fields, entities, table, checks };
}
