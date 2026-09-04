// ─────────────────────────────────────────────────────────────────────────────
// Guarda efímera del PDF de un cliente externo, entre que runJob lo termina y
// el navegador lo descarga. Es la implementación literal de "cero
// almacenamiento": nada toca disco ni base; el buffer vive en memoria, expira a
// los 30 minutos y se borra en la PRIMERA descarga.
//
// ponytail: memoria de proceso. Se pierde al reiniciar y no sobrevive a más de
// una instancia (con dos réplicas la descarga acertaría la mitad de las veces).
// Si algún día hay réplicas, esto necesita almacenamiento compartido, que es
// exactamente lo que se decidió no tener.
// ─────────────────────────────────────────────────────────────────────────────

const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 20;

interface Entry { buf: Buffer; filename: string; exp: number }

export class PdfVault {
  private map = new Map<string, Entry>();
  constructor(
    private now: () => number = Date.now,
    private opts: { maxEntries?: number } = {},
  ) {}

  put(jobId: string, buf: Buffer, filename: string): void {
    this.sweep();
    const max = this.opts.maxEntries ?? MAX_ENTRIES;
    while (this.map.size >= max) {
      const oldest = this.map.keys().next().value; // Map conserva orden de inserción
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    this.map.set(jobId, { buf, filename, exp: this.now() + TTL_MS });
  }

  /** Devuelve y BORRA: el link es de un solo uso. */
  take(jobId: string): { buf: Buffer; filename: string } | undefined {
    const e = this.map.get(jobId);
    this.map.delete(jobId);
    if (!e || this.now() > e.exp) return undefined;
    return { buf: e.buf, filename: e.filename };
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, e] of this.map) if (t > e.exp) this.map.delete(k);
  }
}

export const pdfVault = new PdfVault();
