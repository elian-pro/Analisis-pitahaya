import { chromium, Browser } from 'playwright';
import { Eta } from 'eta';
import path from 'path';
import fs from 'fs';

const eta = new Eta({
  views: path.join(__dirname, 'templates'),
  cache: true,
  autoEscape: true,
});

let _browser: Browser | null = null;
let _logoB64: string | null = null;

function getLogoB64(): string {
  if (_logoB64 !== null) return _logoB64;
  try {
    const logoPath = path.join(__dirname, '..', '..', 'Logo Zebra Blanco.png');
    _logoB64 = fs.readFileSync(logoPath).toString('base64');
  } catch {
    _logoB64 = '';
  }
  return _logoB64;
}

async function getBrowser(): Promise<Browser> {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return _browser;
}

export async function renderPdf(template: string, data: Record<string, unknown>): Promise<Buffer> {
  const enriched = { ...data, _logoB64: getLogoB64() };
  const html = eta.render(template, enriched);
  if (!html) throw new Error(`Template '${template}' rendered empty`);

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}
