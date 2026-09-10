// ─────────────────────────────────────────────────────────────────────────────
// Guarda efímera del PDF de un reporte, entre que runJob lo termina y el
// navegador lo ve o lo descarga. Es la implementación literal de "cero
// almacenamiento": nada toca disco ni base, el buffer vive en memoria y expira
// a los 30 minutos.
//
// Leer NO consume. Antes se borraba en el primer acceso, cuando la única forma
// de obtener el PDF era descargarlo; con el visualizador delante, esa regla
// significaba que mirar el reporte te dejaba sin poder bajarlo.
//
// La usan TODOS los clientes, no solo los externos: el visualizador enseña lo
// generado en la sesión, y para un cliente gestionado el PDF además vive en su
// Drive. Por eso el techo de memoria se cuenta en bytes y no solo en entradas.
//
// ponytail: memoria de proceso. Se pierde al reiniciar y no sobrevive a más de
// una instancia (con dos réplicas la lectura acertaría la mitad de las veces).
// Para el cliente EXTERNO eso ya no duele: su PDF además se guarda en SU propia
// base (jobs/archive.ts) y la ruta de descarga cae ahí cuando esto expira.
// Para un cliente gestionado esta guarda sigue siendo la única fuente durante
// los primeros 30 minutos, así que la restricción de una sola instancia sigue
// en pie hasta que también él tenga respaldo.
// ─────────────────────────────────────────────────────────────────────────────

const TTL_MS      = 30 * 60 * 1000;
const MAX_ENTRIES = 30;
const MAX_BYTES   = 250 * 1024 * 1024;

interface Entry { buf: Buffer; filename: string; exp: number }

export class PdfVault {
  private map = new Map<string, Entry>();
  private bytes = 0;
  constructor(
    private now: () => number = Date.now,
    private opts: { maxEntries?: number; maxBytes?: number } = {},
  ) {}

  put(jobId: string, buf: Buffer, filename: string): void {
    this.sweep();
    const maxEntries = this.opts.maxEntries ?? MAX_ENTRIES;
    const maxBytes   = this.opts.maxBytes   ?? MAX_BYTES;
    // Un PDF que no cabe ni él solo no entra, y sobre todo no vacía la guarda
    // intentando hacerle sitio.
    if (buf.length > maxBytes) {
      console.warn(`[vault] ${filename} pesa ${buf.length} B y no cabe en la guarda (${maxBytes} B): no se guarda`);
      return;
    }
    this.drop(jobId);   // re-generar el mismo job reemplaza, no duplica bytes
    while (this.map.size >= maxEntries || this.bytes + buf.length > maxBytes) {
      const oldest = this.map.keys().next().value;   // Map conserva orden de inserción
      if (oldest === undefined) break;
      this.drop(oldest);
    }
    this.map.set(jobId, { buf, filename, exp: this.now() + TTL_MS });
    this.bytes += buf.length;
  }

  /** Devuelve el PDF sin borrarlo. Solo el TTL y el tope lo sacan de aquí. */
  read(jobId: string): { buf: Buffer; filename: string } | undefined {
    const e = this.map.get(jobId);
    if (!e) return undefined;
    if (this.now() > e.exp) { this.drop(jobId); return undefined; }
    return { buf: e.buf, filename: e.filename };
  }

  private drop(jobId: string): void {
    const e = this.map.get(jobId);
    if (!e) return;
    this.bytes -= e.buf.length;
    this.map.delete(jobId);
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, e] of this.map) if (t > e.exp) this.drop(k);
  }
}

export const pdfVault = new PdfVault();
