// Renders cv/cv.html to public/cv.pdf with a locally installed Chrome.
// Usage: npm run cv   (set CHROME_PATH if Chrome lives somewhere unusual)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const defaultChrome = {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
}[process.platform];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? defaultChrome,
  headless: true,
});
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(root, 'cv', 'cv.html')).href, { waitUntil: 'networkidle0' });
await page.evaluateHandle('document.fonts.ready');

const out = path.join(root, 'public', 'cv.pdf');
await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
await browser.close();
console.log(`CV written to ${path.relative(root, out)}`);
