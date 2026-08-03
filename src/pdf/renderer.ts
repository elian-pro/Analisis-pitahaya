import { chromium, Browser } from 'playwright';
import { Eta } from 'eta';
import path from 'path';
import fs from 'fs';
import { nivelLabel } from '../schemas/individual';

const eta = new Eta({
  views: path.join(__dirname, 'templates'),
  cache: true,
  autoEscape: true,
});

let _browser: Browser | null = null;
let _launching: Promise<Browser> | null = null;
let _logoB64: string | null = null;
let _fontsCss: string | null = null;
let _motifB64: string | null = null;

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

// Zebra brand fonts embedded as base64 @font-face rules, so the PDF renders with
// Inter + JetBrains Mono without any network fetch at render time (the container
// has no guaranteed outbound access, and Google Fonts would bloat the PDF). Read
// once and cached. Missing files degrade gracefully to the system font stack.
function getFontsCss(): string {
  if (_fontsCss !== null) return _fontsCss;
  const fontsDir = path.join(__dirname, 'assets', 'fonts');
  const faces: Array<{ family: string; weight: number; file: string }> = [
    { family: 'Inter',          weight: 400, file: 'Inter-400.woff2' },
    { family: 'Inter',          weight: 600, file: 'Inter-600.woff2' },
    { family: 'Inter',          weight: 700, file: 'Inter-700.woff2' },
    { family: 'JetBrains Mono', weight: 500, file: 'JetBrainsMono-500.woff2' },
    { family: 'JetBrains Mono', weight: 700, file: 'JetBrainsMono-700.woff2' },
  ];
  try {
    _fontsCss = faces.map(f => {
      const b64 = fs.readFileSync(path.join(fontsDir, f.file)).toString('base64');
      return `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};` +
        `font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
    }).join('\n');
  } catch {
    _fontsCss = '';
  }
  return _fontsCss;
}

// Zebra "stripes" brand motif (white lines on transparent), embedded as base64
// for the dark report header band. Read once and cached.
function getMotifB64(): string {
  if (_motifB64 !== null) return _motifB64;
  try {
    _motifB64 = fs.readFileSync(path.join(__dirname, 'assets', 'motif-stripes-dark.png')).toString('base64');
  } catch {
    _motifB64 = '';
  }
  return _motifB64;
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
  const enriched = {
    ...data,
    _logoB64:  getLogoB64(),
    _fontsCss: getFontsCss(),
    _motifB64: getMotifB64(),
    _nivelLabel: nivelLabel,
  };
  const html = eta.render(template, enriched);
  if (!html) throw new Error(`Template '${template}' rendered empty`);

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    // The embedded @font-face fonts are data URIs, but decoding is async — wait
    // for them so the first page never rasterises with a fallback font. Passed as
    // a string so the browser-only `document` global isn't type-checked in Node.
    await page.evaluate('document.fonts && document.fonts.ready.then(() => true)');
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
