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
let _launching: Promise<Browser> | null = null;
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

async function launchBrowser(): Promise<Browser> {
  // CHROMIUM_PATH overrides the executable only when explicitly set. Left unset
  // (the default in production now), Playwright uses its own bundled Chromium,
  // whose version is guaranteed to match the client library.
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  let lastErr: unknown;

  // Chromium can die on launch for transient reasons (memory pressure, a slow
  // cold start). A couple of retries turns a one-off SIGTRAP into a hiccup
  // instead of failing every advisor in the batch.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await chromium.launch({
        executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
    } catch (err) {
      lastErr = err;
      console.error(`[renderer] chromium.launch attempt ${attempt}/3 failed: ${(err as Error).message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 500));
    }
  }
  throw lastErr;
}

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = null;

  // Coalesce concurrent callers onto a single launch. The job runner analyses up
  // to 5 advisors in parallel, so without this lock the first batch would fire
  // several chromium.launch calls at once — wasting memory and raising the odds
  // that one of them crashes and takes the shared browser down with it.
  if (!_launching) {
    _launching = launchBrowser()
      .then(b => { _browser = b; return b; })
      .finally(() => { _launching = null; });
  }
  return _launching;
}

export async function renderPdf(template: string, data: Record<string, unknown>): Promise<Buffer> {
  const enriched = { ...data, _logoB64: getLogoB64() };
  const html = eta.render(template, enriched);
  if (!html) throw new Error(`Template '${template}' rendered empty`);

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
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
