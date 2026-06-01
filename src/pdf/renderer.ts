import { chromium, Browser } from 'playwright';
import { Eta } from 'eta';
import path from 'path';

const eta = new Eta({
  views: path.join(__dirname, 'templates'),
  cache: true,
  autoEscape: true,
});

let _browser: Browser | null = null;

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
  const html = eta.render(template, data);
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
