// Renders the demo's sample invoices (fictional companies) to public/demo/*.jpg.
// Usage: node scripts/build-samples.mjs   (set CHROME_PATH if Chrome isn't in the default location)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'demo');
fs.mkdirSync(outDir, { recursive: true });

const money = (n, cur) => `${cur}${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const invoices = [
  {
    file: 'invoice-northwind.jpg',
    accent: '#1f4e79',
    vendor: ['Northwind Office Supplies Ltd', '14 Harbour Street, Leeds LS1 4AB', 'billing@northwind-supplies.co.uk', 'VAT Reg: GB 284 5521 90'],
    customer: ['Bluefield Logistics', 'Attn: Sarah Mitchell', '220 Canal Road, Manchester M4 6DE'],
    number: 'INV-2026-0418',
    issued: '12/09/2026',
    due: '12/10/2026',
    po: 'PO-77812',
    currency: '£',
    taxLabel: 'VAT (20%)',
    taxRate: 0.2,
    items: [
      ['A4 Copier Paper (box of 5 reams)', 12, 24.5],
      ['Ergonomic Office Chair', 3, 189.0],
      ['Wireless Keyboard and Mouse Set', 6, 42.75],
      ['Whiteboard Markers (pack of 12)', 10, 8.9],
    ],
    footer: 'Payment by bank transfer. Sort code 20-45-77, Account 41982270. Thank you for your business.',
  },
  {
    file: 'invoice-atlas.jpg',
    accent: '#7a2e8e',
    vendor: ['Atlas Cloud Consulting Inc.', '901 Market Street, Suite 400, San Francisco, CA 94103', 'accounts@atlascloud.io'],
    customer: ['Redwood Retail Group', 'Accounts Payable, James Carter', '55 Pine Avenue, Portland, OR 97204'],
    number: 'AC-55102',
    issued: 'September 3, 2026',
    due: 'October 3, 2026',
    po: 'RRG-4410',
    currency: '$',
    taxLabel: 'Sales Tax (8.5%)',
    taxRate: 0.085,
    items: [
      ['Cloud Architecture Review', 1, 3200.0],
      ['Kubernetes Migration (hours)', 24, 145.0],
      ['Monitoring Setup and Dashboards', 1, 850.0],
    ],
    footer: 'Please include invoice number with payment. Late payments incur 1.5% monthly interest.',
  },
  {
    file: 'invoice-greenleaf.jpg',
    accent: '#2e7d4f',
    vendor: ['Greenleaf Foods GmbH', 'Hauptstrasse 21, 10115 Berlin, Germany', 'invoices@greenleaf-foods.de', 'USt-IdNr: DE 812 334 556'],
    customer: ['Cafe Lumen', 'Owner: Laura Becker', 'Rosenweg 8, 80331 Munich'],
    number: 'GF-10294',
    issued: '2026-08-28',
    due: '2026-09-27',
    po: '',
    currency: '€',
    taxLabel: 'VAT (7%)',
    taxRate: 0.07,
    items: [
      ['Organic Oat Milk 1L (case of 12)', 8, 18.6],
      ['Fair Trade Coffee Beans 1kg', 15, 21.4],
      ['Almond Croissant Dough (tray)', 20, 6.75],
      ['Compostable Cups 12oz (sleeve of 50)', 30, 4.2],
      ['Raw Cane Sugar Sticks (box of 1000)', 2, 13.5],
    ],
    footer: 'IBAN: DE89 3704 0044 0532 0130 00  BIC: COBADEFFXXX',
  },
];

function html(inv) {
  const rows = inv.items.map(([desc, qty, price]) => ({ desc, qty, price, amount: Math.round(qty * price * 100) / 100 }));
  const subtotal = rows.reduce((s, r) => s + r.amount, 0);
  const tax = Math.round(subtotal * inv.taxRate * 100) / 100;
  const total = subtotal + tax;
  const m = (n) => money(n, inv.currency);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: 1000px; padding: 64px 72px; font: 17px/1.5 Arial, Helvetica, sans-serif; color: #1d1d1f; background: #fff; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; }
    h1 { margin: 0; font-size: 44px; letter-spacing: 2px; color: ${inv.accent}; }
    .vendor b { font-size: 22px; }
    .meta { margin-top: 28px; display: flex; justify-content: space-between; }
    .meta table td { padding: 2px 0; } .meta table td:first-child { padding-right: 18px; color: #555; }
    .label { color: #555; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
    table.items { width: 100%; border-collapse: collapse; margin-top: 40px; }
    table.items th { text-align: left; background: ${inv.accent}; color: #fff; padding: 10px 12px; font-size: 15px; }
    table.items td { padding: 12px; border-bottom: 1px solid #ddd; }
    table.items .n { text-align: right; white-space: nowrap; }
    .totals { margin-left: auto; margin-top: 24px; width: 380px; }
    .totals div { display: flex; justify-content: space-between; padding: 6px 12px; }
    .totals .grand { background: #f2f2f2; font-weight: bold; font-size: 20px; }
    .foot { margin-top: 56px; color: #555; font-size: 15px; }
  </style></head><body>
    <div class="top">
      <div class="vendor">${inv.vendor.map((l, i) => (i === 0 ? `<b>${l}</b>` : l)).join('<br>')}</div>
      <h1>INVOICE</h1>
    </div>
    <div class="meta">
      <div><div class="label">Bill To</div>${inv.customer.join('<br>')}</div>
      <table>
        <tr><td>Invoice No:</td><td><b>${inv.number}</b></td></tr>
        <tr><td>Invoice Date:</td><td>${inv.issued}</td></tr>
        <tr><td>Due Date:</td><td>${inv.due}</td></tr>
        ${inv.po ? `<tr><td>PO Number:</td><td>${inv.po}</td></tr>` : ''}
      </table>
    </div>
    <table class="items">
      <tr><th>Description</th><th class="n">Qty</th><th class="n">Unit Price</th><th class="n">Amount</th></tr>
      ${rows.map((r) => `<tr><td>${r.desc}</td><td class="n">${r.qty}</td><td class="n">${m(r.price)}</td><td class="n">${m(r.amount)}</td></tr>`).join('')}
    </table>
    <div class="totals">
      <div><span>Subtotal</span><span>${m(subtotal)}</span></div>
      <div><span>${inv.taxLabel}</span><span>${m(tax)}</span></div>
      <div class="grand"><span>Total Due</span><span>${m(total)}</span></div>
    </div>
    <div class="foot">${inv.footer}</div>
  </body></html>`;
}

const defaultChrome = {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
}[process.platform];

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? defaultChrome, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 800, deviceScaleFactor: 1 });
for (const inv of invoices) {
  await page.setContent(html(inv), { waitUntil: 'load' });
  const out = path.join(outDir, inv.file);
  await page.screenshot({ path: out, type: 'jpeg', quality: 85, fullPage: true });
  console.log(`${path.relative(root, out)}  ${Math.round(fs.statSync(out).size / 1024)} KB`);
}
await browser.close();
